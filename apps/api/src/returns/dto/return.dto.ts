import { IsString, IsUUID, IsOptional, Min, IsNumber } from 'class-validator';

export class CreateReturnDto {
  @IsUUID()
  orderId: string;

  @IsString()
  reason: string;
}

export class ProcessReturnDto {
  @IsString()
  status: 'APPROVED' | 'REJECTED' | 'REFUNDED';

  @IsNumber()
  @Min(0)
  @IsOptional()
  refundAmount?: number;

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
