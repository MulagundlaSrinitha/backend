import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private loyaltyService: LoyaltyService,
  ) {}

  /**
   * Generate a unique referral code for a user
   */
  async generateReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.referralCode) {
      return user.referralCode;
    }

    let code = '';
    let isUnique = false;

    while (!isUnique) {
      const random = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();
      code = `REF-${random}`;

      const existing = await this.prisma.user.findFirst({
        where: { referralCode: code },
      });

      if (!existing) {
        isUnique = true;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode: code },
    });

    return code!;
  }

  /**
   * Validate a referral code and create referral record
   */
  async validateAndCreateReferral(
    newUserId: string,
    referralCode: string,
  ): Promise<boolean> {
    const referrer = await this.prisma.user.findFirst({
      where: { referralCode },
    });

    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }

    if (referrer.id === newUserId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    const existingReferral = await this.prisma.referral.findFirst({
      where: { referredUserId: newUserId },
    });

    if (existingReferral) {
      throw new BadRequestException('User already has a referral');
    }

    await this.prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: newUserId,
        status: 'PENDING',
        rewardPoints: 100,
      },
    });

    await this.prisma.user.update({
      where: { id: newUserId },
      data: { referredBy: referrer.id },
    });

    return true;
  }

  /**
   * Process referral reward when referred user makes first purchase
   */
  async processReferralReward(userId: string, purchaseId: string) {
    const purchaseCount = await this.prisma.purchase.count({
      where: { userId },
    });

    if (purchaseCount !== 1) {
      return null;
    }

    const referral = await this.prisma.referral.findFirst({
      where: {
        referredUserId: userId,
        status: 'PENDING',
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    });

    if (!referral) {
      return null;
    }

    await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'REWARDED',
        rewardedAt: new Date(),
      },
    });

    const points = 100;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    await this.prisma.$transaction([
      this.prisma.pointsLedger.create({
        data: {
          userId: referral.referrerId,
          points,
          transactionType: 'REFERRAL_REWARD',
          sourceId: referral.id,
          description: 'Referral reward',
          expiresAt,
        },
      }),
      this.prisma.userMetrics.update({
        where: { userId: referral.referrerId },
        data: { pointsBalance: { increment: points } },
      }),
    ]);

    await this.loyaltyService.recalculateTier(referral.referrerId);

    return {
      referrerId: referral.referrerId,
      pointsAwarded: points,
    };
  }

  /**
   * Get user's referral stats
   */
  async getReferralStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) throw new NotFoundException('User not found');

    if (!user.referralCode) {
      await this.generateReferralCode(userId);
    }

    const [sentReferrals, receivedReferral] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: {
          referredUser: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.referral.findFirst({
        where: { referredUserId: userId },
        include: {
          referrer: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
    ]);

    return {
      referralCode: user.referralCode,
      totalReferrals: sentReferrals.length,
      successfulReferrals: sentReferrals.filter((r) => r.status === 'REWARDED').length,
      pendingReferrals: sentReferrals.filter((r) => r.status === 'PENDING').length,
      totalPointsEarned: sentReferrals
        .filter((r) => r.status === 'REWARDED')
        .reduce((sum, r) => sum + r.rewardPoints, 0),
      referrals: sentReferrals,
      referredBy: receivedReferral?.referrer || null,
    };
  }
}
