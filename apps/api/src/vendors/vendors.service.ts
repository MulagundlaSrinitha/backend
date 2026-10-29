import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { UploadService } from '../upload/upload.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { StoreType, SellerType, VendorStatus, VendorKycDocumentType, VendorKycDocumentStatus } from '@prisma/client';
import { QueryVendorsDto } from './dto/query-vendors.dto';

// Documents every seller type must submit, plus store-type-specific
// certifications. Individual sellers have one logical bank-proof requirement;
// business sellers must submit the two separate banking documents below.
const DOCUMENT_LABELS: Record<VendorKycDocumentType, string> = {
  PAN: 'PAN Card',
  AADHAAR: 'Aadhaar Card',
  GST_CERTIFICATE: 'GST Certificate',
  FSSAI_LICENSE: 'FSSAI License',
  NPOP_CERTIFICATE: 'NPOP Certificate',
  BANK_STATEMENT: 'Bank Statement',
  CANCELLED_CHEQUE: 'Cancelled Cheque',
  BANK_PASSBOOK: 'Bank Passbook',
};

const INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES: VendorKycDocumentType[] = [
  'CANCELLED_CHEQUE',
  'BANK_PASSBOOK',
];

function getRequiredDocumentTypes(sellerType: SellerType, storeType: StoreType): VendorKycDocumentType[] {
  const docs: VendorKycDocumentType[] = ['PAN'];
  docs.push(sellerType === 'BUSINESS' ? 'GST_CERTIFICATE' : 'AADHAAR');
  // FSSAI applies to every seller classification. NPOP is required only for
  // Organic classification, and must not block Natural or Eco-Friendly sellers.
  docs.push('FSSAI_LICENSE');
  if (storeType === 'ORGANIC') docs.push('NPOP_CERTIFICATE');
  if (sellerType === 'BUSINESS') docs.push('BANK_STATEMENT', 'CANCELLED_CHEQUE');
  return docs;
}

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
    private uploadService: UploadService,
  ) {}

  async register(userId: string, dto: CreateVendorDto) {
    const existing = await this.prisma.vendor.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('User already has a vendor profile');
    }

    const slugExists = await this.prisma.vendor.findUnique({ where: { storeSlug: dto.storeSlug } });
    if (slugExists) {
      throw new ConflictException('Store slug is already taken');
    }

    // Find a zone for this vendor (default to first active zone or create one)
    let zoneId = dto.zoneId;
    if (!zoneId) {
      const defaultZone = await this.prisma.zone.findFirst({ where: { isActive: true } });
      if (!defaultZone) {
        // Create a default zone if none exists
        const zone = await this.prisma.zone.create({
          data: { name: 'Default Zone', city: 'Default', isActive: true },
        });
        zoneId = zone.id;
      } else {
        zoneId = defaultZone.id;
      }
    }

    await this.prisma.user.updateMany({
      where: { id: userId, role: { not: 'ADMIN' } },
      data: { role: 'VENDOR' },
    });

    const vendor = await this.prisma.vendor.create({
      data: {
        userId,
        storeName: dto.storeName,
        storeSlug: dto.storeSlug,
        description: dto.description || null,
        storeType: dto.storeType,
        zoneId,
        status: 'PENDING',
        // FRD §40 default commission. Set explicitly so the rate does not
        // depend on the DB column default (schema migration to align the
        // column default is tracked separately).
        commissionPct: 15,
      },
    });

    // Send admin alert about new vendor registration
    try {
      await this.notificationsService.sendAdminNewVendorAlert(dto.storeName);
    } catch (error: any) {
      this.logger.error(`Admin new vendor alert failed: ${error.message}`);
    }

    return vendor;
  }

  async findAll(query: QueryVendorsDto = {}) {
    const where: any = {};

    if (query.storeType) where.storeType = query.storeType;

    // `status` is the explicit filter and wins over the legacy `isApproved`
    // shorthand (true -> APPROVED, false -> PENDING).
    const status = this.parseVendorStatus(query.status);
    if (status) {
      where.status = status;
    } else if (query.isApproved !== undefined) {
      where.status = this.parseBooleanParam(query.isApproved) ? 'APPROVED' : 'PENDING';
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { ownerName: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Pagination is opt-in: callers that need the full list (e.g. the admin
    // product-form vendor dropdown) pass no page/limit and must keep receiving
    // every vendor. A single `where` feeds both the rows and the count so the
    // total always reflects the active filters.
    const isPaginated = query.page !== undefined || query.limit !== undefined;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [vendors, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, name: true } },
          zone: { select: { name: true, city: true } },
          _count: { select: { products: true } },
          kycDocuments: { select: { documentType: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...(isPaginated ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      this.prisma.vendor.count({ where }),
    ]);

    const data = vendors.map(({ kycDocuments, ...vendor }) => ({
      ...vendor,
      kycStatus: this.deriveKycStatus(vendor.sellerType, getRequiredDocumentTypes(vendor.sellerType, vendor.storeType), kycDocuments),
    }));

    return {
      data,
      meta: {
        page: isPaginated ? page : 1,
        limit: isPaginated ? limit : total,
        total,
        totalPages: isPaginated ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    };
  }

  /**
   * Normalizes a status filter to a `VendorStatus`, or undefined when the
   * caller explicitly asked for "no filter" (All tab). Throws on genuinely
   * invalid values so typos surface instead of silently returning everything.
   */
  private parseVendorStatus(raw?: string): VendorStatus | undefined {
    if (raw === undefined || raw === null) return undefined;
    const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized === '' || ['ALL', 'ANY', 'NONE', 'NULL'].includes(normalized)) {
      return undefined;
    }
    const match = (Object.values(VendorStatus) as string[]).find((s) => s === normalized);
    if (!match) {
      throw new BadRequestException(
        `Invalid status "${raw}". Expected one of: ${Object.values(VendorStatus).join(', ')}`,
      );
    }
    return match as VendorStatus;
  }

  private parseBooleanParam(raw?: string): boolean {
    return String(raw).trim().toLowerCase() === 'true';
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
        zone: true,
        _count: { select: { products: true } },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async update(id: string, dto: UpdateVendorDto, requestingUserId: string) {
    const vendor = await this.findOne(id);

    // Only vendor owner or admin can update
    if (vendor.userId !== requestingUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: requestingUserId } });
      if (!user || user.role !== 'ADMIN') {
        throw new ForbiddenException('You can only update your own vendor profile');
      }
    }

    return this.prisma.vendor.update({ where: { id }, data: dto });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  VENDOR KYC + STORE PROFILE COMPLETION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Derives the vendor's overall KYC status from its individual document
   * reviews. Document-level statuses are the source of truth — there is no
   * separate stored "vendor KYC status" field to drift out of sync.
   */
  private deriveKycStatus(
    sellerType: SellerType,
    requiredTypes: VendorKycDocumentType[],
    documents: { documentType: VendorKycDocumentType; status: VendorKycDocumentStatus }[],
  ): 'INCOMPLETE' | 'PENDING_REVIEW' | 'REJECTED' | 'VERIFIED' {
    const byType = new Map(documents.map((d) => [d.documentType, d.status]));
    const bankProofDocuments = documents.filter((d) => INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES.includes(d.documentType));

    const missing = requiredTypes.some((t) => !byType.has(t)) || (sellerType === 'INDIVIDUAL' && bankProofDocuments.length === 0);
    if (missing) return 'INCOMPLETE';

    const relevantStatuses = [
      ...requiredTypes.map((t) => byType.get(t)!),
    ];
    // A single approved proof satisfies an individual seller's logical bank
    // requirement. If no proof is approved, a pending/expired proof remains
    // in review; it is rejected only when every uploaded option was rejected.
    if (sellerType === 'INDIVIDUAL') {
      if (bankProofDocuments.some((d) => d.status === 'APPROVED')) relevantStatuses.push('APPROVED');
      else if (bankProofDocuments.some((d) => d.status === 'PENDING' || d.status === 'EXPIRED')) relevantStatuses.push('PENDING');
      else relevantStatuses.push('REJECTED');
    }

    if (relevantStatuses.some((s) => s === 'REJECTED')) return 'REJECTED';
    if (relevantStatuses.some((s) => s === 'PENDING' || s === 'EXPIRED')) return 'PENDING_REVIEW';
    return 'VERIFIED';
  }

  /**
   * Dynamic profile completion % — recomputed on every read from the
   * vendor's current fields and documents rather than stored, so it can
   * never go stale.
   */
  private computeProfileCompletion(
    vendor: { storeName: string; description: string | null; ownerName: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; bankAccountName: string | null; bankAccountNumber: string | null; bankIfsc: string | null; bankName: string | null; sellerType: SellerType; storeType: StoreType },
    documents: { documentType: VendorKycDocumentType; status: VendorKycDocumentStatus }[],
  ) {
    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const uploadedTypes = new Set(documents.map((d) => d.documentType));
    const hasBankProof = documents.some((d) => INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES.includes(d.documentType));

    const items = [
      { key: 'storeBasics', label: 'Store name & description', done: !!(vendor.storeName && vendor.description) },
      { key: 'ownerName', label: 'Owner / contact name', done: !!vendor.ownerName },
      { key: 'address', label: 'Business address', done: !!(vendor.address && vendor.city && vendor.state && vendor.pincode) },
      { key: 'bankDetails', label: 'Bank account details', done: !!(vendor.bankAccountName && vendor.bankAccountNumber && vendor.bankIfsc && vendor.bankName) },
      ...requiredTypes.map((t) => ({ key: `doc_${t}`, label: DOCUMENT_LABELS[t], done: uploadedTypes.has(t) })),
      ...(vendor.sellerType === 'INDIVIDUAL'
        ? [{ key: 'bankProof', label: 'Bank account proof', done: hasBankProof }]
        : []),
    ];

    const doneCount = items.filter((i) => i.done).length;
    return {
      percent: Math.round((doneCount / items.length) * 100),
      items,
    };
  }

  /**
   * Full KYC + profile overview for the vendor's own dashboard: uploaded
   * documents, dynamic completion %, and the derived overall KYC status.
   */
  async getMyKycOverview(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const documents = await this.prisma.vendorKycDocument.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
    });

    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const kycStatus = this.deriveKycStatus(vendor.sellerType, requiredTypes, documents);
    const completion = this.computeProfileCompletion(vendor as any, documents);

    return {
      kycStatus,
      kycSubmittedAt: vendor.kycSubmittedAt,
      requiredDocumentTypes: requiredTypes,
      bankProofDocumentTypes: vendor.sellerType === 'INDIVIDUAL' ? INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES : [],
      documentLabels: DOCUMENT_LABELS,
      documents: documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        label: DOCUMENT_LABELS[d.documentType],
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        status: d.status,
        rejectionReason: d.rejectionReason,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      profileCompletion: completion,
    };
  }

  async uploadKycDocument(vendorId: string, documentType: VendorKycDocumentType, file: Express.Multer.File) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const allowedTypes = vendor.sellerType === 'INDIVIDUAL'
      ? [...requiredTypes, ...INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES]
      : requiredTypes;
    if (!allowedTypes.includes(documentType)) {
      throw new BadRequestException(`${DOCUMENT_LABELS[documentType]} is not required for this seller type and store type`);
    }

    if (vendor.sellerType === 'INDIVIDUAL' && INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES.includes(documentType)) {
      const otherProof = await this.prisma.vendorKycDocument.findFirst({
        where: {
          vendorId,
          documentType: { in: INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES.filter((type) => type !== documentType) },
          status: { not: 'REJECTED' },
        },
      });
      if (otherProof) {
        throw new ConflictException(`Bank Account Proof is already uploaded as ${DOCUMENT_LABELS[otherProof.documentType]}. Replace that document instead.`);
      }
    }

    const existing = await this.prisma.vendorKycDocument.findUnique({
      where: { vendorId_documentType: { vendorId, documentType } },
    });
    if (existing && existing.status === 'APPROVED') {
      throw new ConflictException(`${DOCUMENT_LABELS[documentType]} is already verified and cannot be re-uploaded`);
    }

    const uploaded = await this.uploadService.uploadVendorKycDocument(file, vendorId);

    const document = await this.prisma.vendorKycDocument.upsert({
      where: { vendorId_documentType: { vendorId, documentType } },
      create: {
        vendorId,
        documentType,
        storageKey: uploaded.storageKey,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
        status: 'PENDING',
      },
      update: {
        storageKey: uploaded.storageKey,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
        status: 'PENDING',
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });

    // Best-effort cleanup of the previous file so storage doesn't leak.
    if (existing && existing.storageKey !== document.storageKey) {
      this.uploadService.deleteVendorKycDocument(existing.storageKey).catch(() => {});
    }

    return document;
  }

  async getKycDocumentSignedUrl(vendorId: string, documentId: string) {
    const document = await this.prisma.vendorKycDocument.findFirst({
      where: { id: documentId, vendorId },
    });
    if (!document) throw new NotFoundException('Document not found');
    return { url: await this.uploadService.getSignedKycDocumentUrl(document.storageKey) };
  }

  async submitForVerification(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const documents = await this.prisma.vendorKycDocument.findMany({ where: { vendorId } });
    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const hasBankProof = documents.some((d) => INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES.includes(d.documentType));
    const missingTypes = requiredTypes.filter((t) => !documents.some((d) => d.documentType === t));

    if (missingTypes.length > 0 || (vendor.sellerType === 'INDIVIDUAL' && !hasBankProof)) {
      const missingLabels = [
        ...missingTypes.map((t) => DOCUMENT_LABELS[t]),
        ...(vendor.sellerType === 'INDIVIDUAL' && !hasBankProof ? ['Bank Account Proof (Cancelled Cheque or Bank Passbook)'] : []),
      ];
      throw new BadRequestException(`Please upload all required documents before submitting: ${missingLabels.join(', ')}`);
    }

    const updated = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { kycSubmittedAt: new Date() },
    });

    try {
      await this.notificationsService.sendAdminKycPendingAlert(vendor.storeName, 'KYC documents');
      await this.notificationsService.sendVendorKycSubmittedNotification(vendor.userId);
    } catch (error: any) {
      this.logger.error(`KYC submission notification failed: ${error.message}`);
    }

    return updated;
  }

  /**
   * Admin: list a vendor's KYC documents for review.
   */
  async getVendorKycDocumentsForAdmin(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const documents = await this.prisma.vendorKycDocument.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
    });
    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);

    return {
      kycStatus: this.deriveKycStatus(vendor.sellerType, requiredTypes, documents),
      kycSubmittedAt: vendor.kycSubmittedAt,
      requiredDocumentTypes: requiredTypes,
      bankProofDocumentTypes: vendor.sellerType === 'INDIVIDUAL' ? INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES : [],
      documentLabels: DOCUMENT_LABELS,
      documents: documents.map((d) => ({ ...d, label: DOCUMENT_LABELS[d.documentType] })),
    };
  }

  async adminGetKycDocumentSignedUrl(vendorId: string, documentId: string) {
    return this.getKycDocumentSignedUrl(vendorId, documentId);
  }

  async adminReviewKycDocument(
    vendorId: string,
    documentId: string,
    adminId: string,
    status: VendorKycDocumentStatus,
    rejectionReason?: string,
  ) {
    const document = await this.prisma.vendorKycDocument.findFirst({ where: { id: documentId, vendorId } });
    if (!document) throw new NotFoundException('Document not found');

    if (status === 'REJECTED' && !rejectionReason) {
      throw new BadRequestException('Rejection reason is required when rejecting a document');
    }

    const updated = await this.prisma.vendorKycDocument.update({
      where: { id: documentId },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });

    await this.auditService.log({
      adminId,
      action: status === 'APPROVED' ? 'APPROVE_VENDOR_KYC_DOCUMENT' : 'REJECT_VENDOR_KYC_DOCUMENT',
      resource: 'VendorKycDocument',
      resourceId: documentId,
      details: { vendorId, documentType: document.documentType, rejectionReason },
    });

    if (vendor) {
      try {
        if (status === 'APPROVED') {
          await this.notificationsService.sendVendorKycDocumentApprovedNotification(
            vendor.userId,
            DOCUMENT_LABELS[document.documentType],
          );
        } else if (status === 'REJECTED') {
          await this.notificationsService.sendVendorKycDocumentRejectedNotification(
            vendor.userId,
            DOCUMENT_LABELS[document.documentType],
            rejectionReason,
          );
        }
      } catch (error: any) {
        this.logger.error(`Vendor KYC document notification failed: ${error.message}`);
      }
    }

    return updated;
  }

  async updateStatus(id: string, status: string, adminId?: string) {
    const vendor = await this.findOne(id);
    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new BadRequestException(`Invalid status: ${status}. Must be one of ${validStatuses.join(', ')}`);
    }

    const newStatus = status.toUpperCase();

    if (newStatus === 'APPROVED' && vendor.status !== 'APPROVED') {
      await this.assertKycVerifiedForApproval(id);
    }

    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { status: newStatus as any },
    });

    // Audit log: record who changed the status and what changed
    if (adminId) {
      await this.auditService.log({
        adminId,
        action: `${newStatus === 'APPROVED' ? 'APPROVE' : newStatus === 'REJECTED' ? 'REJECT' : 'SUSPEND'}_VENDOR`,
        resource: 'Vendor',
        resourceId: id,
        details: {
          storeName: vendor.storeName,
          oldStatus: vendor.status,
          newStatus,
        },
      });
    }

    // Notify vendor about status changes
    try {
      if (newStatus === 'APPROVED' && vendor.status !== 'APPROVED') {
        await this.notificationsService.sendVendorApprovedNotification(
          vendor.userId,
          vendor.storeName,
        );
      } else if (newStatus === 'REJECTED') {
        await this.notificationsService.sendVendorRejectedNotification(
          vendor.userId,
          vendor.storeName,
        );
      } else if (newStatus === 'SUSPENDED') {
        await this.notificationsService.sendVendorSuspendedNotification(
          vendor.userId,
          vendor.storeName,
        );
      }
    } catch (error: any) {
      this.logger.error(`Vendor status notification failed: ${error.message}`);
    }

    return updated;
  }

  /**
   * Admin dashboard aggregate — returns everything admin needs to review a vendor:
   * profile, KYC documents, performance stats, recent orders, commission info.
   * All queries run in parallel for minimal latency.
   */
  async getAdminDetail(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, phone: true, avatarUrl: true, createdAt: true, isActive: true } },
        zone: true,
        _count: { select: { products: true } },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const kycDocuments = await this.prisma.vendorKycDocument.findMany({
      where: { vendorId: id },
      orderBy: { createdAt: 'desc' },
    });
    const requiredDocumentTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const vendorKyc = {
      kycStatus: this.deriveKycStatus(vendor.sellerType, requiredDocumentTypes, kycDocuments),
      kycSubmittedAt: vendor.kycSubmittedAt,
      requiredDocumentTypes,
      bankProofDocumentTypes: vendor.sellerType === 'INDIVIDUAL' ? INDIVIDUAL_BANK_PROOF_DOCUMENT_TYPES : [],
      documentLabels: DOCUMENT_LABELS,
      documents: kycDocuments.map((d) => ({ ...d, label: DOCUMENT_LABELS[d.documentType] })),
    };
    const completion = this.computeProfileCompletion(vendor as any, kycDocuments);

    const [orderAgg, productAgg, commissionAgg, recentOrders, payoutAgg, monthlyRevenue] =
      await Promise.all([
        // Total orders + revenue
        this.prisma.orderVendorGroup.aggregate({
          where: { vendorId: id },
          _count: true,
          _sum: { subtotal: true },
        }),

        // Product breakdown
        this.prisma.product.groupBy({
          by: ['isApproved', 'isActive'],
          where: { vendorId: id },
          _count: true,
        }),

        // Commission summary
        this.prisma.commission.aggregate({
          where: { vendorId: id },
          _sum: { commissionAmount: true, orderAmount: true },
          _count: true,
        }),

        // Recent orders (last 10 vendor groups)
        this.prisma.orderVendorGroup.findMany({
          where: { vendorId: id },
          include: {
            order: {
              select: {
                id: true, orderNo: true, status: true, paymentStatus: true,
                totalAmount: true, createdAt: true,
                user: { select: { name: true } },
              },
            },
            items: { select: { name: true, quantity: true, priceAtPurchase: true } },
          },
          orderBy: { order: { createdAt: 'desc' } },
          take: 10,
        }),

        // Payout summary
        this.prisma.payout.aggregate({
          where: { vendorId: id },
          _sum: { amount: true },
          _count: true,
        }),

        // Monthly revenue (last 6 months)
        this.prisma.orderVendorGroup.findMany({
          where: {
            vendorId: id,
            order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } },
          },
          select: { subtotal: true, order: { select: { createdAt: true } } },
        }),
      ]);

    // Compute product breakdown
    const productBreakdown: Record<string, number> = {};
    for (const p of productAgg) {
      const key = p.isApproved ? 'approved' : 'pending';
      productBreakdown[key] = (productBreakdown[key] || 0) + p._count;
      if (!p.isActive) {
        productBreakdown['inactive'] = (productBreakdown['inactive'] || 0) + p._count;
      }
    }

    // Compute monthly revenue
    const monthlyMap = new Map<string, { orders: number; revenue: number }>();
    for (const g of monthlyRevenue) {
      const key = g.order.createdAt.toISOString().slice(0, 7);
      const entry = monthlyMap.get(key) || { orders: 0, revenue: 0 };
      entry.orders++;
      entry.revenue += Number(g.subtotal);
      monthlyMap.set(key, entry);
    }
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyRevenueArray = Array.from(monthlyMap.entries())
      .filter(([month]) => month >= sixMonthsAgo.toISOString().slice(0, 7))
      .map(([month, data]) => ({ month, orders: data.orders, revenue: data.revenue }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const totalOrders = orderAgg._count;
    const totalRevenue = Number(orderAgg._sum.subtotal || 0);
    const paidPayouts = Number(payoutAgg._sum.amount || 0);
    const totalCommissions = Number(commissionAgg._sum.commissionAmount || 0);
    const totalOrderAmount = Number(commissionAgg._sum.orderAmount || 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        storeSlug: vendor.storeSlug,
        storeType: vendor.storeType,
        sellerType: vendor.sellerType,
        description: vendor.description,
        logoUrl: vendor.logoUrl,
        bannerUrl: vendor.bannerUrl,
        ownerName: vendor.ownerName,
        address: vendor.address,
        city: vendor.city,
        state: vendor.state,
        pincode: vendor.pincode,
        bankAccountName: vendor.bankAccountName,
        bankAccountNumber: vendor.bankAccountNumber,
        bankIfsc: vendor.bankIfsc,
        bankName: vendor.bankName,
        status: vendor.status,
        commissionPct: vendor.commissionPct,
        razorpayAccountId: vendor.razorpayAccountId,
        zone: vendor.zone,
        createdAt: vendor.createdAt,
      },
      owner: vendor.user,
      vendorKyc,
      profileCompletion: completion,
      performance: {
        totalOrders,
        totalRevenue,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        totalProducts: Object.values(productBreakdown).reduce((s, c) => s + c, 0),
        productBreakdown,
        totalCommissions,
        totalOrderAmount,
        netRevenue: totalRevenue - totalCommissions,
        paidPayouts,
        pendingPayouts: totalRevenue - totalCommissions - paidPayouts,
      },
      recentOrders: recentOrders.map((g) => ({
        id: g.id,
        orderId: g.order.id,
        orderNo: g.order.orderNo,
        status: g.order.status,
        paymentStatus: g.order.paymentStatus,
        totalAmount: Number(g.order.totalAmount),
        subtotal: Number(g.subtotal),
        customerName: g.order.user?.name || 'Customer',
        items: g.items,
        createdAt: g.order.createdAt,
      })),
      monthlyRevenue: monthlyRevenueArray,
    };
  }

  /**
   * Gate for both approve() and updateStatus('APPROVED', ...): a vendor's
   * KYC documents (VendorKycDocument — separate from the shared KYC model
   * used by Delivery Partners) must all be APPROVED before the store can go
   * live.
   */
  private async assertKycVerifiedForApproval(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const documents = await this.prisma.vendorKycDocument.findMany({ where: { vendorId } });
    const requiredTypes = getRequiredDocumentTypes(vendor.sellerType, vendor.storeType);
    const kycStatus = this.deriveKycStatus(vendor.sellerType, requiredTypes, documents);

    if (kycStatus !== 'VERIFIED') {
      const reasons: Record<string, string> = {
        INCOMPLETE: 'the vendor has not uploaded all required KYC documents',
        PENDING_REVIEW: 'one or more KYC documents are still pending review',
        REJECTED: 'one or more KYC documents were rejected and need resubmission',
      };
      throw new BadRequestException(
        `Cannot approve vendor: ${reasons[kycStatus]}. KYC must be fully verified before approval.`,
      );
    }
  }

  async approve(id: string, adminId?: string) {
    const vendor = await this.findOne(id);
    if (vendor.status === 'APPROVED') {
      throw new ConflictException('Vendor is already approved');
    }

    await this.assertKycVerifiedForApproval(id);

    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    // Audit log for approval
    if (adminId) {
      this.auditService.log({
        adminId,
        action: 'APPROVE_VENDOR',
        resource: 'Vendor',
        resourceId: id,
        details: { storeName: vendor.storeName, oldStatus: vendor.status, newStatus: 'APPROVED' },
      });
    }

    // Notify vendor that they've been approved
    try {
      await this.notificationsService.sendVendorApprovedNotification(
        vendor.userId,
        vendor.storeName,
      );
    } catch (error: any) {
      this.logger.error(`Vendor approval notification failed: ${error.message}`);
    }

    return updated;
  }

  async getStorefrontVendors(storeType: StoreType) {
    return this.prisma.vendor.findMany({
      where: { storeType, status: 'APPROVED' },
      include: {
        user: { select: { name: true, avatarUrl: true } },
        _count: { select: { products: true } },
      },
    });
  }

  async getVendorProducts(vendorId: string, page = 1, limit = 20, search?: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const skip = (page - 1) * limit;
    const where = {
      vendorId,
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: { category: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getVendorByUserId(userId: string) {
    return this.prisma.vendor.findUnique({
      where: { userId },
      include: { zone: true },
    });
  }

  async getVendorPayouts(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const payouts = await this.prisma.payout.findMany({
      where: { vendorId },
      select: {
        id: true,
        amount: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return payouts.map((p) => ({
      period:
        p.periodStart && p.periodEnd
          ? `${p.periodStart.toISOString().split('T')[0]} – ${p.periodEnd.toISOString().split('T')[0]}`
          : p.createdAt.toISOString().split('T')[0],
      amount: Number(p.amount),
      status: p.status === 'PROCESSED' || p.status === 'PAID' ? 'PAID' : p.status,
      initiatedAt: p.createdAt.toISOString(),
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    }));
  }

  async getAnalytics(vendorId: string) {
    const where = { vendorId };

    const [orderGroups, statusCounts, monthlyRevenue, recentOrders, productCounts] =
      await Promise.all([
        this.prisma.orderVendorGroup.findMany({
          where: { vendorId, order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } },
          select: { subtotal: true, status: true, order: { select: { createdAt: true } } },
        }),
        this.prisma.orderVendorGroup.groupBy({
          by: ['status'],
          where: { vendorId },
          _count: true,
        }),
        this.prisma.orderVendorGroup.findMany({
          where: { vendorId, order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } },
          select: { subtotal: true, order: { select: { createdAt: true } } },
        }),
        this.prisma.orderVendorGroup.findMany({
          where: { vendorId },
          include: {
            order: { select: { id: true, orderNo: true, status: true, createdAt: true } },
            items: { select: { name: true, priceAtPurchase: true, quantity: true } },
          },
          orderBy: { order: { createdAt: 'desc' } },
          take: 10,
        }),
        this.prisma.product.groupBy({
          by: ['isApproved'],
          where,
          _count: true,
        }),
      ]);

    const totalOrders = orderGroups.length;
    const totalRevenue = orderGroups.reduce(
      (sum, g) => sum + Number(g.subtotal),
      0,
    );
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const monthlyMap = new Map<string, { orders: number; revenue: number }>();
    for (const g of monthlyRevenue) {
      const key = g.order.createdAt.toISOString().slice(0, 7);
      const entry = monthlyMap.get(key) || { orders: 0, revenue: 0 };
      entry.orders++;
      entry.revenue += Number(g.subtotal);
      monthlyMap.set(key, entry);
    }

    const orderStatusBreakdown: Record<string, number> = {};
    for (const s of statusCounts) {
      orderStatusBreakdown[s.status] = s._count;
    }

    const productStatusBreakdown: Record<string, number> = {};
    for (const p of productCounts) {
      productStatusBreakdown[p.isApproved ? 'approved' : 'pending'] = p._count;
    }

    const uniqueCustomerIds = new Set(
      (
        await this.prisma.orderVendorGroup.findMany({
          where: { vendorId },
          select: {
            order: { select: { userId: true } },
          },
        })
      ).map((g) => g.order.userId),
    );

    // Delivery performance — average time from order creation to delivery
    const deliveredGroups = await this.prisma.orderVendorGroup.findMany({
      where: {
        vendorId,
        status: 'DELIVERED',
        delivery: { isNot: null },
      },
      select: {
        order: { select: { createdAt: true } },
        delivery: { select: { pickedUpAt: true, deliveredAt: true } },
      },
    });

    const deliveryTimes: number[] = [];
    for (const g of deliveredGroups) {
      if (g.delivery?.deliveredAt && g.order?.createdAt) {
        const mins = (g.delivery.deliveredAt.getTime() - g.order.createdAt.getTime()) / 60000;
        if (mins > 0 && mins < 300) deliveryTimes.push(mins); // skip outliers > 5h
      }
    }
    const avgDeliveryMins = deliveryTimes.length > 0
      ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length)
      : null;
    const fastestDelivery = deliveryTimes.length > 0 ? Math.round(Math.min(...deliveryTimes)) : null;
    const slowestDelivery = deliveryTimes.length > 0 ? Math.round(Math.max(...deliveryTimes)) : null;

    return {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      orderStatusBreakdown,
      productStatusBreakdown,
      totalCustomers: uniqueCustomerIds.size,
      recentOrders: recentOrders.map((g) => ({
        id: g.order.id,
        orderNo: g.order.orderNo,
        status: g.order.status,
        subtotal: g.subtotal,
        items: g.items,
        createdAt: g.order.createdAt,
      })),
      monthlyRevenue: Array.from(monthlyMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      deliveryPerformance: {
        avgDeliveryMins,
        fastestDelivery,
        slowestDelivery,
        totalDelivered: deliveryTimes.length,
        configuredMin: (await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { deliveryTimeMin: true } }))?.deliveryTimeMin,
        configuredMax: (await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { deliveryTimeMax: true } }))?.deliveryTimeMax,
        configuredLabel: (await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { deliveryLabel: true } }))?.deliveryLabel,
      },
    };
  }

  async getVendorEarnings(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const wherePaidNonCancelled = {
      vendorId,
      order: {
        paymentStatus: 'PAID' as const,
        status: { notIn: ['CANCELLED', 'REFUNDED'] as ('CANCELLED' | 'REFUNDED')[] },
      },
    };

    const [todayAgg, monthAgg, lifetimeAgg, paidAgg, unpaidAgg, recentCommissions] =
      await this.prisma.$transaction([
        this.prisma.commission.aggregate({
          where: {
            ...wherePaidNonCancelled,
            createdAt: { gte: startOfToday, lte: now },
          },
          _sum: { orderAmount: true, commissionAmount: true },
          _count: true,
        }),
        this.prisma.commission.aggregate({
          where: {
            ...wherePaidNonCancelled,
            createdAt: { gte: startOfMonth, lte: now },
          },
          _sum: { orderAmount: true, commissionAmount: true },
        }),
        this.prisma.commission.aggregate({
          where: wherePaidNonCancelled,
          _sum: { orderAmount: true, commissionAmount: true },
        }),
        this.prisma.commission.aggregate({
          where: { ...wherePaidNonCancelled, isPaid: true },
          _sum: { orderAmount: true, commissionAmount: true },
        }),
        this.prisma.commission.aggregate({
          where: { ...wherePaidNonCancelled, isPaid: false },
          _sum: { orderAmount: true, commissionAmount: true },
        }),
        this.prisma.commission.findMany({
          where: wherePaidNonCancelled,
          select: {
            orderAmount: true,
            commissionAmount: true,
            isPaid: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);

    const toNet = (agg: { orderAmount: any; commissionAmount: any }) =>
      Number(agg.orderAmount || 0) - Number(agg.commissionAmount || 0);

    const historyMap = new Map<string, { amount: number; isPaid: boolean }>();
    for (const c of recentCommissions) {
      const dateStr = c.createdAt.toISOString().split('T')[0];
      const existing = historyMap.get(dateStr);
      const net = Number(c.orderAmount) - Number(c.commissionAmount);
      if (existing) {
        existing.amount += net;
        existing.isPaid = existing.isPaid && c.isPaid;
      } else {
        historyMap.set(dateStr, { amount: net, isPaid: c.isPaid });
      }
    }
    const history = Array.from(historyMap.entries()).map(([date, data]) => ({
      period: date,
      amount: data.amount,
      status: data.isPaid ? 'PAID' : 'PENDING',
    }));

    return {
      todayEarnings: toNet(todayAgg._sum),
      totalEarnings: toNet(lifetimeAgg._sum),
      thisMonth: toNet(monthAgg._sum),
      pending: toNet(unpaidAgg._sum),
      paid: toNet(paidAgg._sum),
      pendingPayout: toNet(unpaidAgg._sum),
      history,
    };
  }

  /**
   * One entry per commission record, showing only the vendor's net amount (never the platform's cut).
   * Defaults to today's date range when no dates are provided.
   */
  async getVendorTransactions(
    vendorId: string,
    query: { page?: number; limit?: number; startDate?: string; endDate?: string },
  ) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startFilter: Date;
    let endFilter: Date;

    if (query.startDate || query.endDate) {
      startFilter = query.startDate ? new Date(query.startDate) : startOfToday;
      endFilter = query.endDate ? new Date(query.endDate) : now;
      if (query.endDate) {
        endFilter.setHours(23, 59, 59, 999);
      }
    } else {
      startFilter = startOfToday;
      endFilter = now;
    }

    const where: any = {
      vendorId,
      createdAt: { gte: startFilter, lte: endFilter },
      order: {
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
    };

    const [commissions, total] = await this.prisma.$transaction([
      this.prisma.commission.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              status: true,
              paymentStatus: true,
              paymentMethod: true,
              createdAt: true,
              user: {
                select: { name: true, phone: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commission.count({ where }),
    ]);

    const transactions = commissions.map((c) => ({
      orderNo: c.order.orderNo,
      customer: c.order.user?.name || 'Customer',
      amount: Number(c.orderAmount) - Number(c.commissionAmount),
      type: c.order.status === 'REFUNDED' ? 'REFUND' : 'SALE',
      date: c.createdAt,
    }));

    return { success: true, data: transactions, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getCustomers(vendorId: string) {
    const orderGroups = await this.prisma.orderVendorGroup.findMany({
      where: { vendorId },
      select: {
        subtotal: true,
        order: {
          select: {
            userId: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
    });

    const customerMap = new Map<
      string,
      {
        id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        totalOrders: number;
        totalSpent: number;
        lastOrderDate: Date;
      }
    >();

    for (const g of orderGroups) {
      const u = g.order.user;
      if (!u) continue;
      const existing = customerMap.get(u.id);
      if (existing) {
        existing.totalOrders++;
        existing.totalSpent += Number(g.subtotal);
        if (g.order.createdAt > existing.lastOrderDate) {
          existing.lastOrderDate = g.order.createdAt;
        }
      } else {
        customerMap.set(u.id, {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          totalOrders: 1,
          totalSpent: Number(g.subtotal),
          lastOrderDate: g.order.createdAt,
        });
      }
    }

    return Array.from(customerMap.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent,
    );
  }

  async getVendorStats(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        zone: { select: { id: true, name: true, city: true } },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [orderGroups, productCounts, payoutSummary] = await Promise.all([
      this.prisma.orderVendorGroup.findMany({
        where: { vendorId },
        select: { subtotal: true, status: true, order: { select: { status: true } } },
      }),
      this.prisma.product.groupBy({
        by: ['isApproved', 'isActive'],
        where: { vendorId },
        _count: true,
      }),
      this.prisma.payout.aggregate({
        where: { vendorId },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const totalOrders = orderGroups.length;
    const totalRevenue = orderGroups
      .filter((g) => !['CANCELLED', 'REFUNDED'].includes(g.order.status))
      .reduce((sum, g) => sum + Number(g.subtotal), 0);

    const productBreakdown: Record<string, number> = {};
    for (const p of productCounts) {
      const key = p.isApproved ? 'approved' : 'pending';
      productBreakdown[key] = (productBreakdown[key] || 0) + p._count;
    }

    return {
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        storeType: vendor.storeType,
        status: vendor.status,
        commissionPct: vendor.commissionPct,
        user: vendor.user,
        zone: vendor.zone,
      },
      totalOrders,
      totalRevenue,
      totalProducts: productCounts.reduce((s, p) => s + p._count, 0),
      productBreakdown,
      totalPayouts: payoutSummary._count,
      totalPayoutAmount: Number(payoutSummary._sum.amount ?? 0),
    };
  }


}
