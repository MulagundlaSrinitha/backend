import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReturnDto, ProcessReturnDto } from './dto/return.dto';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateReturnDto) {
    // Verify order exists and belongs to user
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Only delivered orders can be returned');
    }

    // TOCTOU FIX: Removed findFirst+create (racy — two concurrent requests
    // can both pass the check and create duplicate returns). Instead, create
    // directly and catch P2002 (unique constraint violation on [orderId, userId]).
    // The schema-level @@unique([orderId, userId]) ensures only one return per
    // order per user at the DB level.
    try {
      const returnRequest = await this.prisma.returnRequest.create({
        data: {
          orderId: dto.orderId,
          userId,
          reason: dto.reason,
          refundAmount: order.totalAmount,
        },
        include: { order: true },
      });

      return returnRequest;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('Return request already exists for this order');
      }
      throw error;
    }
  }

  async findAll(userId: string, role: string, status?: string) {
    const where: any = {};

    if (status) {
      where.status = status;
    }

    // Customers see only their returns; vendors see returns for orders that
    // include one of their vendor groups; admins see everything.
    if (role === 'CUSTOMER') {
      where.userId = userId;
    } else if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      where.order = { vendorGroups: { some: { vendorId: vendor.id } } };
    }

    return this.prisma.returnRequest.findMany({
      where,
      include: {
        order: { select: { id: true, orderNo: true, totalAmount: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId?: string, role?: string) {
    const ret = await this.prisma.returnRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            totalAmount: true,
            status: true,
            userId: true,
            vendorGroups: { select: { vendorId: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!ret) throw new NotFoundException('Return request not found');
    // PII guard: non-admin callers may only read their own returns, except a
    // vendor who fulfills part of the underlying order.
    if (userId && role && role !== 'ADMIN' && ret.userId !== userId) {
      if (role === 'VENDOR') {
        const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
        const member =
          vendor &&
          (ret.order as any)?.vendorGroups?.some((g: any) => g.vendorId === vendor.id);
        if (!member) throw new ForbiddenException('Access denied');
      } else {
        throw new ForbiddenException('Access denied');
      }
    }
    return ret;
  }

  async findRefunds() {
    return this.prisma.returnRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'REFUNDED'] } },
      include: {
        order: { select: { id: true, orderNo: true, totalAmount: true, status: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async process(id: string, dto: ProcessReturnDto) {
    const ret = await this.findOne(id);

    if (ret.status !== 'PENDING') {
      // Crash recovery: if return was approved but the refund/order-update
      // didn't complete (process crashed after CAS but before side effects),
      // retry the incomplete operation. This is safe because:
      // - initiateRefund has its own CAS guard (cannot double-refund)
      // - COD order.update is idempotent (setting REFUNDED when already
      //   REFUNDED is harmless)
      // - The exception is still thrown after recovery so the admin knows
      //   the return was already processed.
      if (ret.status === 'APPROVED' && dto.status === 'APPROVED') {
        const recoveryOrder = await this.prisma.order.findUnique({
          where: { id: ret.orderId },
        });
        if (recoveryOrder && recoveryOrder.status !== 'REFUNDED') {
          try {
            if (recoveryOrder.paymentMethod === 'RAZORPAY') {
              await this.paymentsService.initiateRefund(
                recoveryOrder.id,
                'Return approved (crash recovery)',
              );
            } else if (recoveryOrder.paymentMethod === 'COD') {
              await this.prisma.order.update({
                where: { id: recoveryOrder.id },
                data: { status: 'REFUNDED' },
              });
            }
            this.logger.log(
              `Return ${id} crash recovery: completed deferred refund for order ${recoveryOrder.id}`,
            );
          } catch (error: any) {
            this.logger.error(
              `Return ${id} crash recovery failed: ${error.message}. Admin must retry refund for order ${recoveryOrder.id}.`,
            );
          }
        }
      }
      throw new BadRequestException(`Return is already ${ret.status.toLowerCase()}`);
    }

    const refundAmount = dto.refundAmount ?? ret.refundAmount;

    // ── TASK 3 FIX: Reject partial refunds ──────────────────────────────
    // The Razorpay refund pipeline (initiateRefund) always refunds the full
    // order total. If an admin provides a different refundAmount, the
    // ReturnRequest record would show a partial amount while Razorpay
    // refunds the full amount — a dangerous mismatch. Reject explicitly
    // until partial refund support is implemented end-to-end.
    if (dto.refundAmount !== undefined && dto.refundAmount !== Number(ret.refundAmount)) {
      throw new BadRequestException(
        `Partial refunds are not supported. ` +
        `Refund amount must be ₹${ret.refundAmount} (full order amount). ` +
        `Received: ₹${dto.refundAmount}.`,
      );
    }

    if (dto.status === 'APPROVED') {
      const order = await this.prisma.order.findUnique({
        where: { id: ret.orderId },
        include: {
          vendorGroups: { include: { items: true } },
        },
      });

      if (!order) throw new NotFoundException('Order not found');

      // CAS + stock restoration FIRST — before any irreversible side effects.
      // This prevents the race where a concurrent REJECTED wins the CAS after
      // initiateRefund has already sent the Razorpay refund. Without this order,
      // a race between approve and reject could leave Payment=REFUNDED +
      // ReturnRequest=REJECTED + stock not restored.
      const txResult = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.returnRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPROVED', refundAmount },
        });

        if (claim.count === 0) {
          return { casSucceeded: false as const };
        }

        for (const group of order.vendorGroups) {
          for (const item of group.items || []) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }

        return { casSucceeded: true as const };
      });

      if (!txResult.casSucceeded) {
        this.logger.warn(
          `Return ${id} CAS failed (already processed) — skipping stock restoration`,
        );
        return await this.findOne(id);
      }

      // Side effects AFTER CAS succeeded — only reached when this thread
      // exclusively owns the PENDING → APPROVED transition.
      if (order.paymentMethod === 'RAZORPAY') {
        try {
          await this.paymentsService.initiateRefund(order.id, 'Return approved');
        } catch (error: any) {
          // CAS already succeeded — ReturnRequest=APPROVED, stock restored.
          // The refund failed but can be retried via crash recovery when the
          // admin calls process() again with status='APPROVED'. Log CRITICAL
          // so ops can also intervene manually.
          this.logger.error(
            `CRITICAL: Return ${id} approved but Razorpay refund failed for order ${order.id}: ${error.message}. ` +
            `ReturnRequest=APPROVED, stock restored, Payment=CAPTURED. ` +
            `Retry via crash recovery or admin manual retry.`,
          );
        }
      } else if (order.paymentMethod === 'COD') {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'REFUNDED' },
        });
      }

      // APPROVED+Razorpay: initiateRefund already sent "refund initiated" notification.
      // APPROVED+COD: no refund notification from initiateRefund — send here.
      if (order.paymentMethod === 'COD') {
        try {
          await this.notificationsService.sendRefundInitiatedNotification(ret.userId, ret.orderId);
        } catch (error: any) {
          this.logger.error(`Return approved notification failed: ${error.message}`);
        }
      }

      return await this.findOne(id);
    }

    // REJECTED path — CAS guard prevents overwriting an APPROVED state
    // if two admins process the same return concurrently.
    const rejectClaim = await this.prisma.returnRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', refundAmount },
    });

    if (rejectClaim.count === 0) {
      return await this.findOne(id);
    }

    try {
      await this.notificationsService.sendPaymentFailedNotification(
        ret.userId,
        ret.orderId,
        'Your return request has been rejected.',
      );
    } catch (error: any) {
      this.logger.error(`Return rejected notification failed: ${error.message}`);
    }

    return await this.findOne(id);
  }
}
