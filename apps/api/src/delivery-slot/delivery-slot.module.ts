import { Module } from '@nestjs/common';
import { DeliverySlotService } from './delivery-slot.service';
import { DeliverySlotController } from './delivery-slot.controller';

@Module({
  controllers: [DeliverySlotController],
  providers: [DeliverySlotService],
  exports: [DeliverySlotService],
})
export class DeliverySlotModule {}
