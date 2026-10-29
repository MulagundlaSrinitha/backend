-- Additive drift repair: live Payout is missing the weekly batch idempotency
-- guard declared in the schema (@@unique([deliveryPartnerId, periodStart,
-- periodEnd])). Without it a double cron run double-pays a partner for the
-- same window. Safe to add: table has zero rows today.
CREATE UNIQUE INDEX IF NOT EXISTS "Payout_deliveryPartnerId_periodStart_periodEnd_key"
    ON "Payout"("deliveryPartnerId", "periodStart", "periodEnd");