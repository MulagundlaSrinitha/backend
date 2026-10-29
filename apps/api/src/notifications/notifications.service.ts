import { Injectable, Logger } from '@nestjs/common';
import { DeliveryPartnerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');
  private readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      return { message: 'Notification not found' };
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
    return { message: 'Marked as read' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read' };
  }

  async create(
    userId: string,
    title: string,
    body: string,
    type = 'SYSTEM',
    data?: any,
  ) {
    return this.prisma.notification.create({
      data: { userId, title, body, type, data: data ?? undefined },
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  // ─── Push Notification Helpers ───────────────────────────────────────────

  async registerPushToken(userId: string, expoPushToken: string) {
    const existing = await this.prisma.pushToken.findFirst({
      where: { userId, token: expoPushToken },
    });
    if (existing) {
      return { message: 'Push token already registered' };
    }
    await this.prisma.pushToken.create({
      data: { userId, token: expoPushToken, platform: 'unknown' },
    });
    return { message: 'Push token registered successfully' };
  }

  async unregisterPushToken(userId: string) {
    await this.prisma.pushToken.deleteMany({
      where: { userId },
    });
    return { message: 'Push token unregistered successfully' };
  }

  async sendPushNotification(
    expoPushToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    try {
      const response = await fetch(this.EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: expoPushToken,
          sound: 'default',
          title,
          body,
          data: data || {},
        }),
      });

      const result = (await response.json()) as { errors?: unknown[] };
      if (result.errors) {
        this.logger.error(`Push notification failed: ${JSON.stringify(result.errors)}`);
        return false;
      }
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Push notification error: ${message}`);
      return false;
    }
  }

  /**
   * Send a push notification to all registered tokens for a given user.
   * Returns true if at least one push succeeded.
   */
  public async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    const pushTokens = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (!pushTokens.length) return false;

    const results = await Promise.all(
      pushTokens.map(({ token }) =>
        this.sendPushNotification(token, title, body, data),
      ),
    );
    return results.some(Boolean);
  }

  /**
   * Create an in-app notification record and push it to the user's devices.
   * Returns the created notification record.
   */
  public async notify(
    userId: string,
    title: string,
    body: string,
    type = 'SYSTEM',
    data?: any,
  ) {
    const notification = await this.create(userId, title, body, type, data);
    this.sendPushToUser(userId, title, body, data).catch(() => {});
    return notification;
  }

  // ─── Push-alias: send to all users with a given role ─────────────────────

  private async sendPushToRole(
    role: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    const tokens = await this.prisma.pushToken.findMany({
      where: { user: { role: role as any } },
      select: { token: true },
    });
    if (!tokens.length) return;
    await Promise.all(
      tokens.map(({ token }) =>
        this.sendPushNotification(token, title, body, data).catch(() => {}),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CUSTOMER NOTIFICATION EVENTS (16 events)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 1. Welcome — sent after a new user signs up via phone OTP.
   */
  async sendWelcomeNotification(userId: string) {
    return this.notify(
      userId,
      'Welcome to Next360!',
      'Discover organic, natural & eco-friendly products from local vendors.',
      'WELCOME',
      { screen: 'Home' },
    );
  }

  /**
   * 2–10. Order Status — handles ALL 10 OrderStatus values.
   * Previously only handled CONFIRMED, PACKED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED.
   * Now expanded to cover PLACED, CONFIRMED, PACKED, READY_FOR_PICKUP,
   * ASSIGNED_TO_DELIVERY, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, REFUNDED.
   */
  async sendOrderStatusNotification(
    orderId: string,
    status: string,
    userId: string,
    storeName?: string,
  ) {
    // Create in-app notification
    const { title, body, type } = this.orderStatusMessage(status, orderId, storeName);
    if (!type) return false;

    await this.create(userId, title, body, type, {
      orderId,
      status,
      screen: 'OrderDetail',
    });

    // Push to devices
    return this.sendPushToUser(userId, title, body, {
      orderId,
      status,
      screen: 'OrderDetail',
    });
  }

  private orderStatusMessage(
    status: string,
    orderId: string,
    storeName?: string,
  ): { title: string; body: string; type: string | null } {
    const shortId = orderId.slice(0, 8).toUpperCase();
    switch (status) {
      case 'PLACED':
        return {
          title: 'Order Placed!',
          body: `Your order #${shortId} has been placed successfully.`,
          type: 'ORDER_PLACED',
        };
      case 'CONFIRMED':
        return {
          title: 'Order Confirmed!',
          body: `Your order #${shortId} has been confirmed. Preparing your items.`,
          type: 'ORDER_CONFIRMED',
        };
      case 'PACKED':
        return {
          title: 'Order Packed',
          body: `Your order #${shortId} is being packed at ${storeName || 'the store'}.`,
          type: 'ORDER_PACKED',
        };
      case 'READY_FOR_PICKUP':
        return {
          title: 'Ready for Pickup',
          body: `Your order #${shortId} is now ready for pickup at ${storeName || 'the store'}.`,
          type: 'ORDER_READY',
        };
      case 'ASSIGNED_TO_DELIVERY':
        return {
          title: 'Delivery Partner Assigned',
          body: `A delivery partner has been assigned to your order #${shortId}.`,
          type: 'ORDER_ASSIGNED',
        };
      case 'PICKED_UP':
        return {
          title: 'Order Picked Up',
          body: `Your order #${shortId} has been picked up and is on its way!`,
          type: 'ORDER_PICKED_UP',
        };
      case 'OUT_FOR_DELIVERY':
        return {
          title: 'Out for Delivery',
          body: `Your order #${shortId} is out for delivery! Getting closer to you.`,
          type: 'ORDER_OUT_FOR_DELIVERY',
        };
      case 'DELIVERED':
        return {
          title: 'Order Delivered!',
          body: `Order #${shortId} has been delivered. Enjoy your products! Rate your experience.`,
          type: 'ORDER_DELIVERED',
        };
      case 'CANCELLED':
        return {
          title: 'Order Cancelled',
          body: `Your order #${shortId} has been cancelled.`,
          type: 'ORDER_CANCELLED',
        };
      case 'REFUNDED':
        return {
          title: 'Refund Completed',
          body: `Your refund for order #${shortId} has been processed.`,
          type: 'ORDER_REFUNDED',
        };
      default:
        return { title: '', body: '', type: null };
    }
  }

  /**
   * 11. Payment Success — sent after Razorpay payment is captured.
   */
  async sendPaymentSuccessNotification(userId: string, orderId: string, amount: number) {
    return this.notify(
      userId,
      'Payment Successful!',
      `Your payment of ₹${amount.toFixed(0)} for order #${orderId.slice(0, 8).toUpperCase()} was successful.`,
      'PAYMENT_SUCCESS',
      { orderId, screen: 'OrderDetail' },
    );
  }

  /**
   * 12. Refund Initiated — sent when a refund is initiated for an order.
   */
  async sendRefundInitiatedNotification(userId: string, orderId: string) {
    return this.notify(
      userId,
      'Refund Initiated',
      `A refund has been initiated for order #${orderId.slice(0, 8).toUpperCase()}. It may take 3–5 business days.`,
      'REFUND_INITIATED',
      { orderId, screen: 'OrderDetail' },
    );
  }

  /**
   * 13. Refund Completed — sent when the refund has been fully processed.
   */
  async sendRefundCompletedNotification(userId: string, orderId: string, amount?: number) {
    const amt = amount ? ` of ₹${amount.toFixed(0)}` : '';
    return this.notify(
      userId,
      'Refund Completed',
      `Your refund${amt} for order #${orderId.slice(0, 8).toUpperCase()} has been completed.`,
      'REFUND_COMPLETED',
      { orderId, screen: 'OrderDetail' },
    );
  }

  /**
   * 14. Coupon Received — sent when a coupon is applied or awarded.
   */
  async sendCouponNotification(userId: string, code: string, discount: number) {
    return this.notify(
      userId,
      'Coupon Applied!',
      `Coupon ${code} saved you ₹${discount.toFixed(0)} on this order.`,
      'COUPON',
      { screen: 'Cart' },
    );
  }

  /**
   * 15. Offer Available — sent when a new offer is activated (broadcast to relevant users).
   * This is typically called from a cron job or CMS trigger, not during a request.
   */
  async sendOfferNotification(
    userId: string,
    offerTitle: string,
    offerDescription?: string,
  ) {
    return this.notify(
      userId,
      `New Offer: ${offerTitle}`,
      offerDescription || `Don't miss this offer on Next360!`,
      'OFFER',
      { screen: 'Promos' },
    );
  }

  /**
   * 16. Wishlist Price Drop — sent when a wishlisted product's price drops.
   * This is typically called from a cron job; the product lookup is done here.
   */
  async sendWishlistPriceDropNotification(userId: string, productName: string, newPrice: number) {
    return this.notify(
      userId,
      'Price Drop!',
      `${productName} is now ₹${newPrice.toFixed(0)} — grab it before the price goes back up!`,
      'WISHLIST',
      { screen: 'Wishlist' },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  VENDOR NOTIFICATION EVENTS (9 events)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * V1. New Order Received — sent to vendor when a customer places an order
   * containing their products.
   */
  async sendNewOrderToVendorNotification(
    vendorUserId: string,
    orderId: string,
    orderNo: string,
    customerName?: string,
  ) {
    return this.notify(
      vendorUserId,
      'New Order Received!',
      `Order #${orderNo.slice(0, 8)} placed by ${customerName || 'a customer'}. Review and accept it now.`,
      'NEW_ORDER',
      { orderId, screen: 'Orders', tab: 'Orders' },
    );
  }

  /**
   * V2. Vendor Order Cancelled — sent when a vendor's order group is cancelled.
   */
  async sendVendorOrderCancelledNotification(
    vendorUserId: string,
    orderId: string,
    orderNo: string,
  ) {
    return this.notify(
      vendorUserId,
      'Order Cancelled',
      `Order #${orderNo.slice(0, 8)} containing your products has been cancelled.`,
      'ORDER_CANCELLED',
      { orderId, screen: 'Orders' },
    );
  }

  /**
   * V3. Low Stock Alert — sent to vendor when a product's stock drops below threshold.
   */
  async sendLowStockNotification(
    vendorUserId: string,
    productName: string,
    currentStock: number,
    threshold: number,
  ) {
    return this.notify(
      vendorUserId,
      'Low Stock Alert',
      `"${productName}" has only ${currentStock} units left (threshold: ${threshold}). Restock soon!`,
      'LOW_STOCK',
      { screen: 'Inventory' },
    );
  }

  /**
   * V4. Out of Stock — sent to vendor when a product reaches 0 stock.
   */
  async sendOutOfStockNotification(vendorUserId: string, productName: string) {
    return this.notify(
      vendorUserId,
      'Out of Stock!',
      `"${productName}" is now out of stock. Update your inventory to avoid missed orders.`,
      'OUT_OF_STOCK',
      { screen: 'Inventory' },
    );
  }

  /**
   * V5. Payment Settled / Payout Processed — sent to vendor.
   */
  async sendVendorPayoutNotification(
    vendorUserId: string,
    amount: number,
    period: string,
  ) {
    return this.notify(
      vendorUserId,
      'Payout Received',
      `₹${amount.toFixed(0)} has been deposited for the period ${period}.`,
      'PAYOUT',
      { screen: 'Payouts' },
    );
  }

  /**
   * V6. New Review Received — sent to vendor when a customer reviews their product.
   */
  async sendNewReviewNotification(
    vendorUserId: string,
    productName: string,
    rating: number,
  ) {
    return this.notify(
      vendorUserId,
      'New Review Received',
      `"${productName}" received a ${rating}-star rating from a customer.`,
      'NEW_REVIEW',
      { screen: 'Reviews' },
    );
  }

  /**
   * V7. Vendor Approved — sent when admin approves the vendor's application.
   */
  async sendVendorApprovedNotification(vendorUserId: string, storeName: string) {
    return this.notify(
      vendorUserId,
      'Store Approved!',
      `Congratulations! "${storeName}" has been approved. Start listing products and receiving orders.`,
      'VENDOR_APPROVED',
      { screen: 'Dashboard' },
    );
  }

  /**
   * V7b. Vendor Rejected — sent when admin rejects the vendor's application.
   */
  async sendVendorRejectedNotification(vendorUserId: string, storeName: string) {
    return this.notify(
      vendorUserId,
      'Application Not Approved',
      `Thank you for your interest in joining Next360. Unfortunately, "${storeName}" was not approved at this time. Please contact support for more details.`,
      'VENDOR_REJECTED',
      { screen: 'Support' },
    );
  }

  /**
   * V8. Vendor Suspended — sent when admin suspends the vendor.
   */
  async sendVendorSuspendedNotification(vendorUserId: string, storeName: string) {
    return this.notify(
      vendorUserId,
      'Store Suspended',
      `"${storeName}" has been suspended. Please contact support for details.`,
      'VENDOR_SUSPENDED',
      { screen: 'Support' },
    );
  }

  /**
   * V8b. Vendor KYC Document Approved — sent when admin approves one of the
   * vendor's individual KYC documents (not the whole vendor).
   */
  async sendVendorKycDocumentApprovedNotification(vendorUserId: string, documentLabel: string) {
    return this.notify(
      vendorUserId,
      'Document Approved',
      `Your ${documentLabel} has been verified.`,
      'VENDOR_KYC_DOCUMENT_APPROVED',
      { screen: 'Store' },
    );
  }

  /**
   * V8c. Vendor KYC Document Rejected — sent when admin rejects one of the
   * vendor's individual KYC documents, prompting resubmission.
   */
  async sendVendorKycDocumentRejectedNotification(
    vendorUserId: string,
    documentLabel: string,
    rejectionReason?: string,
  ) {
    return this.notify(
      vendorUserId,
      'Document Rejected',
      `Your ${documentLabel} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''} Please upload a fresh copy.`,
      'VENDOR_KYC_DOCUMENT_REJECTED',
      { screen: 'Store' },
    );
  }

  /**
   * V8d. Vendor KYC Submitted — confirms to the vendor that their documents
   * were submitted and are awaiting admin review.
   */
  async sendVendorKycSubmittedNotification(vendorUserId: string) {
    return this.notify(
      vendorUserId,
      'Verification Submitted',
      'Your KYC documents have been submitted for review. We will notify you once verified.',
      'VENDOR_KYC_SUBMITTED',
      { screen: 'Store' },
    );
  }

  async sendDeliveryPartnerKycApprovedNotification(userId: string) {
    return this.notify(
      userId,
      'KYC Verified',
      'Your identity verification has been approved. You can now start accepting deliveries.',
      'DP_KYC_APPROVED',
      { screen: 'Home' },
    );
  }

  async sendDeliveryPartnerKycRejectedNotification(userId: string, rejectionReason?: string) {
    return this.notify(
      userId,
      'KYC Not Approved',
      `Your identity verification was not approved.${rejectionReason ? ` Reason: ${rejectionReason}` : ''} Please resubmit your documents.`,
      'DP_KYC_REJECTED',
      { screen: 'Profile' },
    );
  }

  /**
   * V9. Document Expiry Reminder — sent to vendor when KYC documents are expiring.
   * This is typically called from a cron job, not during a request.
   */
  async sendDocumentExpiryNotification(vendorUserId: string, documentType: string) {
    return this.notify(
      vendorUserId,
      'Document Expiring Soon',
      `Your ${documentType} is about to expire. Please upload a fresh copy to avoid account suspension.`,
      'DOCUMENT_EXPIRY',
      { screen: 'Settings' },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DELIVERY PARTNER NOTIFICATION EVENTS (6 events)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * D1. New Delivery Request — sent to DP when a vendor marks an order ready for pickup.
   */
  async sendNewDeliveryRequestNotification(
    dpUserId: string,
    orderId: string,
    storeName: string,
    storeType: string,
    orderVendorGroupId?: string,
  ) {
    return this.notify(
      dpUserId,
      'New Delivery Available!',
      `Order from ${storeName} (${storeType}) is ready for pickup. Tap to accept.`,
      'NEW_DELIVERY',
      { orderId, orderVendorGroupId, screen: 'NewOrders' },
    );
  }

  /**
   * D0. New-order fan-out — notifies every AVAILABLE delivery partner in a
   * zone that a vendor group is ready for pickup. Partners claim from the
   * shared queue (first-come-first-served), so the push is a heads-up, not a
   * reservation. The payload carries BOTH the parent orderId (used by the
   * verify-pickup/start-transit/deliver endpoints) and the orderVendorGroupId
   * (used to deep-link into the app's group-scoped screens).
   */
  async notifyAvailablePartnersInZone(
    zoneId: string,
    opts: {
      orderId: string;
      orderVendorGroupId: string;
      orderNumber?: string;
      storeName: string;
      storeType: string;
    },
  ) {
    const partners = await this.prisma.deliveryPartner.findMany({
      where: {
        zoneId,
        status: DeliveryPartnerStatus.AVAILABLE,
        user: { isActive: true },
      },
      select: { userId: true },
    });
    if (!partners.length) return 0;

    const results = await Promise.all(
      partners.map(({ userId }) =>
        this.sendNewDeliveryRequestNotification(
          userId,
          opts.orderId,
          opts.storeName,
          opts.storeType,
          opts.orderVendorGroupId,
        ).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to send new-delivery notification to partner ${userId}: ${message}`,
          );
          return null;
        }),
      ),
    );
    return results.filter(Boolean).length;
  }

  /**
   * D2. Pickup Reminder — sent when the DP has been assigned but hasn't picked up.
   */
  async sendPickupReminderNotification(dpUserId: string, orderId: string) {
    return this.notify(
      dpUserId,
      'Pickup Reminder',
      `Don't forget to pick up order #${orderId.slice(0, 8).toUpperCase()} from the store.`,
      'PICKUP_REMINDER',
      { orderId, screen: 'ActiveDelivery' },
    );
  }

  /**
   * D3. Customer Not Reachable — sent to admin when a DP reports a failed delivery.
   */
  async sendCustomerNotReachableAlert(adminUserId: string, orderId: string, reason: string) {
    return this.notify(
      adminUserId,
      'Delivery Issue Reported',
      `Delivery failed for order #${orderId.slice(0, 8).toUpperCase()}: ${reason}. Review and take action.`,
      'DELIVERY_ISSUE',
      { orderId, screen: 'Disputes' },
    );
  }

  /**
   * D4. Delivery Completed — sent to DP and customer when order is delivered.
   */
  async sendDeliveryCompletedNotification(deliveryPartnerUserId: string, orderId: string) {
    return this.notify(
      deliveryPartnerUserId,
      'Delivery Complete!',
      `Order #${orderId.slice(0, 8).toUpperCase()} delivered successfully. Great job!`,
      'DELIVERY_COMPLETE',
      { orderId, screen: 'History' },
    );
  }

  /**
   * D5. Daily Earnings — sent to DP with their day's earnings.
   * This is typically called from a scheduled job.
   */
  async sendDailyEarningsNotification(deliveryPartnerUserId: string, totalEarnings: number, deliveriesCount: number) {
    return this.notify(
      deliveryPartnerUserId,
      'Today\'s Earnings',
      `You earned ₹${totalEarnings.toFixed(0)} from ${deliveriesCount} deliveries today!`,
      'DAILY_EARNINGS',
      { screen: 'Earnings' },
    );
  }

  /**
   * D6. Weekly Incentives — sent to DP with their weekly bonus/incentive summary.
   */
  async sendWeeklyIncentiveNotification(deliveryPartnerUserId: string, bonusAmount: number, totalDeliveries: number) {
    return this.notify(
      deliveryPartnerUserId,
      'Weekly Incentive!',
      `You earned a bonus of ₹${bonusAmount.toFixed(0)} for ${totalDeliveries} deliveries this week. Keep it up!`,
      'WEEKLY_INCENTIVE',
      { screen: 'Earnings' },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ADMIN NOTIFICATION EVENTS (8 events)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * A1. New Vendor Registration — sent to all admins when a vendor registers.
   */
  async sendAdminNewVendorAlert(storeName: string) {
    return this.sendPushToRole(
      'ADMIN',
      'New Vendor Registration',
      `"${storeName}" has registered and needs review.`,
      { screen: 'Vendors' },
    );
  }

  /**
   * A2. New Delivery Partner Registration — sent to all admins.
   */
  async sendAdminNewDpAlert(driverName: string) {
    return this.sendPushToRole(
      'ADMIN',
      'New Delivery Partner',
      `${driverName} has registered as a delivery partner and needs KYC review.`,
      { screen: 'DeliveryPartners' },
    );
  }

  /**
   * A3. Vendor Document Pending — sent when a vendor submits KYC documents.
   */
  async sendAdminKycPendingAlert(vendorName: string, documentType: string) {
    await this.sendPushToRole(
      'ADMIN',
      'KYC Document Pending Review',
      `${vendorName} submitted ${documentType} for verification.`,
      { screen: 'Vendors' },
    );
    // Also create an in-app notification for each admin user
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'KYC Document Pending Review',
          `${vendorName} submitted ${documentType} for verification.`,
          'KYC_PENDING',
          { screen: 'Vendors' },
        ),
      ),
    );
  }

  /**
   * A4. Large Refund Alert — sent when a refund over a threshold is initiated.
   */
  async sendAdminLargeRefundAlert(orderId: string, amount: number, customerName?: string) {
    const shortId = orderId.slice(0, 8).toUpperCase();
    await this.sendPushToRole(
      'ADMIN',
      'Large Refund Requires Review',
      `Refund of ₹${amount.toFixed(0)} for order #${shortId} (${customerName || 'Unknown'}) needs approval.`,
      { orderId, screen: 'Orders' },
    );
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'Large Refund Requires Review',
          `Refund of ₹${amount.toFixed(0)} for order #${shortId} (${customerName || 'Unknown'}) needs approval.`,
          'LARGE_REFUND',
          { orderId, screen: 'Orders' },
        ),
      ),
    );
  }

  /**
   * A5. Payment Failure Alert — sent to admins when a payment fails repeatedly.
   */
  async sendAdminPaymentFailedAlert(orderId: string, reason?: string) {
    await this.sendPushToRole(
      'ADMIN',
      'Payment Failure',
      `Payment for order #${orderId.slice(0, 8).toUpperCase()} failed: ${reason || 'Unknown error'}.`,
      { orderId, screen: 'Orders' },
    );
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'Payment Failure',
          `Payment for order #${orderId.slice(0, 8).toUpperCase()} failed: ${reason || 'Unknown error'}.`,
          'PAYMENT_FAILURE',
          { orderId, screen: 'Orders' },
        ),
      ),
    );
  }

  /**
   * Customer Payment Failed — sent when a customer's payment fails.
   * Mirrors sendPaymentSuccessNotification but for the failure case.
   */
  async sendPaymentFailedNotification(userId: string, orderId: string, reason?: string) {
    return this.notify(
      userId,
      'Payment Failed',
      `Payment for order #${orderId.slice(0, 8).toUpperCase()} failed${reason ? ': ' + reason : ''}. Please try again or use a different payment method.`,
      'PAYMENT_FAILED',
      { orderId, screen: 'Cart' },
    );
  }

  /**
   * A6. Server Error Alert — sent via the exception filter for critical errors.
   */
  async sendAdminServerErrorAlert(errorMessage: string, path?: string) {
    await this.sendPushToRole(
      'ADMIN',
      'Server Error',
      `${errorMessage}${path ? ` at ${path}` : ''}`,
      { screen: '' },
    );
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'Server Error',
          `${errorMessage}${path ? ` at ${path}` : ''}`,
          'SERVER_ERROR',
          {},
        ),
      ),
    );
  }

  /**
   * A7. Inventory Alert — sent to admins when a vendor's inventory drops critical.
   */
  async sendAdminInventoryAlert(vendorName: string, lowStockCount: number) {
    await this.sendPushToRole(
      'ADMIN',
      'Inventory Alert',
      `${vendorName} has ${lowStockCount} products running low on stock.`,
      { screen: 'Inventory' },
    );
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'Inventory Alert',
          `${vendorName} has ${lowStockCount} products running low on stock.`,
          'INVENTORY_ALERT',
          { screen: 'Inventory' },
        ),
      ),
    );
  }

  /**
   * A8. Daily Sales Report — sent to admins with a daily summary.
   * This is typically called from a scheduled cron job.
   */
  async sendAdminDailySalesReport(
    totalOrders: number,
    totalRevenue: number,
    newUsers: number,
  ) {
    await this.sendPushToRole(
      'ADMIN',
      'Daily Sales Report',
      `📊 ${totalOrders} orders | ₹${totalRevenue.toFixed(0)} revenue | ${newUsers} new users today.`,
      { screen: 'Dashboard' },
    );
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await Promise.all(
      adminUsers.map((admin) =>
        this.create(
          admin.id,
          'Daily Sales Report',
          `📊 ${totalOrders} orders | ₹${totalRevenue.toFixed(0)} revenue | ${newUsers} new users today.`,
          'DAILY_REPORT',
          { screen: 'Dashboard' },
        ),
      ),
    );
  }

  // ─── Admin broadcast utility (for backward compatibility) ────────────────

  async getAllPushTokens(role?: string) {
    const where: any = {};
    if (role) {
      where.user = { role };
    }

    const tokens = await this.prisma.pushToken.findMany({
      where,
      include: { user: { select: { id: true, role: true } } },
    });

    return tokens.map(t => ({ userId: t.user.id, token: t.token, role: t.user.role }));
  }

  // ─── Admin Broadcast ────────────────────────────────────────────────────

  async broadcast(dto: {
    title: string;
    body: string;
    type?: string;
    targetRole?: string;
  }) {
    const type = dto.type || 'BROADCAST';
    const targetRole = dto.targetRole || 'ALL';

    const where: any = {};
    if (targetRole !== 'ALL') {
      where.role = targetRole;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
    });

    let createdCount = 0;
    let pushSentCount = 0;

    for (const user of users) {
      await this.create(user.id, dto.title, dto.body, type, { broadcast: true });
      createdCount++;

      const pushResult = await this.sendPushToUser(user.id, dto.title, dto.body, { broadcast: true });
      if (pushResult) pushSentCount++;
    }

    return {
      message: `Broadcast sent to ${users.length} users (${pushSentCount} push notifications delivered)`,
      totalTargeted: users.length,
      notificationsCreated: createdCount,
      pushDelivered: pushSentCount,
    };
  }
}
