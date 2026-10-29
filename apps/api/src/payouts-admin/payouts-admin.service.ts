import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PayoutsAdminService {
  constructor(private prisma: PrismaService) {}

  async getAllPayouts(page = 1, limit = 20, status?: string, type?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (type === 'vendor') where.vendorId = { not: null };
    if (type === 'delivery') where.deliveryPartnerId = { not: null };

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              storeName: true,
              storeType: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
          deliveryPartner: {
            select: {
              id: true,
              vehicleType: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payout.count({ where }),
    ]);

    const totalAmount = payouts.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const statusBreakdown = await this.prisma.payout.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amount: true },
    });

    return {
      data: payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        type: p.vendorId ? 'vendor' : 'delivery',
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        vendor: p.vendor,
        deliveryPartner: p.deliveryPartner,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        totalAmount,
        statusBreakdown: statusBreakdown.map((s) => ({
          status: s.status,
          count: s._count,
          amount: Number(s._sum.amount || 0),
        })),
      },
    };
  }

  async getVendorPayouts(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {
      vendorId: { not: null },
    };

    if (status) where.status = status;

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              storeName: true,
              storeType: true,
              user: { select: { id: true, name: true, email: true } },
              zone: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payout.count({ where }),
    ]);

    const totalAmount = payouts.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const statusBreakdown = await this.prisma.payout.groupBy({
      by: ['status'],
      where: { vendorId: { not: null } },
      _count: true,
      _sum: { amount: true },
    });

    return {
      data: payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        vendor: p.vendor,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        totalAmount,
        statusBreakdown: statusBreakdown.map((s) => ({
          status: s.status,
          count: s._count,
          amount: Number(s._sum.amount || 0),
        })),
      },
    };
  }

  async getDeliveryPayouts(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {
      deliveryPartnerId: { not: null },
    };

    if (status) where.status = status;

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: {
          deliveryPartner: {
            select: {
              id: true,
              vehicleType: true,
              status: true,
              user: { select: { id: true, name: true, email: true } },
              zone: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payout.count({ where }),
    ]);

    const totalAmount = payouts.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const statusBreakdown = await this.prisma.payout.groupBy({
      by: ['status'],
      where: { deliveryPartnerId: { not: null } },
      _count: true,
      _sum: { amount: true },
    });

    return {
      data: payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        deliveryPartner: p.deliveryPartner,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        totalAmount,
        statusBreakdown: statusBreakdown.map((s) => ({
          status: s.status,
          count: s._count,
          amount: Number(s._sum.amount || 0),
        })),
      },
    };
  }
}
