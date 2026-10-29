import { IsString, IsOptional, IsObject } from 'class-validator';

export class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsObject()
  context?: {
    productId?: string;
    orderId?: string;
  };
}
