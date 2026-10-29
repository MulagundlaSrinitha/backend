-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "deliveryLabel" TEXT,
ADD COLUMN     "deliveryTimeMax" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "deliveryTimeMin" INTEGER NOT NULL DEFAULT 10;
