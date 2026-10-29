import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationQueue: Queue,
    @InjectQueue('invoices') private readonly invoiceQueue: Queue,
    @InjectQueue('settlements') private readonly settlementQueue: Queue,
  ) {}

  async sendPush(title: string, body: string, token: string, data?: any) {
    await this.notificationQueue.add('push', { title, body, token, data });
  }

  async sendEmail(to: string, subject: string, body: string) {
    await this.notificationQueue.add('email', { to, subject, body });
  }

  async sendSms(phone: string, message: string) {
    await this.notificationQueue.add('sms', { phone, message });
  }

  async generateInvoice(orderId: string) {
    await this.invoiceQueue.add('generate', { orderId });
  }

  async processSettlement(vendorId: string, amount: number, payoutId: string) {
    await this.settlementQueue.add('process', { vendorId, amount, payoutId }, {
      jobId: `settle-${payoutId}`,
    });
  }

  async getQueueMetrics() {
    const [notif, invoices, settlements] = await Promise.all([
      this.notificationQueue.getJobCounts(),
      this.invoiceQueue.getJobCounts(),
      this.settlementQueue.getJobCounts(),
    ]);
    return { notifications: notif, invoices, settlements };
  }
}
