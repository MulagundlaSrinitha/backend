import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommissionService } from './commission.service';
import { CommissionQueryDto, UpdateCommissionDto } from './dto/commission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('commission')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get()
  findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query() query: CommissionQueryDto,
  ) {
    return this.commissionService.findAll(user.id, user.role, query);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.commissionService.getSummary(user.id, user.role);
  }

  @Post('calculate/:orderId')
  @Roles('ADMIN')
  calculateCommissions(@Param('orderId') orderId: string) {
    return this.commissionService.calculateCommissions(orderId);
  }

  @Patch(':id/pay')
  @Roles('ADMIN')
  markAsPaid(@Param('id') id: string) {
    return this.commissionService.markAsPaid(id);
  }

  @Post('bulk-pay')
  @Roles('ADMIN')
  bulkPay(@Body() dto: { commissionIds: string[] }) {
    return this.commissionService.markBulkAsPaid(dto.commissionIds);
  }

  @Patch('rate/:vendorId')
  @Roles('ADMIN')
  updateRate(
    @Param('vendorId') vendorId: string,
    @Body() dto: { rate: number },
  ) {
    return this.commissionService.updateVendorCommissionRate(vendorId, dto.rate);
  }
}
