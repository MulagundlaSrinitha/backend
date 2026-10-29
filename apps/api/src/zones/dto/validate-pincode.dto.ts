import { IsString, Matches } from 'class-validator';

export class ValidatePincodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Pincode must be exactly 6 digits' })
  pincode: string;
}
