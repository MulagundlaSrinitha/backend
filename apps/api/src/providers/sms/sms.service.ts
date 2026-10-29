import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  // MSG91 (India DLT) — REQUIRED for OTP in production
  private readonly msg91AuthKey: string | undefined;
  private readonly msg91TemplateId: string | undefined; // DLT-approved template ID (e.g. "1a2b3c...")
  private readonly msg91SenderId: string; // DLT-registered Sender ID (e.g. NXT360)
  private readonly dltEntityId: string | undefined; // DLT Principal Entity ID (PE ID)

  // Twilio — alternative / fallback (non-DLT, for international or staging)
  private readonly twilioAccountSid: string | undefined;
  private readonly twilioAuthToken: string | undefined;

  constructor() {
    this.msg91AuthKey = process.env.MSG91_AUTH_KEY;
    this.msg91TemplateId = process.env.MSG91_TEMPLATE_ID;
    this.msg91SenderId = process.env.MSG91_SENDER_ID || 'NXT360';
    this.dltEntityId = process.env.DLT_ENTITY_ID;
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

    if (this.msg91AuthKey && !this.msg91TemplateId) {
      this.logger.warn(
        '[DLT] MSG91_AUTH_KEY is set but MSG91_TEMPLATE_ID is missing — OTP SMS will be blocked by TRAI DLT. Register template via https://msg91.com/dlt and set MSG91_TEMPLATE_ID.',
      );
    }
    if (this.msg91AuthKey && !this.dltEntityId) {
      this.logger.warn(
        '[DLT] DLT_ENTITY_ID not set — some operators will reject SMS even with templateId. Set DLT_ENTITY_ID (Principal Entity ID).',
      );
    }
  }

  isDltConfigured(): boolean {
    return !!(this.msg91AuthKey && this.msg91TemplateId);
  }

  isConfigured(): boolean {
    return !!(this.msg91AuthKey || (this.twilioAccountSid && this.twilioAuthToken));
  }

  /** Redact a phone number for logs: keep country/last-2 only. */
  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) return '****';
    return `+${digits.slice(0, digits.length - 4).replace(/\d/g, '*')}${digits.slice(-2)}`;
  }

  async sendOtp(phone: string, code: string): Promise<boolean> {
    // Prefer MSG91 DLT flow in India (required for deliverability)
    if (this.msg91AuthKey) {
      if (this.msg91TemplateId) {
        return this.sendViaMsg91Dlt(phone, code);
      }
      // No templateId yet — try legacy MSG91 then fail over to log (DLT will block this)
      this.logger.warn('[DLT] Sending OTP without templateId — TRAI will likely block this SMS');
      return this.sendViaMsg91Legacy(phone, `Your Next360 OTP is ${code}. Valid for 5 minutes.`);
    }
    if (this.twilioAccountSid && this.twilioAuthToken) {
      return this.sendViaTwilio(phone, `Your Next360 OTP is ${code}. Valid for 5 minutes.`);
    }
    // No provider configured: honest failure (never log the OTP code).
    // Callers must handle false without blocking dev OTP verification flows.
    // Dev-only: print the code so local testing works without an SMS plan.
    // Production logs must never contain OTPs (FRD §112).
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[SMS:DEV] OTP for ${this.maskPhone(phone)}: ${code}`);
    } else {
      this.logger.warn(`[SMS] NOT_CONFIGURED — OTP not sent to ${this.maskPhone(phone)}`);
    }
    return false;
  }

  async send(phone: string, message: string): Promise<boolean> {
    if (this.msg91AuthKey) {
      return this.sendViaMsg91Legacy(phone, message);
    }
    if (this.twilioAccountSid && this.twilioAuthToken) {
      return this.sendViaTwilio(phone, message);
    }
    this.logger.warn(`[SMS] NOT_CONFIGURED — message not sent to ${this.maskPhone(phone)}`);
    return false;
  }

  /**
   * TRAI DLT-compliant OTP send via MSG91 v5/flow with template_id.
   * Requires: MSG91_AUTH_KEY + MSG91_TEMPLATE_ID (+ DLT_ENTITY_ID for full compliance).
   * Docs: https://docs.msg91.com/collection/msg91-api
   */
  private async sendViaMsg91Dlt(phone: string, code: string): Promise<boolean> {
    try {
      const mobiles = phone.replace('+', '').replace(/\s/g, '');
      // MSG91 Flow API — DLT variables must match registered template
      const body: Record<string, unknown> = {
        template_id: this.msg91TemplateId,
        sender: this.msg91SenderId,
        short_url: '0',
        mobiles,
        // Variable mapping — key `otp` must match the variable name registered in the DLT template
        // e.g. template: "Your Next360 OTP is ##otp##. Valid for 5 minutes. - NXT360"
        otp: code,
      };
      if (this.dltEntityId) body['DLT_TE_ID'] = this.dltEntityId;

      const response = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: this.msg91AuthKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.error(`MSG91 DLT send failed (${response.status}): ${text}`);
        return false;
      }
      this.logger.log(`[SMS] OTP sent via MSG91 DLT to ${this.maskPhone(phone)} (template ${this.msg91TemplateId})`);
      return true;
    } catch (error) {
      this.logger.error(`MSG91 DLT send error: ${error}`);
      return false;
    }
  }

  private async sendViaMsg91Legacy(phone: string, message: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: this.msg91AuthKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: this.msg91SenderId,
          mobiles: phone.replace('+', ''),
          message,
        }),
      });
      const text = await response.text();
      if (!response.ok) this.logger.error(`MSG91 legacy send failed (${response.status}): ${text}`);
      return response.ok;
    } catch (error) {
      this.logger.error(`MSG91 legacy send failed: ${error}`);
      return false;
    }
  }

  private async sendViaTwilio(phone: string, message: string): Promise<boolean> {
    try {
      const accountSid = this.twilioAccountSid!;
      const authToken = this.twilioAuthToken!;
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: phone,
            From: process.env.TWILIO_PHONE_NUMBER || '',
            Body: message,
          }),
        },
      );
      if (!response.ok) {
        const t = await response.text();
        this.logger.error(`Twilio send failed (${response.status}): ${t}`);
      }
      return response.ok;
    } catch (error) {
      this.logger.error(`Twilio send failed: ${error}`);
      return false;
    }
  }
}
