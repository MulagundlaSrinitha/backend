import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DeclineDeliveryDto {
  @IsUUID()
  groupId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}