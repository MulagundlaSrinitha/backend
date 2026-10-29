import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  orderId: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsEnum(['RETURN', 'REFUND', 'COMPLAINT', 'QUALITY', 'DELIVERY'])
  type?: string;
}
