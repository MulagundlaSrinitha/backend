import { IsString, IsUUID } from 'class-validator';

export class SetupDeliveryPartnerDto {
  @IsString()
  vehicleType: string;

  @IsUUID()
  zoneId: string;
}
