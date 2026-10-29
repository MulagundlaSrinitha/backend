import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateDeliveryPartnerStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;
}
