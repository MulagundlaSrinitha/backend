import { IsString, Matches } from 'class-validator';

export class VerifyPickupDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}
