import { IsString, IsOptional, IsEnum } from 'class-validator';
import { StoreType } from '@prisma/client';

export class CreateSubCategoryDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsString()
  categoryId: string;

  @IsEnum(StoreType)
  storeType: StoreType;

  @IsOptional()
  @IsString()
  description?: string;
}
