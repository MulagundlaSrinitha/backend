import { IsEnum, IsOptional, IsString } from 'class-validator';
import { KycStatus } from '@prisma/client';

export class VerifyKycDto {
  @IsEnum(KycStatus)
  status: KycStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
