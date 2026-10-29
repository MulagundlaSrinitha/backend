import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionQueryDto } from './dto/commission.dto';

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate and create commission records for an order.
   * Called automatically when an order is created/completed.
   */
  async calculateCommissions(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: { vendor: true },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    // Razorpay orders must be PAID; COD orders have paymentStatus PENDING (paid on delivery)
    if (order.paymentStatus !== 'PAID' && order.paymentMethod !== 'COD') {
      throw new BadRequestException('Order is not yet paid');
    }

    // Create commission records for each vendor group
    // Uses upsert with DB-level @@unique([orderId, vendorId]) for idempotency
    const commissions = [];
    for (const group of order.vendorGroups) {
      const commissionPct = group.vendor.commissionPct;
      const commissionAmount =
        (Number(group.subtotal) * commissionPct) / 100;

      try {
        const commission = await this.prisma.commission.upsert({
          where: {
            orderId_vendorId: {
              orderId,
              vendorId: group.vendorId,
            },
          },
          update: {},
          create: {
            orderId,
            vendorId: group.vendorId,
            orderAmount: group.subtotal,
            commissionPct,
            commissionAmount,
          },
          include: {
            vendor: { select: { id: true, storeName: true } },
          },
        });
        commissions.push(commission);
      } catch (error: any) {
        if (error?.code === 'P2002') {
          // Race condition: another concurrent request created it — fetch existing
          const existing = await this.prisma.commission.findFirst({
            where: { orderId, vendorId: group.vendorId },
            include: {
              vendor: { select: { id: true, storeName: true } },
            },
          });
          if (existing) commissions.push(existing);
        } else {
          throw error;
        }
      }
    }

    return commissions;
  }

  /**
   * Get all commissions with pagination.
   * ADMIN views all; VENDOR views their own.
   */
  async findAll(userId: string, role: string, query: CommissionQueryDto) {
    const where: any = {};

    if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      where.vendorId = vendor.id;
    } else if (role === 'ADMIN' && query.vendorId) {
      where.vendorId = query.vendorId;
    } else if (role !== 'ADMIN') {
      // Customers and delivery partners have no commission ledger to read.
      throw new ForbiddenException('Access denied');
    }

    if (query.isPaid !== undefined) {
      where.isPaid = query.isPaid;
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.commission.findMany({
        where,
        include: {
          vendor: { select: { id: true, storeName: true } },
          order: {
            select: { id: true, orderNo: true, createdAt: true, totalAmount: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commission.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get commission summary for a vendor.
   */
  async getSummary(userId: string, role: string) {
    let vendorId: string | undefined;

    if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      vendorId = vendor.id;
    } else if (role !== 'ADMIN') {
      throw new ForbiddenException('Access denied');
    }

    const where = vendorId ? { vendorId } : {};

    const [totalCommission, paidCommission, unpaidCommission, recentCommissions] =
      await this.prisma.$transaction([
        this.prisma.commission.aggregate({
          where,
          _sum: { commissionAmount: true },
        }),
        this.prisma.commission.aggregate({
          where: { ...where, isPaid: true },
          _sum: { commissionAmount: true },
        }),
        this.prisma.commission.aggregate({
          where: { ...where, isPaid: false },
          _sum: { commissionAmount: true },
        }),
        this.prisma.commission.findMany({
          where,
          include: {
            order: { select: { orderNo: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);

    return {
      totalCommission: totalCommission._sum.commissionAmount || 0,
      paidCommission: paidCommission._sum.commissionAmount || 0,
      unpaidCommission: unpaidCommission._sum.commissionAmount || 0,
      recentCommissions,
    };
  }

  /**
   * Mark a commission as paid (admin action).
   */
  async markAsPaid(commissionId: string) {
    const commission = await this.prisma.commission.findUnique({
      where: { id: commissionId },
    });
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.isPaid) throw new BadRequestException('Commission already paid');

    return this.prisma.commission.update({
      where: { id: commissionId },
      data: { isPaid: true, paidAt: new Date() },
    });
  }

  /**
   * Mark multiple commissions as paid (bulk payout).
   */
  async markBulkAsPaid(commissionIds: string[]) {
    const result = await this.prisma.commission.updateMany({
      where: {
        id: { in: commissionIds },
        isPaid: false,
      },
      data: { isPaid: true, paidAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * Update a vendor's commission rate (admin action).
   */
  async updateVendorCommissionRate(vendorId: string, rate: number) {
    if (rate < 0 || rate > 100) {
      throw new BadRequestException('Commission rate must be between 0 and 100');
    }

    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    return this.prisma.vendor.update({
      where: { id: vendorId },
      data: { commissionPct: rate },
      select: { id: true, storeName: true, commissionPct: true },
    });
  }
}
