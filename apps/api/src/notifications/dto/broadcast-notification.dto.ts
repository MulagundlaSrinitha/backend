import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'VENDOR', 'DELIVERY_PARTNER', 'ADMIN', 'ALL'])
  targetRole?: string;
}
