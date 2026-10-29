import { IsOptional, IsIn } from 'class-validator';

export type EarningsPeriod = 'today' | 'week' | 'month' | 'all';

export class EarningsQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'all'], {
    message: 'period must be one of: today, week, month, all',
  })
  period?: EarningsPeriod;
}
