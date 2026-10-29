import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { VerifyKycDto } from './dto/verify-kyc.dto';
import { KycStatus, UserRole } from '@prisma/client';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async submit(userId: string, dto: SubmitKycDto) {
    const existing = await this.prisma.kYC.findUnique({ where: { userId } });
    if (existing && existing.status === KycStatus.VERIFIED) {
      throw new ConflictException('KYC is already verified');
    }

    if (existing && existing.status === KycStatus.PENDING) {
      throw new ConflictException('KYC submission is already pending review');
    }

    // Upsert: create or update existing (e.g. re-submit after rejection)
    return this.prisma.kYC.upsert({
      where: { userId },
      update: {
        documentType: dto.documentType,
        documentNumber: dto.documentNumber || null,
        documentUrl: dto.documentUrl || null,
        status: KycStatus.PENDING,
        rejectionReason: null,
        submittedAt: new Date(),
        verifiedAt: null,
      },
      create: {
        userId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber || null,
        documentUrl: dto.documentUrl || null,
        status: KycStatus.PENDING,
      },
    });
  }

  async getByUserId(userId: string) {
    const kyc = await this.prisma.kYC.findUnique({ where: { userId } });
    if (!kyc) throw new NotFoundException('No KYC submission found');
    return kyc;
  }

  async findAll(status?: KycStatus) {
    const where = status ? { status } : {};
    return this.prisma.kYC.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const kyc = await this.prisma.kYC.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, phone: true } },
      },
    });
    if (!kyc) throw new NotFoundException('KYC record not found');
    return kyc;
  }

  async verify(id: string, dto: VerifyKycDto) {
    const existing = await this.findOne(id);

    if (dto.status === KycStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('Rejection reason is required when rejecting KYC');
    }

    if (existing.status === dto.status) {
      return existing;
    }

    const updated = await this.prisma.kYC.update({
      where: { id },
      data: {
        status: dto.status,
        rejectionReason: dto.rejectionReason || null,
        verifiedAt: dto.status === KycStatus.VERIFIED ? new Date() : null,
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: existing.userId },
      select: { role: true },
    });

    if (user?.role === UserRole.DELIVERY_PARTNER) {
      try {
        if (dto.status === KycStatus.VERIFIED) {
          await this.notificationsService.sendDeliveryPartnerKycApprovedNotification(existing.userId);
        } else if (dto.status === KycStatus.REJECTED) {
          await this.notificationsService.sendDeliveryPartnerKycRejectedNotification(
            existing.userId,
            dto.rejectionReason || undefined,
          );
        }
      } catch (error: any) {
        this.logger.error(`Delivery partner KYC notification failed: ${error.message}`);
      }
    }

    return updated;
  }
}
