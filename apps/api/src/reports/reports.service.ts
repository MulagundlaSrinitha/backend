import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getSalesReport(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [orders, statusCounts, dailyOrders] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNo: true,
          totalAmount: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
          vendorGroups: {
            select: {
              subtotal: true,
              vendor: { select: { storeName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { totalAmount: true },
      }),
      this.prisma.order.groupBy({
        by: ['createdAt'],
        where,
        _count: true,
        _sum: { totalAmount: true },
      }),
    ]);

    const totalRevenue = orders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );

    const totalOrders = orders.length;

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const statusBreakdown = statusCounts.map((s) => ({
      status: s.status,
      count: s._count,
      revenue: Number(s._sum.totalAmount || 0),
    }));

    const daily = dailyOrders.map((d) => ({
      date: d.createdAt,
      orders: d._count,
      revenue: Number(d._sum.totalAmount || 0),
    }));

    return {
      summary: {
        totalOrders,
        totalRevenue,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        period: {
          start: startDate || null,
          end: endDate || null,
        },
      },
      statusBreakdown,
      daily,
      recentOrders: orders.slice(0, 20),
    };
  }

  async getRevenueReport(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [payments, commissions, payouts] = await Promise.all([
      this.prisma.payment.findMany({
        where: { order: where },
        select: {
          id: true,
          amount: true,
          status: true,
          method: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              totalAmount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.commission.findMany({
        where,
        select: {
          id: true,
          orderAmount: true,
          commissionPct: true,
          commissionAmount: true,
          isPaid: true,
          paidAt: true,
          createdAt: true,
          vendor: { select: { id: true, storeName: true } },
          order: { select: { id: true, orderNo: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payout.findMany({
        where: {
          createdAt: where.createdAt || undefined,
        },
        select: {
          id: true,
          amount: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          paidAt: true,
          createdAt: true,
          vendor: { select: { id: true, storeName: true } },
          deliveryPartner: {
            select: {
              id: true,
              user: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPayments = payments
      .filter((p) => p.status === 'CAPTURED')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalCommissions = commissions.reduce(
      (sum, c) => sum + Number(c.commissionAmount),
      0,
    );

    const paidCommissions = commissions
      .filter((c) => c.isPaid)
      .reduce((sum, c) => sum + Number(c.commissionAmount), 0);

    const pendingCommissions = totalCommissions - paidCommissions;

    const totalPayouts = payouts
      .filter((p) => p.status === 'PAID')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const paymentMethodBreakdown = payments.reduce((acc, p) => {
      const method = p.method || 'UNKNOWN';
      if (!acc[method]) acc[method] = { count: 0, amount: 0 };
      acc[method].count += 1;
      acc[method].amount += Number(p.amount);
      return acc;
    }, {} as Record<string, { count: number; amount: number }>);

    return {
      summary: {
        totalPayments,
        totalCommissions,
        paidCommissions,
        pendingCommissions,
        totalPayouts,
        netRevenue: totalCommissions - totalPayouts,
      },
      paymentMethodBreakdown: Object.entries(paymentMethodBreakdown).map(
        ([method, data]) => ({
          method,
          ...data,
        }),
      ),
      recentCommissions: commissions.slice(0, 20),
      recentPayouts: payouts.slice(0, 20),
    };
  }

  // ─── CSV Export Methods ────────────────────────────────────────────────

  private toCsvEscape(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  async getSalesReportCsv(startDate?: string, endDate?: string) {
    const report = await this.getSalesReport(startDate, endDate);

    const headers = [
      'Order ID',
      'Order No',
      'Customer',
      'Status',
      'Payment Method',
      'Payment Status',
      'Total Amount',
      'Vendors',
      'Created At',
    ];

    const rows = report.recentOrders.map((o: any) => [
      this.toCsvEscape(o.id),
      this.toCsvEscape(o.orderNo),
      this.toCsvEscape(o.user?.name || ''),
      this.toCsvEscape(o.status),
      this.toCsvEscape(o.paymentMethod),
      this.toCsvEscape(o.paymentStatus),
      this.toCsvEscape(Number(o.totalAmount)),
      this.toCsvEscape(
        (o.vendorGroups || [])
          .map((g: any) => g.vendor?.storeName || '')
          .filter(Boolean)
          .join('; ')
      ),
      this.toCsvEscape(new Date(o.createdAt).toISOString()),
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  async getRevenueReportCsv(startDate?: string, endDate?: string) {
    const report = await this.getRevenueReport(startDate, endDate);

    const headers = [
      'ID',
      'Type',
      'Amount',
      'Status',
      'Vendor/Delivery Partner',
      'Period Start',
      'Period End',
      'Paid At',
      'Created At',
    ];

    const rows = [
      ...report.recentCommissions.map((c: any) => [
        this.toCsvEscape(c.id),
        'COMMISSION',
        this.toCsvEscape(Number(c.commissionAmount)),
        this.toCsvEscape(c.isPaid ? 'PAID' : 'PENDING'),
        this.toCsvEscape(c.vendor?.storeName || ''),
        '',
        '',
        this.toCsvEscape(c.paidAt ? new Date(c.paidAt).toISOString() : ''),
        this.toCsvEscape(new Date(c.createdAt).toISOString()),
      ].join(',')),
      ...report.recentPayouts.map((p: any) => [
        this.toCsvEscape(p.id),
        'PAYOUT',
        this.toCsvEscape(Number(p.amount)),
        this.toCsvEscape(p.status),
        this.toCsvEscape(p.vendor?.storeName || p.deliveryPartner?.user?.name || ''),
        this.toCsvEscape(p.periodStart ? new Date(p.periodStart).toISOString() : ''),
        this.toCsvEscape(p.periodEnd ? new Date(p.periodEnd).toISOString() : ''),
        this.toCsvEscape(p.paidAt ? new Date(p.paidAt).toISOString() : ''),
        this.toCsvEscape(new Date(p.createdAt).toISOString()),
      ].join(',')),
    ];

    return [headers.join(','), ...rows].join('\n');
  }
}
