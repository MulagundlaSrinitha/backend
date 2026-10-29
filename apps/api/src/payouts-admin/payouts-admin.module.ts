import { Module } from '@nestjs/common';
import { PayoutsAdminController } from './payouts-admin.controller';
import { PayoutsAdminService } from './payouts-admin.service';

@Module({
  controllers: [PayoutsAdminController],
  providers: [PayoutsAdminService],
  exports: [PayoutsAdminService],
})
export class PayoutsAdminModule {}
