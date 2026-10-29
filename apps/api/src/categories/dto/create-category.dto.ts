import { IsString, IsOptional, IsEnum } from 'class-validator';
import { StoreType } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsEnum(StoreType)
  storeType: StoreType;
}
