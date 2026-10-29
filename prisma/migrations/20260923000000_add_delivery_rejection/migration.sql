-- CreateTable
CREATE TABLE "DeliveryRejection" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "orderVendorGroupId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryRejection_orderVendorGroupId_idx" ON "DeliveryRejection"("orderVendorGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRejection_deliveryPartnerId_orderVendorGroupId_key" ON "DeliveryRejection"("deliveryPartnerId", "orderVendorGroupId");

-- AddForeignKey
ALTER TABLE "DeliveryRejection" ADD CONSTRAINT "DeliveryRejection_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRejection" ADD CONSTRAINT "DeliveryRejection_orderVendorGroupId_fkey" FOREIGN KEY ("orderVendorGroupId") REFERENCES "OrderVendorGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;