import { IsEnum, IsOptional, IsString } from 'class-validator';
import { VendorKycDocumentStatus } from '@prisma/client';

export class ReviewVendorKycDocumentDto {
  @IsEnum(VendorKycDocumentStatus)
  status: VendorKycDocumentStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
