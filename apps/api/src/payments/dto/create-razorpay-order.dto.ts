import { IsUUID, IsOptional, IsInt, Min, IsString, IsDateString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRazorpayOrderDto {
  @IsUUID()
  orderId: string;
}

export class PaymentQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class ProcessDeliveryPayoutsDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

export class AutoSettleVendorsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  threshold?: number = 1000;
}

export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  razorpayOrderId: string;

  @IsString()
  @IsNotEmpty()
  razorpayPaymentId: string;

  @IsString()
  @IsNotEmpty()
  razorpaySignature: string;
}

export class RazorpayWebhookDto {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        status: string;
        amount: number;
        currency: string;
        method: string;
        /** Razorpay error fields — present only for payment.failed events */
        error_description?: string;
        error_reason?: string;
        error_code?: string;
        error_source?: string;
      };
    };
    order?: {
      entity: {
        id: string;
        status: string;
        amount: number;
        currency: string;
      };
    };
    refund?: {
      entity: {
        id: string;
        payment_id: string;
        order_id: string;
        amount: number;
        currency: string;
        /** pending | processed | failed | reversed */
        status: string;
        notes?: Record<string, string>;
        created_at: number;
      };
    };
  };
}
