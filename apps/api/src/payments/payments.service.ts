import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionService } from '../commission/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { RazorpayService } from '../razorpay/razorpay.service';
import {
  CreateRazorpayOrderDto,
  VerifyPaymentDto,
  RazorpayWebhookDto,
} from './dto/create-razorpay-order.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionService: CommissionService,
    private readonly notificationsService: NotificationsService,
    private readonly queueService: QueueService,
    private readonly razorpayService: RazorpayService,
  ) {}

  isConfigured(): boolean {
    return this.razorpayService.isConfigured();
  }

  /**
   * Master switch for the COD-only MVP. RAZORPAY_ENABLED must be explicitly
   * set to true AND keys configured before any online-payment path runs.
   */
  private isRazorpayEnabled(): boolean {
    return process.env.RAZORPAY_ENABLED === 'true' && this.isConfigured();
  }

  /**
   * Create a Razorpay order for the given internal order.
   *
   * Uses pg_advisory_xact_lock to serialize concurrent requests for the same
   * order. Without this, two concurrent calls can both pass the
   * paymentStatus=PENDING check, both create Razorpay orders, and the second
   * overwrites razorpayOrderId — orphaning the first. If the user pays the
   * orphaned order, the webhook finds no matching Payment record and returns
   * 200, causing permanent revenue loss.
   *
   * The advisory lock holds a DB connection during the Razorpay SDK call.
   * This is acceptable for MVP (Razorpay responds in 1-3s). For production
   * at scale, consider moving the Razorpay call outside with a Redis lock.
   */
  async createRazorpayOrder(userId: string, dto: CreateRazorpayOrderDto) {
    // COD-only MVP (2026-09): Razorpay disabled by default. Flip with
    // RAZORPAY_ENABLED=true once keys + Route vendor KYC are ready (Risk #1).
    // Guard is runtime-conditional so the settlement implementation below
    // stays type-checked and a re-enable is a config change, not a code edit.
    if (!this.isRazorpayEnabled()) {
      throw new HttpException(
        'Online payments are disabled. Please use Cash on Delivery (COD).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!this.isConfigured()) {
      throw new HttpException(
        'Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Advisory lock: serialize all createRazorpayOrder calls for this orderId.
      // This prevents two concurrent requests from both creating Razorpay orders.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `pay:${dto.orderId}`,
      );

      // Re-fetch order INSIDE the lock for fresh state
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.userId !== userId) throw new BadRequestException('Access denied');
      if (order.paymentMethod !== 'RAZORPAY') {
        throw new BadRequestException('This order does not use Razorpay payment');
      }
      if (order.paymentStatus !== 'PENDING') {
        throw new BadRequestException('Payment already processed for this order');
      }

      // If razorpayOrderId already set by a concurrent request (edge case),
      // find the existing PENDING payment and return it instead of creating
      // a new Razorpay order.
      if (order.razorpayOrderId) {
        const existingPayment = await tx.payment.findFirst({
          where: { orderId: order.id, status: 'PENDING' },
        });
        if (existingPayment) {
          return {
            key: this.razorpayService.getKeyId(),
            amount: Number(order.totalAmount) * 100,
            currency: 'INR',
            order_id: order.razorpayOrderId,
            receipt: order.orderNo,
          };
        }
      }

      // Create Razorpay order (amount in paise)
      const amountInPaise = Math.round(Number(order.totalAmount) * 100);

      const razorpayOrder = await this.razorpayService.getClient().orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order.orderNo,
        notes: {
          orderId: order.id,
          userId: order.userId,
        },
      });

      // Atomic: update order, clean orphaned PENDING payments, create new Payment
      await tx.order.update({
        where: { id: order.id },
        data: { razorpayOrderId: razorpayOrder.id },
      });

      await tx.payment.deleteMany({
        where: { orderId: order.id, status: 'PENDING' },
      });

      await tx.payment.create({
        data: {
          orderId: order.id,
          razorpayOrderId: razorpayOrder.id,
          amount: order.totalAmount,
          status: 'PENDING',
        },
      });

      return {
        key: this.razorpayService.getKeyId(),
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        order_id: razorpayOrder.id,
        receipt: razorpayOrder.receipt,
      };
    });
  }

  /**
   * Verify a Razorpay payment signature after successful payment on the client side.
   */
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    if (!this.isRazorpayEnabled()) {
      throw new HttpException(
        'Online payments are disabled. Please use Cash on Delivery (COD).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Verify signature
    const body = dto.razorpayOrderId + '|' + dto.razorpayPaymentId;

    if (!this.razorpayService.verifyPaymentSignature(body, dto.razorpaySignature)) {
      throw new BadRequestException('Invalid payment signature');
    }

    // Find the order
    const order = await this.prisma.order.findFirst({
      where: { razorpayOrderId: dto.razorpayOrderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new BadRequestException('Access denied');

    // CAS: atomically transition PENDING → CAPTURED.
    // If count=0, the payment was already captured (by webhook or duplicate call).
    // We still update the order, but skip the notification to avoid duplicates.
    const claim = await this.prisma.payment.updateMany({
      where: {
        razorpayOrderId: dto.razorpayOrderId,
        status: 'PENDING',
      },
      data: {
        razorpayPaymentId: dto.razorpayPaymentId,
        status: 'CAPTURED',
      },
    });

    const isFirstCapture = claim.count > 0;

    // Update order status (idempotent — PAID is always correct if signature is valid)
    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'PAID' },
    });

    // Send payment success notification only on the first PENDING→CAPTURED
    // transition. Duplicate verifyPayment calls (or webhook arriving after
    // verify) will have count=0 and skip the notification.
    if (isFirstCapture) {
      try {
        await this.notificationsService.sendPaymentSuccessNotification(
          order.userId,
          order.id,
          Number(order.totalAmount),
        );
      } catch (error: any) {
        this.logger.error(`Payment success notification failed: ${error.message}`);
      }
    }

    return { success: true, message: 'Payment verified successfully' };
  }

  /**
   * Handle Razorpay webhook events (payment captured, failed, etc.)
   */
  async handleWebhook(webhookDto: RazorpayWebhookDto) {
    if (!this.isRazorpayEnabled()) {
      throw new HttpException(
        'Online payments are disabled. Webhooks not accepted.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const event = webhookDto.event;

    switch (event) {
      case 'payment.captured': {
        const payment = webhookDto.payload.payment?.entity;
        if (!payment) throw new BadRequestException('Invalid webhook payload');

        const order = await this.prisma.order.findFirst({
          where: { razorpayOrderId: payment.order_id },
        });
        if (!order) {
          this.logger.warn(
            `payment.captured webhook — order not found for razorpayOrderId ${payment.order_id}. ` +
            `Returning 200 to stop retries (order may have been deleted or this is a test event).`,
          );
          return { received: true, status: 'order_not_found' };
        }

        // Verify the captured amount matches the order total.
        // Razorpay standard checkout enforces exact amount for domestic INR,
        // but this is a defense-in-depth check against API-level manipulation
        // or Razorpay misconfiguration.
        const expectedAmountPaise = Math.round(Number(order.totalAmount) * 100);
        if (payment.amount !== expectedAmountPaise) {
          this.logger.error(
            `payment.captured amount mismatch — order ${order.id}: expected ${expectedAmountPaise} paise, got ${payment.amount} paise`,
          );
          return { received: true, status: 'amount_mismatch' };
        }

        await this.prisma.$transaction([
          this.prisma.payment.updateMany({
            where: { razorpayOrderId: payment.order_id },
            data: {
              razorpayPaymentId: payment.id,
              status: 'CAPTURED',
              method: payment.method,
            },
          }),
          this.prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus: 'PAID' },
          }),
        ]);

        // Calculate commissions — if this fails, the payment is already
        // captured but Route transfers won't be initiated. Razorpay will
        // retry the webhook, which will re-attempt commission calculation.
        // We catch errors here to avoid blocking the webhook response,
        // which would cause infinite Razorpay retries.
        try {
          await this.commissionService.calculateCommissions(order.id);
        } catch (commissionError: any) {
          this.logger.error(
            `Commission calculation failed for order ${order.id}: ${commissionError?.message || commissionError}. ` +
            `Payment is captured. Route transfers will be attempted on webhook retry.`,
          );
          // Return success to Razorpay — the webhook will be retried and
          // commission calculation will be re-attempted on retry.
          return { received: true, status: 'captured', commissionError: true };
        }

        const fullOrder = await this.prisma.order.findUnique({
          where: { id: order.id },
          include: {
            vendorGroups: {
              include: {
                vendor: {
                  select: {
                    id: true,
                    razorpayAccountId: true,
                    commissionPct: true,
                  },
                },
              },
            },
            commissions: true,
          },
        });

        if (!fullOrder) {
          this.logger.error(
            `Order ${order.id} not found after payment capture — aborting Route transfers`,
          );
          return { received: true, status: 'captured', transfersSkipped: true };
        }

        if (!this.isConfigured()) {
          this.logger.warn(
            `Razorpay not configured — skipping Route transfers for order ${order.id}`,
          );
          return { received: true, status: 'captured', transfersSkipped: true };
        }

        for (const group of fullOrder.vendorGroups) {
          const commission = fullOrder.commissions.find(
            (c: any) => c.vendorId === group.vendorId,
          );
          if (!commission) {
            this.logger.warn(
              `Skipping vendor ${group.vendorId} — no commission record for order ${order.id}`,
            );
            continue;
          }

          if (!group.vendor.razorpayAccountId) {
            this.logger.warn(
              `Skipping vendor ${group.vendorId} — no razorpayAccountId linked`,
            );
            continue;
          }

          const subtotal = Number(group.subtotal);
          const commissionAmount = Number(commission.commissionAmount);

          if (subtotal < commissionAmount) {
            this.logger.warn(
              `Skipping vendor ${group.vendorId} — subtotal ${subtotal} < commission ${commissionAmount} for order ${order.id}`,
            );
            continue;
          }

          const payoutAmount = subtotal - commissionAmount;
          const payoutAmountPaise = Math.round(payoutAmount * 100);

          if (payoutAmountPaise <= 0) {
            this.logger.warn(
              `Skipping vendor ${group.vendorId} — payout ${payoutAmount} rounds to 0 paise for order ${order.id}`,
            );
            continue;
          }

          const existingPayout = await this.prisma.payout.findUnique({
            where: {
              orderId_vendorId: {
                orderId: order.id,
                vendorId: group.vendorId,
              },
            },
          });
          if (existingPayout) {
            if (existingPayout.status === 'PENDING') {
              this.logger.error(
                `Payout ${existingPayout.id} stuck as PENDING during dedup — ` +
                `transfer may have succeeded but status update failed. ` +
                `Vendor: ${group.vendorId}, Order: ${order.id}. Manual correction required.`,
              );
            } else {
              this.logger.log(
                `Skipping vendor ${group.vendorId} — dedup: existing Payout ${existingPayout.id} (status: ${existingPayout.status}) for order ${order.id}`,
              );
            }
            continue;
          }

          // Create PENDING payout first — ensures a record exists before
          // the external transfer. If the DB write fails, no money moves.
          let payout;
          try {
            payout = await this.prisma.payout.create({
              data: {
                vendorId: group.vendorId,
                orderId: order.id,
                amount: payoutAmount,
                status: 'PENDING',
              },
            });
          } catch (dbError: any) {
            if (dbError?.code === 'P2002') {
              this.logger.log(
                `Payout skipped — duplicate constraint for vendor: ${group.vendorId}, order: ${order.id}`,
              );
              continue;
            }
            this.logger.error(
              `Payout DB write failed — vendor: ${group.vendorId}, order: ${order.id}, error: ${dbError?.message || dbError}`,
            );
            continue;
          }

          // Execute Razorpay Route transfer
          let transferId: string | null = null;
          let payoutStatus = 'PENDING';

          try {
            const transfer = await this.razorpayService.createVendorTransfer({
              account: group.vendor.razorpayAccountId,
              amountPaise: payoutAmountPaise,
              notes: {
                orderId: order.id,
                vendorId: group.vendorId,
                orderNo: fullOrder.orderNo,
              },
            });
            transferId = transfer?.id || null;
            payoutStatus = 'PROCESSED';
            this.logger.log(
              `Route transfer PROCESSED — order: ${order.id}, vendor: ${group.vendorId}, amount: ₹${payoutAmount}`,
            );
          } catch (error: any) {
            payoutStatus = 'FAILED';
            this.logger.error(
              `Route transfer FAILED — order: ${order.id}, vendor: ${group.vendorId}, amount: ₹${payoutAmount}, error: ${error?.message || error}`,
            );
          }

          // Update payout with final status and transfer ID.
          // Retried up to 3 times — if all retries fail, re-throw so Razorpay
          // retries the webhook. On retry, the dedup check (findUnique on
          // orderId_vendorId) finds the PENDING payout and skips the transfer.
          // The payout update is then retried successfully.
          let payoutUpdateRetries = 3;
          let payoutUpdateFailed = false;
          while (payoutUpdateRetries > 0) {
            try {
              await this.prisma.payout.update({
                where: { id: payout.id },
                data: { status: payoutStatus, transferId },
              });
              this.logger.log(
                `Payout updated — vendor: ${group.vendorId}, order: ${order.id}, status: ${payoutStatus}`,
              );
              if (payoutStatus === 'PROCESSED') {
                await this.prisma.commission.updateMany({
                  where: { orderId: order.id, vendorId: group.vendorId, isPaid: false },
                  data: { isPaid: true, paidAt: new Date() },
                });
              }
              break;
            } catch (dbError: any) {
              payoutUpdateRetries--;
              if (payoutUpdateRetries === 0) {
                payoutUpdateFailed = true;
                this.logger.error(
                  `Payout status update FAILED after 3 retries — payout: ${payout.id}, ` +
                  `status: ${payoutStatus}, transferId: ${transferId}. ` +
                  `Re-throwing to let Razorpay retry the webhook.`,
                );
              } else {
                this.logger.warn(
                  `Payout status update retry (${3 - payoutUpdateRetries}/3) — payout: ${payout.id}, error: ${dbError?.message || dbError}`,
                );
              }
            }
          }

          // If payout update failed, throw to trigger Razorpay webhook retry.
          // On retry, the dedup check finds the PENDING payout and skips
          // re-executing the transfer (no double-payment).
          if (payoutUpdateFailed) {
            throw new Error(
              `Payout ${payout.id} status update failed — transferId: ${transferId}, status: ${payoutStatus}`,
            );
          }
        }

        return { received: true, status: 'captured' };
      }

      case 'payment.failed': {
        const failedPayment = webhookDto.payload.payment?.entity;
        if (!failedPayment) throw new BadRequestException('Invalid webhook payload');

        this.logger.error(
          `payment.failed received — razorpayPaymentId: ${failedPayment.id}, ` +
          `razorpayOrderId: ${failedPayment.order_id}, error: ${failedPayment.error_description || failedPayment.error_reason || 'unknown'}`,
        );

        const failedOrder = await this.prisma.order.findFirst({
          where: { razorpayOrderId: failedPayment.order_id },
        });

        await this.prisma.payment.updateMany({
          where: { razorpayOrderId: failedPayment.order_id },
          data: { status: 'FAILED' },
        });

        await this.prisma.order.updateMany({
          where: { razorpayOrderId: failedPayment.order_id },
          data: { paymentStatus: 'FAILED' },
        });

        if (failedOrder) {
          try {
            await this.notificationsService.sendPaymentFailedNotification(
              failedOrder.userId,
              failedOrder.id,
              failedPayment.error_description || failedPayment.error_reason || 'Payment declined',
            );
          } catch (error: any) {
            this.logger.error(`Payment failed notification error: ${error.message}`);
          }

          try {
            await this.notificationsService.sendAdminPaymentFailedAlert(
              failedOrder.id,
              failedPayment.error_description || failedPayment.error_reason || 'Payment declined',
            );
          } catch (error: any) {
            this.logger.error(`Admin payment failure alert error: ${error.message}`);
          }
        }

        return { received: true, status: 'failed' };
      }

      case 'order.paid': {
        // Handle order-level payment success (for full order payments)
        return { received: true, status: 'order_paid' };
      }

      case 'refund.created': {
        const refundEntity = webhookDto.payload.refund?.entity;
        if (!refundEntity) {
          this.logger.warn('refund.created webhook missing refund entity — ignoring');
          return { received: true, status: 'ignored' };
        }

        this.logger.log(
          `refund.created received — refundId: ${refundEntity.id}, paymentId: ${refundEntity.payment_id}, status: ${refundEntity.status}`,
        );

        return { received: true, status: 'refund_created' };
      }

      case 'refund.processed': {
        const refundEntity = webhookDto.payload.refund?.entity;
        if (!refundEntity) {
          this.logger.warn('refund.processed webhook missing refund entity — ignoring');
          return { received: true, status: 'ignored' };
        }

        this.logger.log(
          `refund.processed received — refundId: ${refundEntity.id}, paymentId: ${refundEntity.payment_id}`,
        );

        const payment = await this.prisma.payment.findFirst({
          where: { razorpayPaymentId: refundEntity.payment_id },
        });

        if (!payment) {
          this.logger.warn(
            `refund.processed — no payment found for razorpayPaymentId ${refundEntity.payment_id} — ignoring`,
          );
          return { received: true, status: 'ignored' };
        }

        // Idempotency: skip if already refunded, but still check for missed
        // Order update. If initiateRefund() crashed after setting Payment to
        // REFUNDED but before updating the Order, we complete that update here.
        if (payment.status === 'REFUNDED') {
          const existingOrder = await this.prisma.order.findUnique({
            where: { id: payment.orderId },
          });

          if (existingOrder && existingOrder.paymentStatus !== 'REFUNDED') {
            await this.prisma.order.update({
              where: { id: existingOrder.id },
              data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
            });
            this.logger.log(
              `refund.processed — crash recovery: completed missed Order update for order ${existingOrder.id}`,
            );
          }

          this.logger.log(
            `refund.processed — payment ${payment.id} already REFUNDED — skipping duplicate`,
          );

          // Always send "Refund Completed" notification here. If initiateRefund()
          // crashed before sending its notification, the customer still gets
          // notified. If initiateRefund() already sent it, this is a harmless
          // duplicate (sendRefundCompletedNotification is idempotent in content).
          if (existingOrder) {
            try {
              await this.notificationsService.sendRefundCompletedNotification(
                existingOrder.userId,
                existingOrder.id,
                Number(existingOrder.totalAmount),
              );
            } catch (error: any) {
              this.logger.error(`Refund completed notification failed: ${error.message}`);
            }
          }

          return { received: true, status: 'already_refunded' };
        }

        const refundOrder = await this.prisma.order.findUnique({
          where: { id: payment.orderId },
        });

        if (!refundOrder) {
          this.logger.error(
            `refund.processed — order ${payment.orderId} not found for payment ${payment.id}`,
          );
          return { received: true, status: 'error' };
        }

        await this.prisma.$transaction([
          this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED' },
          }),
          this.prisma.order.update({
            where: { id: refundOrder.id },
            data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
          }),
        ]);

        try {
          await this.notificationsService.sendRefundCompletedNotification(
            refundOrder.userId,
            refundOrder.id,
            Number(refundOrder.totalAmount),
          );
        } catch (error: any) {
          this.logger.error(`Refund completed notification failed: ${error.message}`);
        }

        return { received: true, status: 'refund_processed' };
      }

      case 'refund.failed': {
        const refundEntity = webhookDto.payload.refund?.entity;
        if (!refundEntity) {
          this.logger.warn('refund.failed webhook missing refund entity — ignoring');
          return { received: true, status: 'ignored' };
        }

        this.logger.error(
          `refund.failed received — refundId: ${refundEntity.id}, paymentId: ${refundEntity.payment_id}, status: ${refundEntity.status}`,
        );

        const payment = await this.prisma.payment.findFirst({
          where: { razorpayPaymentId: refundEntity.payment_id },
        });

        if (!payment) {
          this.logger.warn(
            `refund.failed — no payment found for razorpayPaymentId ${refundEntity.payment_id} — ignoring`,
          );
          return { received: true, status: 'ignored' };
        }

        // Idempotency: if payment was already reverted to CAPTURED (or never
        // moved to REFUNDED), there is nothing to undo.
        if (payment.status !== 'REFUNDED') {
          this.logger.log(
            `refund.failed — payment ${payment.id} status is ${payment.status} (not REFUNDED) — no-op`,
          );
          return { received: true, status: 'no_op' };
        }

        // Revert Payment and Order to reflect the failed refund.
        // Payment: REFUNDED → CAPTURED (money is still captured by Razorpay)
        // Order.paymentStatus: REFUNDED → PAID (money is still captured)
        // Order.status: restored to pre-refund value via previousOrderStatus
        // embedded in Razorpay refund notes by initiateRefund(). Falls back
        // to CRITICAL log + admin notification if notes are absent (refunds
        // initiated before this fix).
        const failedOrder = await this.prisma.order.findUnique({
          where: { id: payment.orderId },
        });

        if (!failedOrder) {
          this.logger.error(
            `refund.failed — order ${payment.orderId} not found for payment ${payment.id}`,
          );
          return { received: true, status: 'error' };
        }

        // Read the previous Order.status from Razorpay refund notes.
        // initiateRefund() embeds this so we can deterministically restore
        // Order.status without a schema column.
        const previousOrderStatus = refundEntity.notes?.previousOrderStatus;

        // Determine whether Order.status can be restored.
        const canRestoreStatus =
          previousOrderStatus &&
          previousOrderStatus !== 'REFUNDED' &&
          previousOrderStatus !== failedOrder.status;

        await this.prisma.$transaction([
          this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'CAPTURED' },
          }),
          this.prisma.order.update({
            where: { id: failedOrder.id },
            data: canRestoreStatus
              ? { paymentStatus: 'PAID', status: previousOrderStatus as any }
              : { paymentStatus: 'PAID' },
          }),
        ]);

        // Determine whether Order.status was restored or stuck
        const statusRestored = previousOrderStatus &&
          previousOrderStatus !== 'REFUNDED' &&
          previousOrderStatus !== failedOrder.status;

        if (statusRestored) {
          this.logger.log(
            `refund.failed — Order ${failedOrder.id} fully reverted: ` +
            `Payment→CAPTURED, paymentStatus→PAID, status→${previousOrderStatus} ` +
            `(restored from Razorpay refund notes). ` +
            `orderId: ${failedOrder.id}, paymentId: ${payment.id}, ` +
            `razorpayRefundId: ${refundEntity.id}`,
          );
        } else {
          // Notes missing or previous status is same as current — cannot restore.
          // This occurs for refunds initiated before this fix was deployed.
          this.logger.error(
            `STUCK STATE: Order ${failedOrder.id} status is ${failedOrder.status} after refund.failed. ` +
            `Payment.reverted→CAPTURED, Order.paymentStatus.reverted→PAID. ` +
            `Order.status NOT reverted — previousOrderStatus ${previousOrderStatus ? `("${previousOrderStatus}") is same as current` : 'missing from Razorpay refund notes (pre-fix refund)'}. ` +
            `Admin must manually update Order.status. ` +
            `orderId: ${failedOrder.id}, paymentId: ${payment.id}, ` +
            `razorpayRefundId: ${refundEntity.id}, refundStatus: ${refundEntity.status}`,
          );
        }

        // Notify admins — message differs based on whether status was restored
        try {
          if (statusRestored) {
            await this.notificationsService.sendAdminPaymentFailedAlert(
              failedOrder.id,
              `Refund failed (${refundEntity.status}). Payment reverted to CAPTURED. ` +
              `Order.status restored to ${previousOrderStatus} from refund notes.`,
            );
          } else {
            await this.notificationsService.sendAdminPaymentFailedAlert(
              failedOrder.id,
              `Refund failed (${refundEntity.status}). Payment reverted to CAPTURED. ` +
              `Order.status stuck at ${failedOrder.status} — requires manual correction.`,
            );
          }
        } catch (error: any) {
          this.logger.error(`Admin refund failure alert error: ${error.message}`);
        }

        return { received: true, status: 'refund_failed_reverted' };
      }

      default:
        return { received: true, event };
    }
  }

  /**
   * List all payments (admin only).
   */
  async listAll() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        order: {
          select: { orderNo: true, userId: true, totalAmount: true },
        },
      },
    });
  }

  /**
   * Get payment history for an order.
   * Ownership check: only the order owner or an admin can view.
   */
  async getPaymentsForOrder(orderId: string, userId: string, role?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    if (role !== 'ADMIN' && order.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * List all payments with filters and pagination (admin).
   */
  async listPayments(query: {
    status?: string;
    vendorId?: string;
    paymentMethod?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.vendorId) {
      where.order = {
        vendorGroups: {
          some: { vendorId: query.vendorId },
        },
      };
    }

    if (query.paymentMethod) {
      where.order = {
        ...where.order,
        paymentMethod: query.paymentMethod,
      };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              totalAmount: true,
              paymentMethod: true,
              paymentStatus: true,
              status: true,
              createdAt: true,
              vendorGroups: {
                select: {
                  vendorId: true,
                  subtotal: true,
                  vendor: {
                    select: {
                      id: true,
                      storeName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Process weekly payouts for delivery partners.
   * Finds all completed deliveries in the given period that have NOT already been
   * paid, groups by partner, and creates one Payout record per partner. Uses the
   * DB-level unique constraint on (deliveryPartnerId, periodStart, periodEnd) for
   * idempotency — rerunning with the same parameters is always safe.
   */
  async processDeliveryPartnerPayouts(periodStart?: string, periodEnd?: string) {
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart
      ? new Date(periodStart)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    const DELIVERY_FEE = 40;

    const completedAssignments = await this.prisma.deliveryAssignment.findMany({
      where: {
        deliveredAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        deliveryPartnerId: true,
        deliveredAt: true,
      },
    });

    if (completedAssignments.length === 0) {
      return { processed: 0, partners: [], periodStart: start, periodEnd: end };
    }

    const partnerTotals = new Map<string, number>();
    for (const a of completedAssignments) {
      partnerTotals.set(
        a.deliveryPartnerId,
        (partnerTotals.get(a.deliveryPartnerId) || 0) + DELIVERY_FEE,
      );
    }

    const results: { partnerId: string; amount: number; status: string }[] = [];

    for (const [partnerId, totalAmount] of partnerTotals) {
      try {
        await this.prisma.payout.create({
          data: {
            deliveryPartnerId: partnerId,
            amount: totalAmount,
            status: 'PENDING',
            periodStart: start,
            periodEnd: end,
          },
        });
        results.push({ partnerId, amount: totalAmount, status: 'CREATED' });
        this.logger.log(
          `Delivery payout created — partner: ${partnerId}, amount: ₹${totalAmount}, period: ${start.toISOString()} – ${end.toISOString()}`,
        );
      } catch (error: any) {
        if (error?.code === 'P2002') {
          results.push({ partnerId, amount: totalAmount, status: 'SKIPPED' });
          this.logger.log(
            `Delivery payout skipped — dedup constraint for partner ${partnerId}, period ${start.toISOString()} – ${end.toISOString()}`,
          );
        } else {
          results.push({ partnerId, amount: totalAmount, status: 'FAILED' });
          this.logger.error(
            `Delivery payout DB write failed — partner: ${partnerId}, error: ${error?.message || error}`,
          );
        }
      }
    }

    return {
      processed: results.filter((r) => r.status === 'CREATED').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      partners: results,
      periodStart: start,
      periodEnd: end,
    };
  }

  /**
   * Get settlement information for a vendor — last paid date, pending amount,
   * payout history summary. Uses parallel queries to avoid N+1.
   */
  async getVendorSettlementInfo(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        storeName: true,
        storeType: true,
        commissionPct: true,
        zoneId: true,
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [lastPaidPayout, pendingAgg, statusBreakdown, recentPayouts] =
      await Promise.all([
        this.prisma.payout.findFirst({
          where: {
            vendorId,
            status: { in: ['PROCESSED', 'PAID'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { amount: true, createdAt: true, paidAt: true },
        }),
        this.prisma.payout.aggregate({
          where: { vendorId, status: { in: ['PENDING', 'SETTLING'] } },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.payout.groupBy({
          by: ['status'],
          where: { vendorId },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.payout.findMany({
          where: { vendorId },
          select: {
            id: true,
            amount: true,
            status: true,
            orderId: true,
            periodStart: true,
            periodEnd: true,
            paidAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

    const totalSettled = Number(
      statusBreakdown
        .filter((s) => s.status === 'PROCESSED' || s.status === 'PAID')
        .reduce((sum, s) => sum + Number(s._sum.amount || 0), 0),
    );

    const totalPending = Number(pendingAgg._sum.amount || 0);
    const pendingCount = pendingAgg._count;

    return {
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        storeType: vendor.storeType,
        commissionPct: vendor.commissionPct,
        zoneId: vendor.zoneId,
      },
      settlement: {
        totalSettled,
        totalPending,
        pendingCount,
        lastPaidAt: lastPaidPayout?.paidAt || lastPaidPayout?.createdAt || null,
        lastPaidAmount: lastPaidPayout ? Number(lastPaidPayout.amount) : null,
      },
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s.status,
        count: s._count,
        totalAmount: Number(s._sum.amount || 0),
      })),
      recentPayouts: recentPayouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        orderId: p.orderId,
        period:
          p.periodStart && p.periodEnd
            ? `${p.periodStart.toISOString().split('T')[0]} – ${p.periodEnd.toISOString().split('T')[0]}`
            : null,
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Auto-settle vendors whose unpaid commission exceeds a threshold.
   * Groups unpaid commissions by vendor, filters by threshold and
   * razorpayAccountId, creates a Payout record per vendor inside an
   * advisory-locked transaction, then queues the settlement job AFTER
   * the transaction commits (no Redis I/O while DB locks are held).
   * Uses PostgreSQL advisory locks per vendor to prevent duplicate
   * payouts under concurrent calls.
   */
  async autoSettleVendors(threshold = 1000) {
    const unpaidCommissions = await this.prisma.commission.groupBy({
      by: ['vendorId'],
      where: { isPaid: false },
      _sum: { commissionAmount: true },
    });

    const vendorIds = unpaidCommissions.map((c) => c.vendorId);

    // Batch-fetch all vendor records to avoid N+1
    const vendors = await this.prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, razorpayAccountId: true },
    });
    const vendorMap = new Map(vendors.map((v) => [v.id, v]));

    // Batch-fetch any existing PENDING or SETTLING payouts for these vendors
    // SETTLING = stuck from a crash — needs re-queue, not a new payout
    const now = new Date();
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = now;

    const existingPayouts = await this.prisma.payout.findMany({
      where: {
        vendorId: { in: vendorIds },
        status: { in: ['PENDING', 'SETTLING'] },
        periodStart,
        periodEnd,
      },
      select: { vendorId: true, id: true, status: true },
    });
    const existingPayoutVendorIds = new Set(
      existingPayouts.map((p) => p.vendorId),
    );

    // Map vendorId → stuck SETTLING payout for re-queue
    const stuckSettlingPayouts = new Map(
      existingPayouts
        .filter((p) => p.status === 'SETTLING')
        .map((p) => [p.vendorId, p.id]),
    );

    const results: {
      vendorId: string;
      amount: number;
      settled: boolean;
      reason?: string;
    }[] = [];

    for (const c of unpaidCommissions) {
      const totalAmount = Number(c._sum.commissionAmount || 0);

      if (totalAmount < threshold) {
        results.push({
          vendorId: c.vendorId,
          amount: totalAmount,
          settled: false,
          reason: 'below_threshold',
        });
        continue;
      }

      const vendor = vendorMap.get(c.vendorId);

      if (!vendor?.razorpayAccountId) {
        results.push({
          vendorId: c.vendorId,
          amount: totalAmount,
          settled: false,
          reason: 'no_razorpay_account',
        });
        continue;
      }

      if (existingPayoutVendorIds.has(c.vendorId)) {
        // If stuck in SETTLING (crashed process), flag for manual review.
        // We CANNOT safely re-queue because Razorpay transfers are NOT
        // idempotent — re-executing the transfer risks double-payment.
        const stuckPayoutId = stuckSettlingPayouts.get(c.vendorId);
        if (stuckPayoutId) {
          this.logger.error(
            `Vendor ${c.vendorId} has stuck SETTLING payout ${stuckPayoutId} ` +
            `— requires manual review. Skipping auto-settle.`,
          );
          results.push({
            vendorId: c.vendorId,
            amount: totalAmount,
            settled: false,
            reason: 'settlement_stuck_manual_review_required',
          });
          continue;
        }

        results.push({
          vendorId: c.vendorId,
          amount: totalAmount,
          settled: false,
          reason: 'duplicate_payout',
        });
        continue;
      }

      // Advisory lock: serialize settlement per vendor to prevent
      // two concurrent calls from creating duplicate payouts + transfers.
      // Transaction covers only DB operations — queue dispatch happens after commit.
      let txResult;
      try {
        txResult = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext($1))`,
            `settle:${c.vendorId}`,
          );

          // In-transaction dedup: re-check after acquiring lock
          const existingPayout = await tx.payout.findFirst({
            where: {
              vendorId: c.vendorId,
              status: 'PENDING',
              periodStart,
              periodEnd,
            },
          });

          if (existingPayout) {
            return { settled: false as const, reason: 'duplicate_payout' as const };
          }

          const payout = await tx.payout.create({
            data: {
              vendorId: c.vendorId,
              amount: totalAmount,
              status: 'PENDING',
              periodStart,
              periodEnd,
            },
          });

          return { settled: true as const, payoutId: payout.id };
        });
      } catch (error: any) {
        this.logger.error(
          `Auto-settlement tx failed for vendor ${c.vendorId}: ${error?.message || error}`,
        );
        results.push({
          vendorId: c.vendorId,
          amount: totalAmount,
          settled: false,
          reason: 'error',
        });
        continue;
      }

      if (!txResult.settled) {
        results.push({ vendorId: c.vendorId, amount: totalAmount, ...txResult });
        continue;
      }

      // Queue dispatch OUTSIDE transaction — advisory lock is released,
      // no DB connection held during Redis I/O.
      try {
        await this.queueService.processSettlement(
          c.vendorId,
          totalAmount,
          txResult.payoutId,
        );
        this.logger.log(
          `Settlement queued — vendor: ${c.vendorId}, payout: ${txResult.payoutId}, amount: ₹${totalAmount}`,
        );
        results.push({ vendorId: c.vendorId, amount: totalAmount, settled: true });
      } catch (queueError: any) {
        // Queue dispatch failed — mark payout as FAILED so it doesn't stay stuck as PENDING
        await this.prisma.payout.update({
          where: { id: txResult.payoutId },
          data: { status: 'FAILED' },
        }).catch(() => {});
        this.logger.error(
          `Settlement queue failed for vendor ${c.vendorId}, payout ${txResult.payoutId}: ${queueError?.message || queueError}`,
        );
        results.push({
          vendorId: c.vendorId,
          amount: totalAmount,
          settled: false,
          reason: 'queue_failed',
        });
      }
    }

    return {
      threshold,
      settled: results.filter((r) => r.settled).length,
      skipped: results.filter((r) => !r.settled).length,
      vendors: results,
    };
  }

  /**
   * Payment analytics — success/failure rates, revenue by method, settlement stats.
   * All queries run in parallel. No N+1.
   */
  async getPaymentAnalytics(startDate?: string, endDate?: string) {
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const paymentWhere: any = {};
    if (startDate || endDate) paymentWhere.createdAt = dateFilter;

    const orderWhere: any = {};
    if (startDate || endDate) orderWhere.createdAt = dateFilter;

    const [
      statusCounts,
      methodCounts,
      revenueByMethod,
      payoutAggregate,
      settledPayouts,
    ] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where: paymentWhere,
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status', 'method'],
        where: paymentWhere,
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.order.groupBy({
        by: ['paymentMethod'],
        where: orderWhere,
        _count: true,
        _sum: { totalAmount: true },
      }),
      this.prisma.payout.aggregate({
        where: {
          vendorId: { not: null },
          ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payout.findMany({
        where: {
          vendorId: { not: null },
          orderId: { not: null },
          paidAt: { not: null },
          status: { in: ['PROCESSED', 'PAID'] },
          ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        select: {
          paidAt: true,
          order: { select: { createdAt: true } },
        },
      }),
    ]);

    const totalPayments = statusCounts.reduce((s, r) => s + r._count, 0);
    const captured =
      statusCounts.find((r) => r.status === 'CAPTURED')?._count || 0;
    const failed =
      statusCounts.find((r) => r.status === 'FAILED')?._count || 0;
    const refunded =
      statusCounts.find((r) => r.status === 'REFUNDED')?._count || 0;
    const successRate =
      totalPayments > 0 ? (captured / totalPayments) * 100 : 0;
    const failureRate =
      totalPayments > 0 ? (failed / totalPayments) * 100 : 0;

    const byMethod: Record<
      string,
      { total: number; amount: number; captured: number; failed: number }
    > = {};
    for (const row of methodCounts) {
      const method = row.method || 'UNKNOWN';
      if (!byMethod[method]) {
        byMethod[method] = { total: 0, amount: 0, captured: 0, failed: 0 };
      }
      byMethod[method].total += row._count;
      byMethod[method].amount += Number(row._sum.amount || 0);
      if (row.status === 'CAPTURED') byMethod[method].captured += row._count;
      if (row.status === 'FAILED') byMethod[method].failed += row._count;
    }

    const revenueMap: Record<string, { orders: number; revenue: number }> = {};
    for (const row of revenueByMethod) {
      const method = row.paymentMethod || 'UNKNOWN';
      revenueMap[method] = {
        orders: row._count,
        revenue: Number(row._sum.totalAmount || 0),
      };
    }

    let avgSettlementHours: number | null = null;
    if (settledPayouts.length > 0) {
      const totalHours = settledPayouts.reduce((sum, p) => {
        if (!p.paidAt || !p.order) return sum;
        return (
          sum +
          (p.paidAt.getTime() - p.order.createdAt.getTime()) /
            (1000 * 60 * 60)
        );
      }, 0);
      avgSettlementHours =
        Math.round((totalHours / settledPayouts.length) * 100) / 100;
    }

    return {
      overview: {
        totalPayments,
        captured,
        failed,
        refunded,
        successRate: Math.round(successRate * 100) / 100,
        failureRate: Math.round(failureRate * 100) / 100,
      },
      revenue: {
        total: revenueByMethod.reduce(
          (s, r) => s + Number(r._sum.totalAmount || 0),
          0,
        ),
        byMethod: revenueMap,
      },
      payouts: {
        totalVendorPayouts: payoutAggregate._count,
        totalVendorPayoutAmount: Number(payoutAggregate._sum.amount || 0),
        avgSettlementHours,
      },
      period: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
    };
  }

  /**
   * Initiate a refund for a payment.
   * Uses CAS (updateMany where status=CAPTURED) to atomically claim the
   * refund right BEFORE calling Razorpay, preventing double-refund on
   * admin double-click or crash recovery.
   */
  async initiateRefund(orderId: string, reason?: string) {
    if (!this.isRazorpayEnabled()) {
      throw new HttpException(
        'Online refunds are disabled in COD-only mode.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    const payment = order.payments.find((p) => p.status === 'CAPTURED');
    if (!payment) {
      // Crash recovery: if payment is already REFUNDED but Order status was not
      // updated (process crashed after Payment CAS + Razorpay call but before
      // order.update), verify Razorpay actually has a refund, then complete
      // the order update. Without this Razorpay check, a crash between Payment
      // CAS and the Razorpay SDK call would leave Payment=REFUNDED with no
      // actual refund — a phantom refund where money is not returned but the
      // system shows REFUNDED with no recovery path.
      const refundedPayment = order.payments.find((p) => p.status === 'REFUNDED');
      if (refundedPayment && order.status !== 'REFUNDED') {
        if (this.isConfigured() && refundedPayment.razorpayPaymentId) {
          try {
            const refunds = await this.razorpayService
              .getClient()
              .payments.fetchMultipleRefund(refundedPayment.razorpayPaymentId);
            const hasValidRefund = refunds?.items?.some(
              (r: any) => r.status !== 'failed',
            );
            if (!hasValidRefund) {
              this.logger.error(
                `CRITICAL: Phantom refund detected — payment ${refundedPayment.id} is REFUNDED ` +
                `but Razorpay has no valid refund for razorpayPaymentId ${refundedPayment.razorpayPaymentId}. ` +
                `Reverting Payment to CAPTURED. orderId: ${orderId}`,
              );
              await this.prisma.payment.update({
                where: { id: refundedPayment.id },
                data: { status: 'CAPTURED' },
              });
              throw new BadRequestException(
                'Payment is marked REFUNDED but Razorpay refund was not found — reverted to CAPTURED. Admin must retry.',
              );
            }
          } catch (error: any) {
            // If Razorpay API call itself fails (network/timeout), do NOT
            // complete the order update — let admin retry. Log for investigation.
            if (error instanceof BadRequestException) throw error;
            this.logger.error(
              `Crash recovery: unable to verify Razorpay refund for payment ${refundedPayment.id}: ${error.message}. ` +
              `orderId: ${orderId}. Admin must verify manually.`,
            );
            throw new BadRequestException(
              'Unable to verify refund status with Razorpay — admin must retry',
            );
          }
        }
        await this.prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
        });
        this.logger.log(
          `initiateRefund crash recovery — orderId: ${orderId}, paymentId: ${refundedPayment.id} ` +
          `already REFUNDED. Razorpay refund verified. Order status updated to REFUNDED.`,
        );
        return { success: true, message: 'Refund already initiated (order status corrected)' };
      }
      throw new BadRequestException('No captured payment found for refund');
    }

    // ── TASK 1 FIX: Pre-CAS guard ──────────────────────────────────────
    // Validate Razorpay availability BEFORE claiming the refund right.
    // Without this check, a CAS transition CAPTURED → REFUNDED could succeed
    // while the Razorpay call is skipped (!isConfigured || !razorpayPaymentId),
    // leaving Payment.status = REFUNDED with no actual Razorpay refund —
    // permanently orphaning the captured funds with no recovery path.
    if (!this.isConfigured() || !payment.razorpayPaymentId) {
      this.logger.error(
        `CRITICAL: Refund blocked — cannot create Razorpay refund. ` +
        `orderId: ${orderId}, paymentId: ${payment.id}, ` +
        `razorpayConfigured: ${this.isConfigured()}, ` +
        `razorpayPaymentId: ${payment.razorpayPaymentId || 'null'}. ` +
        `Admin intervention required.`,
      );
      throw new BadRequestException(
        'Cannot process refund — Razorpay is not configured or payment has no Razorpay payment ID',
      );
    }

    // CAS: atomically claim refund right by transitioning CAPTURED → REFUNDED.
    // If another request already claimed it (count=0), reject.
    const claim = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CAPTURED' },
      data: { status: 'REFUNDED' },
    });

    if (claim.count === 0) {
      throw new BadRequestException('Refund already in progress or completed for this payment');
    }

    // Call Razorpay — if this fails, we revert the CAS claim.
    // The pre-CAS guard above guarantees isConfigured() && razorpayPaymentId
    // are both truthy, so this block will always execute.
    //
    // We embed previousOrderStatus in the refund notes so that if the refund
    // fails (refund.failed webhook), we can deterministically restore Order.status
    // to its pre-refund value without a schema column. Razorpay echoes notes
    // back in the refund webhook payload (refundEntity.notes).
    try {
      await this.razorpayService.getClient().payments.refund(payment.razorpayPaymentId, {
        amount: Math.round(Number(order.totalAmount) * 100),
        notes: {
          reason: reason || 'Customer requested refund',
          previousOrderStatus: order.status,
        },
      });
    } catch (error: any) {
      // Revert the CAS claim so the payment can be retried.
      // Wrapped independently — if the rollback itself throws, the payment
      // would be stuck as REFUNDED with no actual Razorpay refund (R7).
      try {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'CAPTURED' },
        });
      } catch (rollbackError: any) {
        this.logger.error(
          `CRITICAL: Payment ${payment.id} stuck as REFUNDED — rollback failed after Razorpay refund error. ` +
          `orderId: ${orderId}, razorpayPaymentId: ${payment.razorpayPaymentId}, ` +
          `razorpayError: ${error?.message || error}, rollbackError: ${rollbackError?.message || rollbackError}`,
        );
      }
      throw new BadRequestException('Razorpay refund failed');
    }

    // ── TASK 4 FIX: Wire sendAdminLargeRefundAlert ─────────────────────
    // Previously dead code. Alert admins when refund exceeds threshold
    // so high-value refunds get reviewed before settlement.
    const REFUND_ALERT_THRESHOLD = 5000;
    if (Number(order.totalAmount) >= REFUND_ALERT_THRESHOLD) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: order.userId },
          select: { name: true },
        });
        await this.notificationsService.sendAdminLargeRefundAlert(
          orderId,
          Number(order.totalAmount),
          user?.name || undefined,
        );
      } catch (error: any) {
        this.logger.error(`Large refund alert failed: ${error.message}`);
      }
    }

    // Update order status
    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
    });

    // Send "refund initiated" notification — NOT "completed". The Razorpay
    // refund is asynchronous (3-5 business days). "Refund Completed" is sent
    // by the refund.processed webhook after Razorpay confirms settlement.
    try {
      await this.notificationsService.sendRefundInitiatedNotification(
        order.userId,
        orderId,
      );
    } catch (error: any) {
      this.logger.error(`Refund initiated notification failed: ${error.message}`);
    }

    this.logger.log(
      `initiateRefund completed — orderId: ${orderId}, paymentId: ${payment.id}, ` +
      `amount: ${order.totalAmount}, status: PENDING (Razorpay will process in 3-5 business days)`,
    );

    return { success: true, message: 'Refund initiated successfully' };
  }
}
