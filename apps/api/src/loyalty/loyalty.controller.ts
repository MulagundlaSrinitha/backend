import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';
import { ReferralsService } from '../referrals/referrals.service';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(
    private loyaltyService: LoyaltyService,
    private referralsService: ReferralsService,
  ) {}

  // ─── Loyalty Status ────────────────────────────────────────────────────────

  @Get('me')
  async getLoyaltyStatus(@Request() req: any) {
    const userId = req.user.id;
    return this.loyaltyService.getLoyaltyStatus(userId);
  }

  @Get('tiers')
  getTiers() {
    return this.loyaltyService.getTiers();
  }

  // ─── Points Operations ─────────────────────────────────────────────────────

  @Get('balance')
  async getBalance(@Request() req: any) {
    const userId = req.user.id;
    const status = await this.loyaltyService.getLoyaltyStatus(userId);
    return { balance: status.pointsBalance };
  }

  @Get('ledger')
  async getLedger(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '20', 10);
    return this.loyaltyService.getLedger(userId, pageNum, limitNum);
  }

  @Post('redeem')
  async redeemPoints(
    @Request() req: any,
    @Body() body: { points: number },
  ) {
    const userId = req.user.id;
    return this.loyaltyService.redeemPoints(userId, body.points);
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────

  @Get('referrals')
  async getReferrals(@Request() req: any) {
    const userId = req.user.id;
    return this.referralsService.getReferralStats(userId);
  }

  @Post('referrals/validate')
  async validateReferral(
    @Request() req: any,
    @Body() body: { referralCode: string },
  ) {
    const userId = req.user.id;
    return this.referralsService.validateAndCreateReferral(
      userId,
      body.referralCode,
    );
  }

  // ─── Internal Endpoints ────────────────────────────────────────────────────

  @Post('award/purchase')
  async awardPurchasePoints(
    @Body() body: { userId: string; purchaseId: string; amount: number },
  ) {
    return this.loyaltyService.awardPurchasePoints(
      body.userId,
      body.purchaseId,
      body.amount,
    );
  }

  @Post('award/review')
  async awardReviewPoints(
    @Body() body: { userId: string; productId: string },
  ) {
    return this.loyaltyService.awardReviewPoints(body.userId, body.productId);
  }

  @Post('award/birthday')
  async awardBirthdayPoints(@Body() body: { userId: string }) {
    return this.loyaltyService.awardBirthdayPoints(body.userId);
  }

  @Post('referral/process')
  async processReferralReward(
    @Body() body: { userId: string; purchaseId: string },
  ) {
    return this.referralsService.processReferralReward(
      body.userId,
      body.purchaseId,
    );
  }

  @Post('tier/recalculate')
  async recalculateTier(@Body() body: { userId: string }) {
    return this.loyaltyService.recalculateTier(body.userId);
  }

  // ─── Admin Endpoints ───────────────────────────────────────────────────────

  @Get('user/:userId')
  @Roles(UserRole.ADMIN)
  async getUserLoyalty(@Param('userId') userId: string) {
    return this.loyaltyService.getLoyaltyStatus(userId);
  }

  @Post('admin/recalculate')
  @Roles(UserRole.ADMIN)
  async adminRecalculateTier(@Body() body: { userId: string }) {
    return this.loyaltyService.recalculateTier(body.userId);
  }
}
