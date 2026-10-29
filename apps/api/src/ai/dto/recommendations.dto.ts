import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';

export class RecommendationsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}
