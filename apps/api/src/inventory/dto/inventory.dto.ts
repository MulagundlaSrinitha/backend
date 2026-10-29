import { IsOptional, IsInt, Min, IsUUID, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Stock-status buckets for the Inventory screen tabs.
 *
 * The values are the snake_case keys the admin UI has always sent
 * (`in_stock`, `low_stock`, `out_of_stock`). They are declared here so the
 * global ValidationPipe whitelist accepts them — without this the query param
 * was rejected with 400 "property status should not exist" and the screen
 * silently rendered an empty table.
 *
 * These buckets are mutually exclusive and exhaustive: out-of-stock is
 * `stock <= 0`, low-stock is `0 < stock < threshold`, in-stock is
 * `stock >= threshold`, so the three always sum to "all".
 */
export enum InventoryStockStatus {
  ALL = 'all',
  OUT_OF_STOCK = 'out_of_stock',
  LOW_STOCK = 'low_stock',
  IN_STOCK = 'in_stock',
}

export class InventoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /** Stock-status bucket. Omit (or 'all') for every record. */
  @IsOptional()
  @IsEnum(InventoryStockStatus)
  status?: InventoryStockStatus;

  /**
   * Low-stock cut-off, in units. Defaults to the module constant so the tabs,
   * the table's Status column and the low-stock notifications all agree.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  threshold?: number;

  /** Free-text match on product name, variant SKU or vendor store name. */
  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateStockDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;
}

export class LowStockQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  threshold?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  vendorId?: string;
}
