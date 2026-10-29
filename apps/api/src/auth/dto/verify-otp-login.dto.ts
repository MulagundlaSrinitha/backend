import { IsEnum, IsOptional, Matches } from 'class-validator';
import { UserRole } from '@prisma/client';

export class VerifyOtpLoginDto {
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid 10-digit Indian mobile number' })
  phone: string;

  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'role must be a valid UserRole' })
  role?: UserRole;
}