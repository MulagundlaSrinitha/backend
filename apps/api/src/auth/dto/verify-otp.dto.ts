import { IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  email: string;

  @IsString()
  @Length(6, 6)
  otp: string;
}
