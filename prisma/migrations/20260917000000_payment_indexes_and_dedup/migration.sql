-- Merged-team schema completion (harshitha's payment hardening):
-- Payment lookup indexes, Payout transfer reconciliation, dedup uniques
-- that prevent duplicate commissions/returns/partner payouts.

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "transferId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Commission_orderId_vendorId_key" ON "Commission"("orderId", "vendorId");

-- CreateIndex
CREATE INDEX "Payment_razorpayOrderId_idx" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Payment_razorpayPaymentId_idx" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payout_vendorId_status_idx" ON "Payout"("vendorId", "status");

-- CreateIndex
CREATE INDEX "Payout_transferId_idx" ON "Payout"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_deliveryPartnerId_periodStart_periodEnd_key" ON "Payout"("deliveryPartnerId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_orderId_userId_key" ON "ReturnRequest"("orderId", "userId");
