-- Vendor KYC + Store Profile: separate VendorKycDocument model (kept
-- independent from the generic KYC model, which stays shared with
-- Delivery Partners), SellerType, vendor profile/bank fields.

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "VendorKycDocumentType" AS ENUM ('PAN', 'AADHAAR', 'GST_CERTIFICATE', 'FSSAI_LICENSE', 'NPOP_CERTIFICATE', 'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'BANK_PASSBOOK');

-- CreateEnum
CREATE TYPE "VendorKycDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Vendor"
  ADD COLUMN     "sellerType" "SellerType" NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN     "ownerName" TEXT,
  ADD COLUMN     "address" TEXT,
  ADD COLUMN     "city" TEXT,
  ADD COLUMN     "state" TEXT,
  ADD COLUMN     "pincode" TEXT,
  ADD COLUMN     "bankAccountName" TEXT,
  ADD COLUMN     "bankAccountNumber" TEXT,
  ADD COLUMN     "bankIfsc" TEXT,
  ADD COLUMN     "bankName" TEXT,
  ADD COLUMN     "kycSubmittedAt" TIMESTAMP(3);



-- CreateTable
CREATE TABLE "VendorKycDocument" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "documentType" "VendorKycDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "VendorKycDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorKycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorKycDocument_vendorId_idx" ON "VendorKycDocument"("vendorId");

-- CreateIndex
CREATE INDEX "VendorKycDocument_status_idx" ON "VendorKycDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorKycDocument_vendorId_documentType_key" ON "VendorKycDocument"("vendorId", "documentType");

-- AddForeignKey
ALTER TABLE "VendorKycDocument" ADD CONSTRAINT "VendorKycDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
