import { IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for the admin Users list (GET /users).
 *
 * `role` is deliberately typed as a plain string rather than the `UserRole`
 * enum so the value can be normalized before it is validated against the enum
 * in UsersService — the admin UI labels the button "DELIVERY PARTNER" (with a
 * space) while the wire value is `DELIVERY_PARTNER`. An enum-typed DTO field
 * would reject the spaced form outright instead of normalizing it.
 *
 * Unrecognized extra params are rejected globally (`forbidNonWhitelisted`),
 * so anything the UI wants to send has to be declared here.
 */
export class QueryUsersDto {
  @IsOptional()
  @IsString()
  role?: string;

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