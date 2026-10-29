import { IsOptional, IsInt, Min, IsUUID, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CommissionQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;

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

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPaid?: boolean;
}

export class UpdateCommissionDto {
  @IsUUID()
  commissionId: string;
}
