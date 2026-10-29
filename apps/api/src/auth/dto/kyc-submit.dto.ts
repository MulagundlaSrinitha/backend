import { IsString, IsOptional } from 'class-validator';

export class KycSubmitDto {
  @IsString()
  documentType: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  documentUrl?: string;
}
