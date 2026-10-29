import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, Min, Max, ArrayNotEmpty, ArrayUnique, Matches } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^\d{6}$/, { each: true, message: 'Each pincode must be exactly 6 digits' })
  pincodes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryRadius?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2000)
  codCap?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
