import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionService } from '../commission/commission.service';
import { OffersService } from '../offers/offers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ReferralsService } from '../referrals/referrals.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto/order-query.dto';
import { OrderStatus } from '@prisma/client';
import {
  VALID_TRANSITIONS,
  STATUS_RANK,
} from '../common/order-status-transitions';

// Order/delivery status machine (13-state model) — VALID_TRANSITIONS and
// STATUS_RANK live in ../common/order-status-transitions so the orders and
// delivery modules enforce one shared state machine instead of two drifting
// copies. READY_FOR_PICKUP sits between PACKED and ASSIGNED_TO_DELIVERY so the
// vendor has a distinct "ready for pickup" handshake; GOING_TO_PICKUP,
// ARRIVED_AT_PICKUP and ARRIVED_AT_CUSTOMER are the courier-reported legs.

const COD_MAX_AMOUNT = 2000; // ₹2,000 cap for COD orders

function generateOrderNo(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `N360-${timestamp}-${random}`;
}

function generateInvoiceNo(orderId: string): string {
  const year = new Date().getFullYear();
  const shortId = orderId.substring(0, 8).toUpperCase();
  return `INV-${year}-${shortId}`;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionService: CommissionService,
    private readonly offersService: OffersService,
    private readonly notificationsService: NotificationsService,
    private readonly loyaltyService: LoyaltyService,
    private readonly referralsService: ReferralsService,
  ) {}

  /**
   * Create an order from the user's current cart.
   * Groups items by vendor, creates OrderVendorGroup records,
   * validates stock, applies COD cap, clears cart on success.
   */
  async create(userId: string, dto: CreateOrderDto) {
    // Validate address belongs to user
    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');

    // Fetch cart items with product + vendor info
    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId },
      include: {
        product: {
          include: { vendor: true },
        },
      },
    });

    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Authoritative revalidation: vendor eligibility + product purchasability.
    // The cart was built at browse time; approval, active flags, or vendor
    // status may have changed since. Unapproved/inactive/suspended-vendor
    // items must never become orders.
    for (const item of cartItems) {
      if (item.product.vendor.status !== 'APPROVED') {
        throw new BadRequestException(
          `"${item.product.vendor.storeName}" is not currently accepting orders. Please remove its items and try again.`,
        );
      }
      if (!item.product.isActive || !item.product.isApproved) {
        throw new BadRequestException(
          `"${item.product.name}" is not currently available. Please remove it and try again.`,
        );
      }
      if (item.product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${item.product.name}". Available: ${item.product.stock}, requested: ${item.quantity}`,
        );
      }
    }

    // COD pre-check on the undiscounted subtotal (fast fail). The binding
    // check runs again on the final payable after coupons/offers below.
    const subtotal = cartItems.reduce(
      (sum, item) => sum + Number(item.product.price) * item.quantity,
      0,
    );

    if (dto.paymentMethod === 'COD' && subtotal > COD_MAX_AMOUNT) {
      throw new BadRequestException(
        `COD orders are capped at ₹${COD_MAX_AMOUNT}. Please use Razorpay for orders above ₹${COD_MAX_AMOUNT}.`,
      );
    }

    // Mutual exclusion: cannot use both coupon and offer
    if (dto.couponCode && dto.offerId) {
      throw new BadRequestException('Cannot use both a coupon and an offer');
    }

    // Validate coupon if provided
    let discountAmount = 0;
    let appliedCoupon: { id: string; usageLimit: number | null } | null = null;
    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: dto.couponCode.toUpperCase() },
      });
      if (!coupon) throw new NotFoundException('Coupon not found');
      if (!coupon.isActive) throw new BadRequestException('Coupon is expired or inactive');
      if (coupon.expiresAt && new Date() > coupon.expiresAt) {
        throw new BadRequestException('Coupon has expired');
      }
      if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        throw new BadRequestException('Coupon usage limit reached');
      }

      if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
        throw new BadRequestException(
          `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`,
        );
      }

      if (coupon.type === 'PERCENTAGE') {
        discountAmount = (subtotal * Number(coupon.value)) / 100;
        if (coupon.maxDiscount && discountAmount > Number(coupon.maxDiscount)) {
          discountAmount = Number(coupon.maxDiscount);
        }
      } else {
        discountAmount = Number(coupon.value);
      }
      appliedCoupon = { id: coupon.id, usageLimit: coupon.usageLimit };
    }

    // Validate offer if provided
    let offer: any = null;
    if (dto.offerId) {
      offer = await this.offersService.findOne(dto.offerId);
      if (!offer.isActive) {
        throw new BadRequestException('Offer is inactive');
      }
      const now = new Date();
      if (now < offer.startDate || now > offer.endDate) {
        throw new BadRequestException('Offer is not currently valid');
      }
    }

    // Group items by vendor
    const vendorGroups = new Map<string, typeof cartItems>();
    for (const item of cartItems) {
      const vendorId = item.product.vendorId;
      if (!vendorGroups.has(vendorId)) {
        vendorGroups.set(vendorId, []);
      }
      vendorGroups.get(vendorId)!.push(item);
    }

    // Calculate per-vendor-group offer discount
    let offerDiscountAmount = 0;
    if (offer) {
      const matchingSubtotal = Array.from(vendorGroups.values()).reduce(
        (sum, items) => {
          const vendor = items[0].product.vendor;
          const storeTypeMatch = vendor.storeType === offer.storeType;
          const vendorMatch = !offer.vendorId || vendor.id === offer.vendorId;
          if (storeTypeMatch && vendorMatch) {
            return sum + items.reduce(
              (s, item) => s + Number(item.product.price) * item.quantity,
              0,
            );
          }
          return sum;
        },
        0,
      );

      if (offer.discountType === 'PERCENTAGE') {
        offerDiscountAmount = (matchingSubtotal * Number(offer.discountValue)) / 100;
      } else {
        offerDiscountAmount = Math.min(Number(offer.discountValue), matchingSubtotal);
      }
    }

    const totalAmount = Math.max(0, subtotal - discountAmount - offerDiscountAmount);

    // Binding COD check on the final payable (post-discount). The earlier
    // subtotal check is only a fast fail; this is the authoritative gate.
    if (dto.paymentMethod === 'COD' && totalAmount > COD_MAX_AMOUNT) {
      throw new BadRequestException(
        `COD orders are capped at ₹${COD_MAX_AMOUNT} final payable. Please use Razorpay for orders above ₹${COD_MAX_AMOUNT}.`,
      );
    }

    // For COD, automatically confirm the order
    const initialStatus = dto.paymentMethod === 'COD' ? 'CONFIRMED' : 'PLACED';

    // Create order with vendor groups and items in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      // Burn coupon usage inside the transaction so a failed order never
      // consumes it, and concurrent checkouts cannot overshoot the limit.
      if (appliedCoupon) {
        const couponWhere: any = { id: appliedCoupon.id };
        if (appliedCoupon.usageLimit !== null) {
          couponWhere.usedCount = { lt: appliedCoupon.usageLimit };
        }
        const couponBurn = await tx.coupon.updateMany({
          where: couponWhere,
          data: { usedCount: { increment: 1 } },
        });
        if (couponBurn.count === 0) {
          throw new BadRequestException('Coupon usage limit reached');
        }
      }

      const created = await tx.order.create({
        data: {
          orderNo: generateOrderNo(),
          userId,
          addressId: dto.addressId,
          totalAmount,
          paymentMethod: dto.paymentMethod,
          payments:
          dto.paymentMethod === 'COD'
          ? {
            create: {
              amount: totalAmount,
              status: 'PENDING',
              method: 'COD',
            },
          }
          : undefined,
          status: initialStatus,
          notes: dto.notes || null,
          vendorGroups: {
            create: Array.from(vendorGroups.entries()).map(([vendorId, items]) => ({
              vendorId,
              subtotal: items.reduce(
                (sum, item) => sum + Number(item.product.price) * item.quantity,
                0,
              ),
              status: initialStatus,
              items: {
                create: items.map((item) => ({
                  productId: item.product.id,
                  name: item.product.name,
                  priceAtPurchase: item.product.price,
                  quantity: item.quantity,
                })),
              },
            })),
          },
        },
        include: {
          address: true,
          vendorGroups: {
            include: {
              vendor: { select: { id: true, storeName: true } },
              items: {
                include: { product: { select: { id: true, name: true, images: true } } },
              },
            },
          },
        },
      });

      // Decrement stock atomically: only when enough stock remains.
      // The updateMany count check makes concurrent checkouts safe —
      // a lost race fails here instead of driving stock negative.
      for (const item of cartItems) {
        const stockResult = await tx.product.updateMany({
          where: {
            id: item.product.id,
            stock: { gte: item.quantity },
          },
          data: { stock: { decrement: item.quantity } },
        });
        if (stockResult.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for "${item.product.name}". Please review your cart and try again.`,
          );
        }
      }

      // Clear cart
      await tx.cartItem.deleteMany({ where: { userId } });

      return created;
    });

    // For COD orders, trigger commission calculation after the transaction succeeds.
    // Razorpay commissions are calculated in the payment.captured webhook instead.
    if (dto.paymentMethod === 'COD') {
      try {
        await this.commissionService.calculateCommissions(order.id);
      } catch (error: any) {
        this.logger.error(
          `Commission calculation failed for COD order ${order.id}: ${error.message}`,
        );
      }
    }

    // Award loyalty points for this purchase
    try {
      await this.loyaltyService.awardPurchasePoints(
        userId,
        order.id,
        Number(order.totalAmount),
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to award loyalty points for order ${order.id}: ${error.message}`,
      );
    }

    // Process referral reward if this is the user's first purchase
    try {
      await this.referralsService.processReferralReward(userId, order.id);
    } catch (error: any) {
      this.logger.error(
        `Failed to process referral for order ${order.id}: ${error.message}`,
      );
    }

    // Send push notification to the customer about the new order
    try {
      await this.notificationsService.sendOrderStatusNotification(
        order.id,
        order.status,
        userId,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send order notification for order ${order.id}: ${error.message}`,
      );
    }

    // Send push notification to each vendor who has items in this order
    // Uses the dedicated new vendor notification method instead of raw push.
    try {
      const uniqueVendorUserIds = new Set(
        cartItems.map((item) => item.product.vendor.userId),
      );
      for (const vendorUserId of uniqueVendorUserIds) {
        await this.notificationsService.sendNewOrderToVendorNotification(
          vendorUserId,
          order.id,
          order.orderNo,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to send vendor notification for order ${order.id}: ${error.message}`,
      );
    }

    return order;
  }

  /**
   * Get all orders for the current user with pagination.
   * ADMIN sees all orders.
   */
  async findAll(userId: string, role: string, query: OrderQueryDto) {
    const where: any = {};
    if (role !== 'ADMIN') {
      where.userId = userId;
    }
    if (query.status) {
      where.status = query.status;
    }

    if (query.period) {
      const days = parseInt(query.period.replace('d', ''), 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

    where.createdAt = {
      gte: fromDate,
    };
  }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          vendorGroups: {
            include: {
              vendor: { select: { id: true, storeName: true, deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true } },
              items: {
                include: { product: { select: { id: true, name: true, images: true } } },
              },
            },
          },
          address: true,
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
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
   * Get order summary stats for the dashboard.
   */
  async getSummary(userId: string, role: string) {
    const where: any = {};
    if (role !== 'ADMIN') {
      where.userId = userId;
    }

    const [totalOrders, totalRevenue, statusCounts, recentOrders] =
      await this.prisma.$transaction([
        this.prisma.order.count({ where }),
        this.prisma.order.aggregate({
          where: { ...where, paymentStatus: 'PAID' },
          _sum: { totalAmount: true },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where,
          orderBy: { status: 'asc' },
          _count: true,
        }),
        this.prisma.order.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            orderNo: true,
            totalAmount: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      totalOrders,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      statusBreakdown: statusCounts.reduce(
        (acc, curr) => {
          acc[curr.status] = (curr._count as number) || 0;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentOrders,
    };
  }

  /**
   * Get a single order by ID with invoice data.
   */
  async findOne(userId: string, role: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: {
            vendor: { select: { id: true, storeName: true, storeSlug: true, deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true } },
            items: {
              include: { product: { select: { id: true, name: true, images: true } } },
            },
          },
        },
        address: true,
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        commissions: true,
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Access control: user can only see their own orders (except ADMIN)
    if (role !== 'ADMIN' && order.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // For VENDOR role, verify they have items in this order
    if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      const hasItems = order.vendorGroups?.some((g: any) => g.vendorId === vendor.id) ?? false;
      if (!hasItems) throw new ForbiddenException('Access denied');
    }

    // Attach invoice data
    const invoice = this.generateInvoiceData(order);

    return { ...order, invoice };
  }

  /**
   * Generate invoice data for an order.
   */
  private generateInvoiceData(order: any) {
    const items = order.vendorGroups?.flatMap((g: any) =>
      g.items.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.priceAtPurchase),
        total: Number(item.priceAtPurchase) * item.quantity,
        vendor: g.vendor?.storeName || 'Unknown',
      })),
    ) || [];

    const subtotal = items.reduce((sum: number, i: any) => sum + i.total, 0);

    return {
      invoiceNumber: generateInvoiceNo(order.id),
      orderNumber: order.orderNo,
      invoiceDate: order.createdAt,
      customer: order.user
        ? { name: order.user.name, email: order.user.email, phone: order.user.phone }
        : null,
      deliveryAddress: order.address
        ? {
            line1: order.address.line1,
            line2: order.address.line2,
            city: order.address.city,
            state: order.address.state,
            pincode: order.address.pincode,
          }
        : null,
      items,
      subtotal,
      deliveryFee: 0,
      total: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      orderStatus: order.status,
    };
  }

  /**
   * Update order status (status machine with validation).
   */
  async updateStatus(
    userId: string,
    role: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
    vendorGroupId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: { vendor: true, items: true },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    // If targeting a specific vendor group
    if (vendorGroupId) {
      const group = order.vendorGroups.find((g) => g.id === vendorGroupId);
      if (!group) throw new NotFoundException('Vendor group not found');

      // VENDOR can only update their own vendor groups
      if (role === 'VENDOR' && group.vendor.userId !== userId) {
        throw new ForbiddenException('Access denied');
      }

      if (role !== 'ADMIN' && role !== 'VENDOR') {
        throw new ForbiddenException('Only vendors and admins can update order status');
      }

      // Actor authority (FRD §27): vendors own CONFIRM → PACK → READY only.
      // Assignment and everything downstream is Admin/System + Delivery.
      const VENDOR_ALLOWED_TARGETS: OrderStatus[] = [
        OrderStatus.CONFIRMED,
        OrderStatus.PACKED,
        OrderStatus.READY_FOR_PICKUP,
      ];
      if (role === 'VENDOR' && !VENDOR_ALLOWED_TARGETS.includes(dto.status as OrderStatus)) {
        throw new ForbiddenException(
          `Vendors cannot transition to ${dto.status}. Permitted: CONFIRMED, PACKED, READY_FOR_PICKUP.`,
        );
      }

      // Validate status transition
      if (!VALID_TRANSITIONS[group.status]?.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition vendor group from ${group.status} to ${dto.status}`,
        );
      }

      const updatedGroup = await this.prisma.orderVendorGroup.update({
        where: { id: vendorGroupId },
        data: { status: dto.status as OrderStatus },
        include: {
          vendor: { select: { id: true, storeName: true } },
          items: true,
        },
      });

      // Parent aggregation: recompute the parent order status from all groups
      // so mixed states (A DELIVERED, B OUT_FOR_DELIVERY) never leave the
      // parent stale. Most-advanced-active wins; DELIVERED only when all are.
      await this.recomputeParentStatus(orderId);

      // When a group becomes READY_FOR_PICKUP, fan the new-delivery push out
      // to every AVAILABLE partner in the vendor's zone so they can claim it.
      // Partners claim first-come-first-served from the shared queue; the
      // push is a heads-up, never a reservation.
      if (dto.status === OrderStatus.READY_FOR_PICKUP && group.vendor?.zoneId) {
        try {
          await this.notificationsService.notifyAvailablePartnersInZone(
            group.vendor.zoneId,
            {
              orderId,
              orderVendorGroupId: vendorGroupId,
              orderNumber: order.orderNo || orderId,
              storeName: group.vendor.storeName,
              storeType: group.vendor.storeType,
            },
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to notify partners for ready group ${vendorGroupId}: ${error.message}`,
          );
        }
      }

      return updatedGroup;
    }

    // Update the main order status
    if (role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can update order status');
    }

    // Validate transition
    if (!VALID_TRANSITIONS[order.status]?.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${dto.status}`,
      );
    }

    // Auto-update payment status when delivered
    const updateData: any = { status: dto.status as OrderStatus };
    if (dto.status === 'DELIVERED') {
      updateData.paymentStatus = 'PAID';
    }

    // If cancelling, restore stock for all items
    if (dto.status === 'CANCELLED') {
      await this.restoreStock(order.vendorGroups);
    }

    // Send push notification to the customer about the status change
    try {
      await this.notificationsService.sendOrderStatusNotification(
        orderId,
        dto.status,
        order.userId,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send status notification for order ${orderId}: ${error.message}`,
      );
    }

    // If the vendor group is CANCELLED, notify the vendor
    if (dto.status === 'CANCELLED' && vendorGroupId) {
      try {
        const group = order.vendorGroups.find((g: any) => g.id === vendorGroupId);
        if (group?.vendor?.userId) {
          await this.notificationsService.sendVendorOrderCancelledNotification(
            group.vendor.userId,
            orderId,
            order.orderNo || orderId,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to send vendor cancellation notification for order ${orderId}: ${error.message}`,
        );
      }
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        vendorGroups: {
          include: {
            vendor: { select: { id: true, storeName: true } },
            items: true,
          },
        },
        address: true,
      },
    });
  }

  /**
   * Recompute the parent order status from its vendor groups (FRD §29).
   * DELIVERED only when every group is DELIVERED; otherwise the most
   * advanced active group status wins. Fully-cancelled/refunded parents
   * resolve to CANCELLED/REFUNDED; mixed active + cancelled stays active.
   */
  private async recomputeParentStatus(orderId: string) {
    const groups = await this.prisma.orderVendorGroup.findMany({
      where: { orderId },
      select: { status: true },
    });
    if (groups.length === 0) return;

    const rank = STATUS_RANK;

    const statuses = groups.map((g) => g.status as string);
    if (statuses.every((s) => s === OrderStatus.DELIVERED)) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED },
      });
      return;
    }

    const active = statuses.filter(
      (s) => s !== OrderStatus.CANCELLED && s !== OrderStatus.REFUNDED,
    );
    if (active.length === 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: statuses.includes(OrderStatus.REFUNDED)
            ? OrderStatus.REFUNDED
            : OrderStatus.CANCELLED,
        },
      });
      return;
    }

    const top = active.sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: top as OrderStatus },
    });
  }

  /**
   * Restore product stock when order is cancelled.
   */
  private async restoreStock(vendorGroups: any[]) {
    for (const group of vendorGroups) {
      for (const item of group.items || []) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  }

  /**
   * Cancel an order (or specific vendor group within an order).
   * Restores product stock on cancellation.
   */
  async cancel(userId: string, role: string, orderId: string, vendorGroupId?: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: { items: true, vendor: { select: { userId: true } } },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    if (vendorGroupId) {
      const group = order.vendorGroups.find((g) => g.id === vendorGroupId);
      if (!group) throw new NotFoundException('Vendor group not found');

      // Access control: the vendor that owns this group, or an admin — NOT
      // the customer (order.userId), who has no cancel authority once a
      // vendor has confirmed. Cancelling the group is a vendor/admin action.
      if (role !== 'ADMIN' && !(role === 'VENDOR' && group.vendor.userId === userId)) {
        throw new ForbiddenException('Access denied');
      }

      if (group.status !== 'PLACED' && group.status !== 'CONFIRMED') {
        throw new BadRequestException('Cannot cancel vendor group at this stage');
      }

      // Restore stock for items in this group
      for (const item of group.items || []) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      return this.prisma.orderVendorGroup.update({
        where: { id: vendorGroupId },
        data: { status: 'CANCELLED', cancellationReason: reason },
        include: { items: true },
      });
    }

    // Cancel entire order — only the customer who placed it, or an admin
    if (role !== 'ADMIN' && order.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (order.status !== 'PLACED' && order.status !== 'CONFIRMED') {
      throw new BadRequestException('Cannot cancel order at this stage');
    }

    // Restore stock for all items
    await this.restoreStock(order.vendorGroups);

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        vendorGroups: {
          updateMany: {
            where: { status: { in: ['PLACED', 'CONFIRMED'] } },
            data: { status: 'CANCELLED' },
          },
        },
      },
    });
  }

  /**
   * Get ordered list of status changes with timestamps for an order.
   * Uses the Order's createdAt and updatedAt fields to infer the timeline.
   * For full accuracy, a separate StatusLog model would be needed.
   */
  async getOrderStatusTimeline(userId: string, role: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        paymentStatus: true,
        vendorGroups: {
          select: {
            id: true,
            status: true,
            vendorId: true,
          },
        },
        payments: {
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Ownership: timelines expose order/payment/group states.
    if (role !== 'ADMIN' && (order as any).userId !== userId) {
      if (role === 'VENDOR') {
        const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
        const member = vendor && order.vendorGroups?.some((g: any) => (g as any).vendorId === vendor.id);
        if (!member) throw new ForbiddenException('Access denied');
      } else {
        throw new ForbiddenException('Access denied');
      }
    }

    const timeline: Array<{ event: string; timestamp: Date; status: string; groupId?: string }> = [
      {
        event: 'ORDER_PLACED',
        timestamp: order.createdAt,
        status: order.status,
      },
    ];

    if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') {
      const paymentEvent = order.payments[0];
      timeline.push({
        event: order.paymentStatus === 'PAID' ? 'PAYMENT_CAPTURED' : 'PAYMENT_FAILED',
        timestamp: paymentEvent?.createdAt || order.updatedAt,
        status: order.paymentStatus,
      });
    }

    for (const group of order.vendorGroups) {
      timeline.push({
        event: `VENDOR_GROUP_${group.status}`,
        timestamp: order.updatedAt,
        status: group.status,
        groupId: group.id,
      });
    }

    timeline.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return timeline;
  }

  /**
   * Get vendor-specific orders (for vendor dashboard).
   * Resolves the vendor ID from the authenticated user.
   */
  async findVendorOrders(userId: string, query: OrderQueryDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new NotFoundException('Vendor profile not found');

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { vendorId: vendor.id };
    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.orderVendorGroup.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              userId: true,
              status: true,
              createdAt: true,
              paymentMethod: true,
              user: { select: { id: true, name: true, phone: true } },
            },
          },
          items: {
            include: { product: { select: { id: true, name: true, images: true } } },
          },
        },
        orderBy: { order: { createdAt: 'desc' } },
        skip,
        take: limit,
      }),
      this.prisma.orderVendorGroup.count({ where }),
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
}
