-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "VendorKycDocumentType" AS ENUM ('PAN', 'AADHAAR', 'GST_CERTIFICATE', 'FSSAI_LICENSE', 'NPOP_CERTIFICATE', 'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'BANK_PASSBOOK');

-- CreateEnum
CREATE TYPE "VendorKycDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('SEED', 'SEEDLING', 'SAPLING', 'PLANT', 'YOUNG_TREE', 'TREE', 'MATURE_TREE', 'FOREST');

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('PURCHASE_REWARD', 'REFERRAL_REWARD', 'REVIEW_REWARD', 'BIRTHDAY_BONUS', 'REDEMPTION', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'EXPIRED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';

-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "description" TEXT,
ADD COLUMN     "offerLabel" TEXT,
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "OrderVendorGroup" ADD COLUMN     "cancellationReason" TEXT;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "transferId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredBy" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "deliveryLabel" TEXT,
ADD COLUMN     "deliveryTimeMax" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "deliveryTimeMin" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "kycSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "sellerType" "SellerType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropTable
DROP TABLE "Role";

-- CreateTable
CREATE TABLE "DeliveryFailure" (
    "id" TEXT NOT NULL,
    "deliveryAssignmentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRejection" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "orderVendorGroupId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketReply_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "app_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT 'Next360',
    "supportEmail" TEXT NOT NULL DEFAULT 'support@next360.com',
    "defaultCommissionPct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "codEnabled" BOOLEAN NOT NULL DEFAULT true,
    "codCapAmount" INTEGER NOT NULL DEFAULT 2000,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 100,
    "maxOrderAmount" INTEGER NOT NULL DEFAULT 50000,
    "deliveryPartnerPayoutFreq" TEXT NOT NULL DEFAULT 'weekly',
    "autoApproveVendors" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveProducts" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySlotConfig" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxOrders" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySlotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySlotBooking" (
    "id" TEXT NOT NULL,
    "orderVendorGroupId" TEXT NOT NULL,
    "slotConfigId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "timeRange" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverySlotBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "transactionType" "PointsTransactionType" NOT NULL,
    "sourceId" TEXT,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMetrics" (
    "userId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "tier" "LoyaltyTier" NOT NULL DEFAULT 'SEED',
    "tierPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "tierEvaluatedAt" TIMESTAMP(3),
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPurchaseAt" TIMESTAMP(3),
    "rfmRecency" INTEGER NOT NULL DEFAULT 0,
    "rfmFrequency" INTEGER NOT NULL DEFAULT 0,
    "rfmMonetary" INTEGER NOT NULL DEFAULT 0,
    "rfmSegment" TEXT NOT NULL DEFAULT 'New',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMetrics_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardPoints" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "seedThreshold" INTEGER NOT NULL DEFAULT 0,
    "seedlingThreshold" INTEGER NOT NULL DEFAULT 100,
    "saplingThreshold" INTEGER NOT NULL DEFAULT 300,
    "plantThreshold" INTEGER NOT NULL DEFAULT 600,
    "youngTreeThreshold" INTEGER NOT NULL DEFAULT 1000,
    "treeThreshold" INTEGER NOT NULL DEFAULT 1500,
    "matureTreeThreshold" INTEGER NOT NULL DEFAULT 2500,
    "forestThreshold" INTEGER NOT NULL DEFAULT 5000,
    "pointsPerRupee" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "reviewPoints" INTEGER NOT NULL DEFAULT 25,
    "referralPoints" INTEGER NOT NULL DEFAULT 100,
    "birthdayPoints" INTEGER NOT NULL DEFAULT 50,
    "minRedemption" INTEGER NOT NULL DEFAULT 100,
    "redemptionValue" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "referralExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "seedMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "seedlingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.1,
    "saplingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "plantMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "youngTreeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "treeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.8,
    "matureTreeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "forestMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "seedBenefits" JSONB NOT NULL DEFAULT '["Welcome discount 5%", "Exclusive organic tips", "Early sale access"]',
    "seedlingBenefits" JSONB NOT NULL DEFAULT '["10% off first order", "Birthday bonus", "Free delivery on ₹300+"]',
    "saplingBenefits" JSONB NOT NULL DEFAULT '["15% store credit monthly", "Early access new products", "Free delivery on all orders"]',
    "plantBenefits" JSONB NOT NULL DEFAULT '["20% off any order", "Monthly free gift", "Priority customer support"]',
    "youngTreeBenefits" JSONB NOT NULL DEFAULT '["25% store credit", "Free eco-friendly tote", "Invite-only product drops"]',
    "treeBenefits" JSONB NOT NULL DEFAULT '["30% off everything", "Free weekly subscription box", "Name in supporter wall"]',
    "matureTreeBenefits" JSONB NOT NULL DEFAULT '["35% off everything", "Personal shopper", "Exclusive farm visits"]',
    "forestBenefits" JSONB NOT NULL DEFAULT '["40% off everything", "VIP events access", "Plant a tree in your name"]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryFailure_deliveryAssignmentId_key" ON "DeliveryFailure"("deliveryAssignmentId");

-- CreateIndex
CREATE INDEX "DeliveryRejection_orderVendorGroupId_idx" ON "DeliveryRejection"("orderVendorGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRejection_deliveryPartnerId_orderVendorGroupId_key" ON "DeliveryRejection"("deliveryPartnerId", "orderVendorGroupId");

-- CreateIndex
CREATE INDEX "VendorKycDocument_vendorId_idx" ON "VendorKycDocument"("vendorId");

-- CreateIndex
CREATE INDEX "VendorKycDocument_status_idx" ON "VendorKycDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorKycDocument_vendorId_documentType_key" ON "VendorKycDocument"("vendorId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "app_roles_name_key" ON "app_roles"("name");

-- CreateIndex
CREATE INDEX "DeliverySlotConfig_zoneId_dayOfWeek_idx" ON "DeliverySlotConfig"("zoneId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySlotBooking_orderVendorGroupId_key" ON "DeliverySlotBooking"("orderVendorGroupId");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_createdAt_idx" ON "AuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_createdAt_idx" ON "Purchase"("createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_userId_idx" ON "PointsLedger"("userId");

-- CreateIndex
CREATE INDEX "PointsLedger_createdAt_idx" ON "PointsLedger"("createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_expiresAt_idx" ON "PointsLedger"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

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
CREATE UNIQUE INDEX "Payout_orderId_vendorId_key" ON "Payout"("orderId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_deliveryPartnerId_periodStart_periodEnd_key" ON "Payout"("deliveryPartnerId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_orderId_userId_key" ON "ReturnRequest"("orderId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "DeliveryFailure" ADD CONSTRAINT "DeliveryFailure_deliveryAssignmentId_fkey" FOREIGN KEY ("deliveryAssignmentId") REFERENCES "DeliveryAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRejection" ADD CONSTRAINT "DeliveryRejection_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRejection" ADD CONSTRAINT "DeliveryRejection_orderVendorGroupId_fkey" FOREIGN KEY ("orderVendorGroupId") REFERENCES "OrderVendorGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorKycDocument" ADD CONSTRAINT "VendorKycDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySlotConfig" ADD CONSTRAINT "DeliverySlotConfig_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySlotBooking" ADD CONSTRAINT "DeliverySlotBooking_orderVendorGroupId_fkey" FOREIGN KEY ("orderVendorGroupId") REFERENCES "OrderVendorGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySlotBooking" ADD CONSTRAINT "DeliverySlotBooking_slotConfigId_fkey" FOREIGN KEY ("slotConfigId") REFERENCES "DeliverySlotConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMetrics" ADD CONSTRAINT "UserMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
