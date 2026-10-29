import { IsUUID, IsInt, Min, Max, IsString, IsOptional, Length } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  @Length(0, 200)
  title?: string;

  @IsString()
  @IsOptional()
  @Length(0, 2000)
  body?: string;
}
