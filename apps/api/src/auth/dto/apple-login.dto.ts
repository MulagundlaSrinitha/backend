import { IsEmail, IsString, IsOptional } from 'class-validator';

export class AppleLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  appleId: string;

  @IsOptional()
  @IsString()
  identityToken?: string; // Apple identityToken JWT (verify on backend when provided)

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
