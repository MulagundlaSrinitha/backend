import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyTier, PointsTransactionType } from '@prisma/client';

// Tree-Growth Tiers Configuration
const LOYALTY_TIERS = [
  { id: 'SEED' as LoyaltyTier, name: 'Seed', emoji: '🌱', pointsNeeded: 0, multiplier: 1.0 },
  { id: 'SEEDLING' as LoyaltyTier, name: 'Seedling', emoji: '🌿', pointsNeeded: 100, multiplier: 1.1 },
  { id: 'SAPLING' as LoyaltyTier, name: 'Sapling', emoji: '🌲', pointsNeeded: 300, multiplier: 1.2 },
  { id: 'PLANT' as LoyaltyTier, name: 'Plant', emoji: '🌳', pointsNeeded: 600, multiplier: 1.3 },
  { id: 'YOUNG_TREE' as LoyaltyTier, name: 'Young Tree', emoji: '🌴', pointsNeeded: 1000, multiplier: 1.5 },
  { id: 'TREE' as LoyaltyTier, name: 'Tree', emoji: '🌲', pointsNeeded: 1500, multiplier: 1.8 },
  { id: 'MATURE_TREE' as LoyaltyTier, name: 'Mature Tree', emoji: '🌳', pointsNeeded: 2500, multiplier: 2.0 },
  { id: 'FOREST' as LoyaltyTier, name: 'Forest', emoji: '🌲🌳🌴', pointsNeeded: 5000, multiplier: 2.5 },
];

@Injectable()
export class LoyaltyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get user's loyalty status
   */
  async getLoyaltyStatus(userId: string) {
    const metrics = await this.prisma.userMetrics.findUnique({
      where: { userId },
    });

    if (!metrics) {
      return this.createDefaultMetrics(userId);
    }

    const currentTier = this.getTierByPoints(metrics.tierPointsEarned);
    const nextTier = this.getNextTier(currentTier.id);
    const progressToNext = nextTier
      ? (metrics.tierPointsEarned - currentTier.pointsNeeded) /
        (nextTier.pointsNeeded - currentTier.pointsNeeded)
      : 1;

    return {
      pointsBalance: metrics.pointsBalance,
      tier: currentTier,
      nextTier,
      progressToNext: Math.min(Math.max(progressToNext, 0), 1),
      tierPointsEarned: metrics.tierPointsEarned,
      rfmSegment: metrics.rfmSegment,
      purchaseCount: metrics.purchaseCount,
      totalSpend: metrics.totalSpend,
    };
  }

  /**
   * Award points for a purchase
   */
  async awardPurchasePoints(userId: string, purchaseId: string, amount: number) {
    const metrics = await this.getOrCreateMetrics(userId);
    const currentTier = this.getTierByPoints(metrics.tierPointsEarned);
    const pointsEarned = Math.floor(amount * currentTier.multiplier);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    await this.prisma.$transaction([
      this.prisma.pointsLedger.create({
        data: {
          userId,
          points: pointsEarned,
          transactionType: 'PURCHASE_REWARD',
          sourceId: purchaseId,
          description: `Purchase reward: ₹${amount}`,
          expiresAt,
        },
      }),
      this.prisma.userMetrics.update({
        where: { userId },
        data: {
          pointsBalance: { increment: pointsEarned },
          tierPointsEarned: { increment: pointsEarned },
        },
      }),
    ]);

    await this.recalculateTier(userId);

    return { pointsEarned, totalBalance: metrics.pointsBalance + pointsEarned };
  }

  /**
   * Award points for a review
   */
  async awardReviewPoints(userId: string, productId: string) {
    const points = 25;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    await this.prisma.$transaction([
      this.prisma.pointsLedger.create({
        data: {
          userId,
          points,
          transactionType: 'REVIEW_REWARD',
          sourceId: productId,
          description: 'Review reward',
          expiresAt,
        },
      }),
      this.prisma.userMetrics.update({
        where: { userId },
        data: { pointsBalance: { increment: points } },
      }),
    ]);

    return { pointsEarned: points };
  }

  /**
   * Award birthday bonus points
   */
  async awardBirthdayPoints(userId: string) {
    const points = 50;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    await this.prisma.$transaction([
      this.prisma.pointsLedger.create({
        data: {
          userId,
          points,
          transactionType: 'BIRTHDAY_BONUS',
          description: 'Birthday bonus',
          expiresAt,
        },
      }),
      this.prisma.userMetrics.update({
        where: { userId },
        data: { pointsBalance: { increment: points } },
      }),
    ]);

    return { pointsEarned: points };
  }

  /**
   * Redeem points
   */
  async redeemPoints(userId: string, points: number) {
    if (points < 100) {
      throw new BadRequestException('Minimum redemption is 100 points');
    }

    const metrics = await this.getOrCreateMetrics(userId);
    if (metrics.pointsBalance < points) {
      throw new BadRequestException('Insufficient points balance');
    }

    const expiresAt = new Date('2099-12-31');

    await this.prisma.$transaction([
      this.prisma.pointsLedger.create({
        data: {
          userId,
          points: -points,
          transactionType: 'REDEMPTION',
          description: `Redeemed ${points} points`,
          expiresAt,
        },
      }),
      this.prisma.userMetrics.update({
        where: { userId },
        data: { pointsBalance: { decrement: points } },
      }),
    ]);

    const redemptionValue = points * 0.1;
    return { pointsRedeemed: points, valueInRupees: redemptionValue };
  }

  /**
   * Get points ledger history
   */
  async getLedger(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      this.prisma.pointsLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pointsLedger.count({ where: { userId } }),
    ]);

    return {
      entries,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get all tiers
   */
  getTiers() {
    return LOYALTY_TIERS;
  }

  /**
   * Recalculate user's tier
   */
  async recalculateTier(userId: string) {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const result = await this.prisma.pointsLedger.aggregate({
      where: {
        userId,
        createdAt: { gte: twelveMonthsAgo },
        points: { gt: 0 },
      },
      _sum: { points: true },
    });

    const tierPointsEarned = result._sum.points || 0;
    const newTier = this.getTierByPoints(tierPointsEarned);

    await this.prisma.userMetrics.update({
      where: { userId },
      data: {
        tier: newTier.id,
        tierPointsEarned,
        tierEvaluatedAt: new Date(),
      },
    });

    return { tier: newTier, tierPointsEarned };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────

  private getTierByPoints(points: number) {
    for (let i = LOYALTY_TIERS.length - 1; i >= 0; i--) {
      if (points >= LOYALTY_TIERS[i].pointsNeeded) {
        return LOYALTY_TIERS[i];
      }
    }
    return LOYALTY_TIERS[0];
  }

  private getNextTier(currentTierId: string) {
    const currentIndex = LOYALTY_TIERS.findIndex((t) => t.id === currentTierId);
    if (currentIndex < LOYALTY_TIERS.length - 1) {
      return LOYALTY_TIERS[currentIndex + 1];
    }
    return null;
  }

  private async getOrCreateMetrics(userId: string) {
    let metrics = await this.prisma.userMetrics.findUnique({
      where: { userId },
    });

    if (!metrics) {
      metrics = await this.createDefaultMetrics(userId);
    }

    return metrics;
  }

  private async createDefaultMetrics(userId: string) {
    return this.prisma.userMetrics.create({
      data: {
        userId,
        pointsBalance: 0,
        tier: 'SEED',
        tierPointsEarned: 0,
        rfmSegment: 'New',
      },
    });
  }
}
