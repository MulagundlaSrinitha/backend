import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Aggregate dashboard — single-query live metrics for the admin panel.
   * Returns today's pulse, pending actions, order pipeline, revenue chart,
   * recent orders, and aggregate counts. All queries run in parallel via
   * Promise.all for minimal latency.
   */
  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const PIPELINE_STAGES = [
      'PLACED',
      'CONFIRMED',
      'PACKED',
      'READY_FOR_PICKUP',
      'ASSIGNED_TO_DELIVERY',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ] as const;

    // ── 7-day revenue chart ────────────────────────────────────────
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [
      totalUsers,
      totalVendors,
      totalProducts,
      totalOrders,
      todayOrders,
      pendingVendorApprovals,
      pendingProductApprovals,
      pendingKyc,
      activeDeliveryPartners,
      totalDeliveryPartners,
      approvedVendors,
      orderStatusCounts,
      weeklyRevenue,
      recentOrders,
      openDisputes,
      pendingDeliveryAssignments,
    ] = await Promise.all([
      // Total counts
      this.prisma.user.count(),
      this.prisma.vendor.count(),
      this.prisma.product.count(),
      this.prisma.order.count(),

      // Today's orders
      this.prisma.order.findMany({
        where: { createdAt: { gte: today } },
        select: { id: true, totalAmount: true, status: true, createdAt: true },
      }),

      // Pending vendor approvals
      this.prisma.vendor.findMany({
        where: { status: 'PENDING' },
        select: { id: true, storeName: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 5,
      }),

      // Pending product approvals — include vendor name directly to avoid N+1
      this.prisma.product.findMany({
        where: { isApproved: false, isActive: true },
        select: { id: true, name: true, isApproved: true, createdAt: true, vendor: { select: { storeName: true } } },
        orderBy: { createdAt: 'asc' },
        take: 5,
      }),

      // Pending KYC
      this.prisma.kYC.count({ where: { status: 'PENDING' } }),

      // Active delivery partners
      this.prisma.deliveryPartner.count({
        where: { status: { in: ['AVAILABLE', 'ON_DELIVERY'] } },
      }),

      // Total delivery partners (all statuses)
      this.prisma.deliveryPartner.count(),

      // Active/approved vendors
      this.prisma.vendor.count({
        where: { status: 'APPROVED' },
      }),

      // Order pipeline (count per status)
      this.prisma.order.groupBy({
        by: ['status'],
        _count: true,
      }),

      // Weekly revenue (last 7 days)
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          paymentStatus: { in: ['PAID', 'PENDING'] },
        },
        select: { totalAmount: true, createdAt: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),

      // Recent orders (last 10) — include vendor groups in the same query
      this.prisma.order.findMany({
        where: {},
        include: {
          user: { select: { id: true, name: true } },
          vendorGroups: {
            include: { vendor: { select: { id: true, storeName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // Open disputes (cancelled/refunded orders needing attention)
      this.prisma.order.findMany({
        where: { status: { in: ['CANCELLED', 'REFUNDED'] } },
        select: { id: true, orderNo: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // Pending delivery assignments (orders ready for pickup, no DP assigned yet)
      this.prisma.orderVendorGroup.findMany({
        where: { status: 'READY_FOR_PICKUP' },
        select: {
          id: true,
          orderId: true,
          vendor: { select: { storeName: true } },
          order: { select: { orderNo: true, createdAt: true } },
        },
        orderBy: { order: { createdAt: 'asc' } },
        take: 5,
      }),
    ]);

    // ── Compute today's pulse ──────────────────────────────────────
    const gmvToday = todayOrders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );

    // ── Compute pipeline ───────────────────────────────────────────
    const statusMap: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) {
      statusMap[stage] = 0;
    }
    for (const item of orderStatusCounts) {
      statusMap[item.status] = item._count;
    }
    const pipeline = PIPELINE_STAGES.map((stage) => ({
      stage,
      count: statusMap[stage] || 0,
    }));

    // ── Compute weekly chart ───────────────────────────────────────
    const dayMap: Record<string, { orders: number; revenue: number }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      });
      dayMap[key] = { orders: 0, revenue: 0 };
    }

    for (const o of weeklyRevenue) {
      const d = new Date(o.createdAt);
      const key = d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      });
      if (dayMap[key]) {
        dayMap[key].orders += 1;
        dayMap[key].revenue += Number(o.totalAmount);
      }
    }

    const weeklyOrders = Object.entries(dayMap).map(([day, data]) => ({
      day,
      orders: data.orders,
      revenue: data.revenue,
    }));

    // ── Format pending actions (no N+1 — vendor data included in the query) ──
    const enrichedProductApprovals = pendingProductApprovals.map((p) => ({
      id: p.id,
      name: p.name,
      vendorName: (p as any).vendor?.storeName || 'Unknown',
      createdAt: p.createdAt,
    }));

    // ── Format recent orders (no N+1 — vendor groups included in the query) ──
    const enrichedRecentOrders = (recentOrders as any[]).map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      customerName: order.user?.name || '',
      status: order.status,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt,
      vendors: (order.vendorGroups || [])
        .map((g: any) => g.vendor?.storeName || '')
        .filter(Boolean)
        .join(', '),
    }));

    return {
      // Today's pulse
      gmvToday,
      ordersToday: todayOrders.length,
      newUsersToday: 0,
      activeVendors: approvedVendors,
      activeDeliveryPartners,
      totalDeliveryPartners,

      // Aggregate counts
      totalUsers,
      totalVendors,
      totalProducts,
      totalOrders,

      // Pending actions
      pendingVendorApprovals: pendingVendorApprovals.map((v) => ({
        id: v.id,
        storeName: v.storeName,
        createdAt: v.createdAt,
      })),
      pendingProductApprovals: enrichedProductApprovals,
      pendingKycCount: pendingKyc,
      pendingVendorCount: pendingVendorApprovals.length,

      // Open disputes
      openDisputes: openDisputes.map((d) => ({
        id: d.id,
        orderId: d.id,
        orderNo: d.orderNo || d.id?.slice(0, 8),
        reason: d.status,
        createdAt: d.createdAt,
      })),

      // Pending delivery assignments (need a DP)
      pendingDeliveryAssignments: pendingDeliveryAssignments.map((a) => ({
        id: a.id,
        orderNo: a.order?.orderNo || a.orderId?.slice(0, 8),
        vendorName: a.vendor?.storeName || '',
        createdAt: a.order?.createdAt,
      })),

      // Computed pending count
      pendingActions:
        pendingVendorApprovals.length +
        enrichedProductApprovals.length +
        openDisputes.length +
        pendingDeliveryAssignments.length,

      // Order pipeline
      pipeline,

      // Revenue chart (last 7 days)
      weeklyOrders,

      // Recent orders
      recentOrders: enrichedRecentOrders,
    };
  }

  // ── Platform Settings ──────────────────────────────────────────

  /**
   * Get the current platform settings (single-row table).
   * Auto-seeds a row with defaults if none exists, so the frontend always
   * gets valid settings even before the first admin save.
   */
  async getSettings() {
    let settings = await this.prisma.platformSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.platformSettings.create({ data: {} });
    }
    return settings;
  }

  /**
   * Update platform settings. Only provided fields are changed; omitted
   * fields keep their current values. Returns the full updated settings.
   */
  async updateSettings(data: Record<string, any>) {
    // Ensure a row exists before updating
    let settings = await this.prisma.platformSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.platformSettings.create({ data: {} });
    }

    // Whitelist of allowed field names — any unknown keys are silently ignored
    const allowed = [
      'platformName', 'supportEmail',
      'defaultCommissionPct',
      'codEnabled', 'codCapAmount',
      'minOrderAmount', 'maxOrderAmount',
      'deliveryPartnerPayoutFreq',
      'autoApproveVendors', 'autoApproveProducts',
      'maintenanceMode',
    ];
    const updateData: Record<string, any> = {};
    for (const key of allowed) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    const updated = await this.prisma.platformSettings.update({
      where: { id: settings.id },
      data: updateData,
    });

    return updated;
  }

  async getAnalytics(startDate?: string, endDate?: string, period?: string) {
    const now = new Date();
    let fromDate: Date;

    if (startDate) {
      fromDate = new Date(startDate);
    } else if (period === 'week') {
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 7);
    } else if (period === 'month') {
      fromDate = new Date(now);
      fromDate.setMonth(fromDate.getMonth() - 1);
    } else if (period === 'year') {
      fromDate = new Date(now);
      fromDate.setFullYear(fromDate.getFullYear() - 1);
    } else {
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 30);
    }

    const toDate = endDate ? new Date(endDate) : now;
    toDate.setHours(23, 59, 59, 999);

    const dateWhere = { createdAt: { gte: fromDate, lte: toDate } };

    const [
      totalOrders,
      totalRevenue,
      totalUsers,
      newUsers,
      totalVendors,
      newVendors,
      totalProducts,
      activeProducts,
      topVendors,
      topProducts,
      ordersByStatus,
      revenueByDay,
      paymentMethodSplit,
    ] = await Promise.all([
      this.prisma.order.count({ where: dateWhere }),
      this.prisma.payment.aggregate({
        where: { ...dateWhere, status: 'CAPTURED' },
        _sum: { amount: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: dateWhere }),
      this.prisma.vendor.count({ where: { status: 'APPROVED' } }),
      this.prisma.vendor.count({ where: dateWhere }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { isActive: true, isApproved: true } }),
      this.prisma.vendor.findMany({
        where: { status: 'APPROVED' },
        select: {
          id: true,
          storeName: true,
          storeType: true,
          _count: { select: { products: true, vendorGroups: true } },
          vendorGroups: {
            select: { subtotal: true },
          },
        },
        take: 10,
      }),
      this.prisma.product.findMany({
        where: { isActive: true, isApproved: true },
        select: {
          id: true,
          name: true,
          price: true,
          images: true,
          _count: { select: { orderItems: true, reviews: true } },
          reviews: { select: { rating: true } },
        },
        orderBy: { orderItems: { _count: 'desc' } },
        take: 10,
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: dateWhere,
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['createdAt'],
        where: { ...dateWhere, status: 'CAPTURED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: dateWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const topVendorsFormatted = topVendors.map((v) => ({
      id: v.id,
      storeName: v.storeName,
      storeType: v.storeType,
      productCount: v._count.products,
      orderCount: v._count.vendorGroups,
      totalRevenue: v.vendorGroups.reduce(
        (sum, g) => sum + Number(g.subtotal),
        0,
      ),
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const topProductsFormatted = topProducts.map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      image: p.images[0] || null,
      orderCount: p._count.orderItems,
      reviewCount: p._count.reviews,
      avgRating: p.reviews.length > 0
        ? Number((p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length).toFixed(1))
        : 0,
    }));

    return {
      period: {
        start: fromDate.toISOString(),
        end: toDate.toISOString(),
      },
      overview: {
        totalOrders,
        totalRevenue: Number(revenueByDay.reduce((sum, d) => sum + Number(d._sum.amount || 0), 0)),
        totalUsers,
        newUsers,
        totalVendors,
        newVendors,
        totalProducts,
        activeProducts,
        conversionRate: totalUsers > 0 ? Number(((totalOrders / totalUsers) * 100).toFixed(1)) : 0,
      },
      ordersByStatus: ordersByStatus.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      revenueByDay: revenueByDay.map((d) => ({
        date: d.createdAt,
        revenue: Number(d._sum.amount || 0),
        orders: d._count,
      })),
      paymentMethodSplit: paymentMethodSplit.map((p) => ({
        method: p.method || 'UNKNOWN',
        count: p._count,
        amount: Number(p._sum.amount || 0),
      })),
      topVendors: topVendorsFormatted,
      topProducts: topProductsFormatted,
    };
  }
}
