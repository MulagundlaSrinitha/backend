import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, ReferralsService],
  exports: [LoyaltyService, ReferralsService],
})
export class LoyaltyModule {}
