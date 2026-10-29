import { IsString, IsOptional, IsEnum, IsInt, Min, Max, Matches } from 'class-validator';
import { StoreType, SellerType } from '@prisma/client';

export class CreateVendorDto {
  @IsString()
  storeName: string;

  @IsString()
  storeSlug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(StoreType)
  storeType: StoreType;

  @IsOptional()
  @IsEnum(SellerType)
  sellerType?: SellerType;

  // ── Profile ──
  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Pincode must be a 6-digit number' })
  pincode?: string;

  // ── Bank / payout ──
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @Matches(/^\d{9,18}$/, { message: 'Bank account number must be 9-18 digits' })
  bankAccountNumber?: string;

  @IsOptional()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC code format' })
  bankIfsc?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  deliveryTimeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(180)
  deliveryTimeMax?: number;

  @IsOptional()
  @IsString()
  deliveryLabel?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  razorpayAccountId?: string;
}
