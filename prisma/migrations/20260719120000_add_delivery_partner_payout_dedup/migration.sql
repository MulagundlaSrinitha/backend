-- CreateIndex
CREATE UNIQUE INDEX "Payout_deliveryPartnerId_periodStart_periodEnd_key" ON "Payout"("deliveryPartnerId", "periodStart", "periodEnd");
