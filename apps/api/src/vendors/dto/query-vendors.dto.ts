import { IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { StoreType } from '@prisma/client';

/**
 * Query params for the admin vendor list (GET /vendors).
 *
 * `storeType` and `isApproved` are pre-existing params and are kept so current
 * callers are unaffected. `isApproved` is the old coarse filter
 * (true -> APPROVED, false -> PENDING); `status` is the explicit replacement and
 * wins when both are supplied.
 *
 * `status` is a plain string rather than the `VendorStatus` enum so the value
 * can be normalized before validation — the admin UI's tab labels and the enum
 * values differ in case and separators ("All" vs 'ALL', "delivery partner"
 * style spellings), and an enum-typed field would reject those outright.
 */
export class QueryVendorsDto {
  @IsOptional()
  @IsString()
  storeType?: StoreType;

  @IsOptional()
  @IsString()
  isApproved?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  limit?: number;
}