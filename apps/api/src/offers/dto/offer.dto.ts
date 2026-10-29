import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  IsDateString,
} from 'class-validator';
import { CouponType, StoreType } from '@prisma/client';

export class CreateOfferDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(StoreType)
  storeType: StoreType;

  @IsEnum(CouponType)
  discountType: CouponType;

  @IsNumber()
  @Min(0.01)
  discountValue: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  isActive?: boolean;
}

export class UpdateOfferDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(StoreType)
  @IsOptional()
  storeType?: StoreType;

  @IsEnum(CouponType)
  @IsOptional()
  discountType?: CouponType;

  @IsNumber()
  @IsOptional()
  @Min(0.01)
  discountValue?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsOptional()
  isActive?: boolean;
}
