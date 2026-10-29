import { IsUUID } from 'class-validator';

export class ClaimDeliveryDto {
  @IsUUID()
  groupId: string;
}