import { IsEnum } from 'class-validator';
import { VendorKycDocumentType } from '@prisma/client';

export class UploadVendorKycDocumentDto {
  @IsEnum(VendorKycDocumentType)
  documentType: VendorKycDocumentType;
}
