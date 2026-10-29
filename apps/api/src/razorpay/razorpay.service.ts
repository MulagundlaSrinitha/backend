import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly client: any;

  constructor() {
    if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
      const Razorpay = require('razorpay');
      this.client = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });
      this.logger.log('Razorpay SDK initialised');
    } else {
      this.logger.warn(
        'Razorpay credentials not set — SDK disabled. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
  }

  getClient(): any {
    return this.client;
  }

  getKeyId(): string {
    return RAZORPAY_KEY_ID;
  }

  verifyPaymentSignature(body: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(signature, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  /**
   * Canonical Razorpay Route transfer — single source of truth for every
   * vendor payout in the platform.  Used by the payment.captured webhook
   * and the settlement processor.
   */
  async createVendorTransfer(params: {
    account: string;
    amountPaise: number;
    currency?: string;
    notes?: Record<string, string>;
  }): Promise<any> {
    if (!this.client) {
      throw new Error('Razorpay SDK not configured');
    }

    const transfer = await this.client.transfers.create({
      account: params.account,
      amount: params.amountPaise,
      currency: params.currency || 'INR',
      notes: params.notes || {},
    });

    return transfer;
  }
}
