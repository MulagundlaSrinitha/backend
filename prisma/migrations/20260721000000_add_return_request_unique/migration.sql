-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_orderId_userId_key" ON "ReturnRequest"("orderId", "userId");
