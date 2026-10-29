-- Additive drift repair: live OrderVendorGroup is missing cancellationReason
-- which the generated Prisma client references on every include (breaks all
-- delivery queries: getEarnings, transactions, lifecycle). Non-destructive.
ALTER TABLE "OrderVendorGroup" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;