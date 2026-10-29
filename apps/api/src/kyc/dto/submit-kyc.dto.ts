import { IsString, IsOptional, IsEnum } from 'class-validator';

export class SubmitKycDto {
  @IsString()
  documentType: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  documentUrl?: string;
}
