import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto, ValidateCouponDto } from './dto/coupon.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // Vendor or Admin creates a coupon
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  create(@CurrentUser() user: any, @Body() dto: CreateCouponDto) {
    // Admin creates platform-wide coupons; vendor creates store coupons
    const vendorId = user.role === 'ADMIN' ? dto.vendorId : user.vendorId;
    return this.couponsService.create(dto, vendorId);
  }

  // Lists coupons — vendors see their own, admins see all
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  findAll(@CurrentUser() user: any) {
    return this.couponsService.findAll(user.vendorId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.couponsService.findOne(id);
  }

  // Public validate endpoint — throttled: coupon guessing is abuse-sensitive.
  @Post('validate')
  @Throttle({ coupon: { ttl: 60000, limit: 20 } })
  validate(@Body() dto: ValidateCouponDto) {
    return this.couponsService.validate(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.couponsService.remove(id);
  }
}
