import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ResolveDisputeDto {
  @IsString()
  @IsNotEmpty()
  status: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}
