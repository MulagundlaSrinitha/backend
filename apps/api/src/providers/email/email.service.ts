import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly sendgridKey: string | undefined;
  private readonly resendKey: string | undefined;
  private readonly fromEmail: string;
  private transporter: Transporter | null = null;

  constructor() {
    this.sendgridKey = process.env.SENDGRID_API_KEY;
    this.resendKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@next360.com';
  }

  async send(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
    if (this.sendgridKey) {
      return this.sendViaSendGrid(options);
    }
    if (this.resendKey) {
      return this.sendViaResend(options);
    }
    if (this.isSmtpConfigured()) {
      return this.sendViaSmtp(options);
    }
    // Fallback: honest failure in production (never log bodies — PII).
    // Dev-only: short subject line so local testing stays observable.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[EMAIL:DEV] To: ${options.to}, Subject: ${options.subject}`);
    } else {
      this.logger.warn(`[EMAIL] NOT_CONFIGURED — email not sent to ${options.to}`);
    }
    return false;
  }

  async sendOtpEmail(email: string, code: string): Promise<boolean> {
    return this.send({
      to: email,
      subject: 'Your Next360 OTP Code',
      html: `<p>Your verification code is: <strong>${code}</strong></p><p>Valid for 5 minutes.</p>`,
    });
  }

  async sendOrderConfirmation(email: string, orderNo: string, items: any[]): Promise<boolean> {
    const itemList = items.map((i) => `<li>${i.name} × ${i.quantity} — ₹${i.price}</li>`).join('');
    return this.send({
      to: email,
      subject: `Order Confirmed — #${orderNo}`,
      html: `<h2>Order Confirmed!</h2><p>Your order #${orderNo} has been placed.</p><ul>${itemList}</ul>`,
    });
  }

  private async sendViaSendGrid(options: { to: string; subject: string; html: string }) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: this.fromEmail },
          subject: options.subject,
          content: [{ type: 'text/html', value: options.html }],
        }),
      });
      return response.ok;
    } catch (error) {
      this.logger.error(`SendGrid failed: ${error}`);
      return false;
    }
  }

  private isSmtpConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT || 587);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  /** Verify SMTP connectivity (useful as a health check / debug endpoint). */
  async verifySmtp(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      return true;
    } catch (error) {
      this.logger.error(`SMTP verify failed: ${error}`);
      return false;
    }
  }

  private async sendViaSmtp(options: { to: string; subject: string; html: string; text?: string }) {
    try {
      await this.getTransporter().sendMail({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      return true;
    } catch (error) {
      this.logger.error(`SMTP send failed: ${error}`);
      return false;
    }
  }

  private async sendViaResend(options: { to: string; subject: string; html: string }) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
        }),
      });
      return response.ok;
    } catch (error) {
      this.logger.error(`Resend failed: ${error}`);
      return false;
    }
  }
}
