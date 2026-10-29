import { IsString, IsOptional, IsIn, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  addressId: string;

  // COD-only MVP: Razorpay disabled (no keys). Keep the field so the
  // client still sends an explicit method, but reject anything but COD
  // with a clear 400 instead of silently creating a RAZORPAY order.
  @IsIn(['COD', 'RAZORPAY'])
  paymentMethod: string;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
