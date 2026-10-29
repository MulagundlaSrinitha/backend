-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('SEED', 'SEEDLING', 'SAPLING', 'PLANT', 'YOUNG_TREE', 'TREE', 'MATURE_TREE', 'FOREST');

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('PURCHASE_REWARD', 'REFERRAL_REWARD', 'REVIEW_REWARD', 'BIRTHDAY_BONUS', 'REDEMPTION', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'EXPIRED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';

-- AlterTable
ALTER TABLE "SupportTicket" ALTER COLUMN "category" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredBy" TEXT;

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
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "DeliveryFailure" ADD CONSTRAINT "DeliveryFailure_deliveryAssignmentId_fkey" FOREIGN KEY ("deliveryAssignmentId") REFERENCES "DeliveryAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

