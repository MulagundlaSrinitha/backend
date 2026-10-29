import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { NotificationProcessor } from './processors/notification.processor';
import { SettlementProcessor } from './processors/settlement.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'invoices' },
      {
        name: 'settlements',
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 10000 },
          // Job retention: keep recent history for debugging without bloating Redis
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      },
    ),
  ],
  providers: [QueueService, NotificationProcessor, SettlementProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
