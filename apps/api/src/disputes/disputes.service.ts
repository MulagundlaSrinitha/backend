import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateDisputeDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { user: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    const existing = await this.prisma.returnRequest.findFirst({
      where: { orderId: dto.orderId, userId },
    });
    if (existing) {
      throw new BadRequestException('A dispute already exists for this order');
    }

    return this.prisma.returnRequest.create({
      data: {
        orderId: dto.orderId,
        userId,
        reason: dto.reason,
      },
      include: {
        order: { select: { id: true, orderNo: true, totalAmount: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findAll() {
    const disputes = await this.prisma.returnRequest.findMany({
      include: {
        order: {
          select: { id: true, orderNo: true, totalAmount: true, status: true },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return disputes.map((d) => this.mapDispute(d));
  }

  async findOne(id: string) {
    const dispute = await this.prisma.returnRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: { id: true, orderNo: true, totalAmount: true, status: true },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    return this.mapDispute(dispute);
  }

  async resolve(id: string, dto: ResolveDisputeDto) {
    const dispute = await this.findOne(id);

    const allowedStatuses = ['RESOLVED', 'REJECTED', 'APPROVED', 'REFUNDED', 'IN_REVIEW'];
    if (!allowedStatuses.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status: ${dto.status}. Allowed: ${allowedStatuses.join(', ')}`,
      );
    }

    const statusMap: Record<string, string> = {
      RESOLVED: 'APPROVED',
      REJECTED: 'REJECTED',
      APPROVED: 'APPROVED',
      REFUNDED: 'REFUNDED',
      IN_REVIEW: 'PENDING',
    };

    const updated = await this.prisma.returnRequest.update({
      where: { id },
      data: { status: statusMap[dto.status] as any },
      include: {
        order: {
          select: { id: true, orderNo: true, totalAmount: true, status: true },
        },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return this.mapDispute(updated, dto.resolution);
  }

  async findRefunds() {
    const refunds = await this.prisma.returnRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'REFUNDED'] } },
      include: {
        order: {
          select: { id: true, orderNo: true, totalAmount: true, status: true },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return refunds.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNo: r.order?.orderNo || r.orderId?.slice(0, 8),
      reason: r.reason,
      status: r.status,
      type: 'REFUND',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      customerName: r.user?.name || '',
      resolution: '',
    }));
  }

  private mapDispute(record: any, resolution?: string) {
    const statusDisplayMap: Record<string, string> = {
      PENDING: 'PENDING',
      APPROVED: 'RESOLVED',
      REJECTED: 'REJECTED',
      REFUNDED: 'RESOLVED',
    };

    return {
      id: record.id,
      orderId: record.orderId,
      orderNo: record.order?.orderNo || record.orderId?.slice(0, 8),
      reason: record.reason,
      status: resolution ? 'RESOLVED' : (statusDisplayMap[record.status] || record.status),
      type: 'RETURN',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      customerName: record.user?.name || '',
      vendorName: '',
      resolution: resolution || '',
      order: record.order ? {
        id: record.order.id,
        orderNo: record.order.orderNo,
        totalAmount: record.order.totalAmount,
        status: record.order.status,
      } : undefined,
      user: record.user ? {
        id: record.user.id,
        name: record.user.name,
        email: record.user.email,
      } : undefined,
    };
  }
}
