import { IsString, IsUUID } from 'class-validator';

export class CreateDeliveryPartnerDto {
  @IsUUID()
  userId: string;

  @IsString()
  vehicleType: string;

  @IsUUID()
  zoneId: string;
}