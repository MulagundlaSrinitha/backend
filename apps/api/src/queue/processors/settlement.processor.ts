import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService } from '../../razorpay/razorpay.service';

@Processor('settlements')
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayService: RazorpayService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'process':
        return this.handleSettlement(job.data);
      default:
        this.logger.warn(`Unknown settlement job type: ${job.name}`);
    }
  }

  /**
   * CAS: transition payout from PENDING → SETTLING.
   * Returns the payout row if CAS succeeded, null otherwise.
   *
   * Special case: if the payout is PENDING but already has a transferId
   * (from a crash between transfer success and status update), we skip the
   * SETTLING transition and return the payout as-is. The caller will
   * complete the status update without re-executing the transfer.
   *
   * If the payout is SETTLING (from a crashed process without a transferId),
   * we return null and flag it for manual review — we cannot determine if
   * the transfer succeeded.
   */
  private async markPayoutSettling(payoutId: string) {
    // First check: is this a PENDING payout with a persisted transferId?
    // This means the transfer succeeded but the status update crashed.
    // We can safely complete the settlement without re-executing the transfer.
    const current = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!current) return null;

    if (current.status === 'PENDING' && current.transferId) {
      this.logger.log(
        `Payout ${payoutId} has persisted transferId=${current.transferId} but status is PENDING ` +
        `(crash between transfer and status update). Completing settlement without re-transfer.`,
      );
      return current;
    }

    // Normal CAS: transition PENDING → SETTLING
    const updated = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'PENDING' },
      data: { status: 'SETTLING' },
    });

    if (updated.count === 1) {
      return await this.prisma.payout.findUnique({ where: { id: payoutId } });
    }

    // CAS failed — check current status
    if (current.status === 'SETTLING') {
      // CRITICAL: Cannot determine if transfer succeeded before the crash.
      // Razorpay transfers are NOT idempotent — retrying risks double-payment.
      // This payout MUST be reviewed manually.
      this.logger.error(
        `Payout ${payoutId} stuck in SETTLING — possible partial transfer. ` +
        `MANUAL REVIEW REQUIRED: check Razorpay dashboard for vendor ${current.vendorId}, ` +
        `amount ₹${current.amount}, transfer notes containing payoutId=${payoutId}.`,
      );
      return null;
    }

    // Terminal state (PROCESSED, PAID, FAILED)
    return null;
  }

  private async markPayoutFailed(payoutId: string, reason: string) {
    await this.prisma.payout.updateMany({
      where: { id: payoutId, status: { in: ['PENDING', 'SETTLING'] } },
      data: { status: 'FAILED' },
    });
    this.logger.error(`Payout ${payoutId} marked FAILED — ${reason}`);
  }

  private async handleSettlement(data: {
    vendorId: string;
    amount: number;
    payoutId: string;
  }) {
    const { vendorId, amount, payoutId } = data;

    this.logger.log(
      `Settlement received — vendor: ${vendorId}, payout: ${payoutId}, amount: ₹${amount}`,
    );

    // 1. CAS: PENDING → SETTLING
    const payout = await this.markPayoutSettling(payoutId);

    if (!payout) {
      // Distinguish between SETTLING (needs manual review) and other states
      const current = await this.prisma.payout.findUnique({
        where: { id: payoutId },
      });

      if (current?.status === 'SETTLING') {
        return {
          processed: false,
          reason: 'settlement_stuck_manual_review_required',
          payoutId,
          vendorId,
        };
      }

      this.logger.warn(
        `Settlement payout ${payoutId} not settleable (status: ${current?.status || 'not_found'})`,
      );
      return { processed: false, reason: 'not_settleable' };
    }

    // 2. Validate Razorpay is configured
    if (!this.razorpayService.isConfigured()) {
      await this.markPayoutFailed(payoutId, 'razorpay not configured');
      return { processed: false, reason: 'razorpay_not_configured' };
    }

    // 3. Load vendor and validate Razorpay account
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, razorpayAccountId: true, storeName: true },
    });

    if (!vendor) {
      await this.markPayoutFailed(payoutId, `vendor ${vendorId} not found`);
      return { processed: false, reason: 'vendor_not_found' };
    }

    if (!vendor.razorpayAccountId) {
      await this.markPayoutFailed(
        payoutId,
        `vendor ${vendorId} (${vendor.storeName}) has no razorpayAccountId`,
      );
      return { processed: false, reason: 'no_razorpay_account' };
    }

    // 4. Convert amount to paise and validate
    const payoutAmountPaise = Math.round(Number(payout.amount) * 100);

    if (payoutAmountPaise <= 0) {
      await this.markPayoutFailed(
        payoutId,
        `amount ₹${payout.amount} rounds to 0 paise`,
      );
      return { processed: false, reason: 'invalid_amount' };
    }

    // 5. Execute Razorpay Route transfer (skip if transferId already persisted
    // from a previous successful transfer that crashed before status update)
    let transferId: string | null = payout.transferId || null;

    if (!transferId) {
      try {
        const transfer = await this.razorpayService.createVendorTransfer({
          account: vendor.razorpayAccountId,
          amountPaise: payoutAmountPaise,
          notes: {
            payoutId,
            vendorId,
            type: 'auto_settlement',
          },
        });

        transferId = transfer?.id || null;

        // CRITICAL: Persist transferId IMMEDIATELY after successful transfer,
        // BEFORE the status update transaction. If the process crashes between
        // transfer success and the $transaction below, BullMQ retries the job
        // but markPayoutSettling() will find PENDING → SETTLING. Without this
        // write, the retry would call createVendorTransfer() again, creating
        // a DOUBLE PAYMENT. With this write, we can detect the transfer
        // already happened by checking for a non-null transferId on the
        // PENDING payout.
        if (transferId) {
          await this.prisma.payout.update({
            where: { id: payoutId },
            data: { transferId },
          });
          this.logger.log(
            `Route transfer succeeded — vendor: ${vendorId}, payout: ${payoutId}, ` +
            `transfer: ${transferId}, amount: ₹${payout.amount}`,
          );
        }
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        const statusCode = error?.statusCode || error?.status || 0;
        const isRetryable =
          statusCode === 0 ||
          statusCode >= 500 ||
          /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(errorMessage);

        if (isRetryable) {
          // Reset SETTLING → PENDING so BullMQ retries
          await this.prisma.payout.updateMany({
            where: { id: payoutId, status: 'SETTLING' },
            data: { status: 'PENDING' },
          });
          this.logger.warn(
            `Settlement transfer retryable — reset to PENDING — vendor: ${vendorId}, payout: ${payoutId}, error: ${errorMessage}`,
          );
          throw new Error(`Retryable transfer failure: ${errorMessage}`);
        }

        // Non-retryable: permanently mark payout as failed
        await this.markPayoutFailed(
          payoutId,
          `transfer failed (non-retryable): ${errorMessage}`,
        );
        this.logger.error(
          `Settlement transfer failed (non-retryable) — vendor: ${vendorId}, payout: ${payoutId}, error: ${errorMessage}`,
        );
        return {
          processed: false,
          reason: 'transfer_failed',
          error: errorMessage,
        };
      }
    } else {
      this.logger.log(
        `Skipping transfer — transferId ${transferId} already persisted for payout ${payoutId}`,
      );
    }

    // 6. Transfer succeeded (or was already persisted) — atomically update payout status + mark commissions paid.
    // transferId was already persisted in step 5, so even if this transaction
    // fails and BullMQ retries, markPayoutSettling() will detect the PENDING
    // payout with a non-null transferId (see step 7 below).
    const [, commissionUpdate] = await this.prisma.$transaction([
      this.prisma.payout.update({
        where: { id: payoutId },
        data: { status: 'PROCESSED', paidAt: new Date() },
      }),
      this.prisma.commission.updateMany({
        where: {
          vendorId,
          isPaid: false,
          createdAt: { lte: payout.createdAt },
        },
        data: { isPaid: true, paidAt: new Date() },
      }),
    ]);

    this.logger.log(
      `Settlement complete — vendor: ${vendorId}, payout: ${payoutId}, ` +
        `transfer: ${transferId}, amount: ₹${payout.amount}, commissionsPaid: ${commissionUpdate.count}`,
    );

    return {
      processed: true,
      vendorId,
      payoutId,
      transferId,
      commissionsPaid: commissionUpdate.count,
    };
  }
}
