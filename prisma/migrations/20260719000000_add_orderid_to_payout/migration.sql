-- Add orderId to Payout for exact idempotent dedup on webhook retries.
-- Replaces the 5-minute time-window heuristic with a deterministic lookup.

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN "orderId" TEXT;

-- CreateIndex (unique constraint prevents duplicate payouts per order+vendor)
CREATE UNIQUE INDEX "Payout_orderId_vendorId_key" ON "Payout"("orderId", "vendorId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
