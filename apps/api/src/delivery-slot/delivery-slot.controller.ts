import { Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { DeliverySlotService } from './delivery-slot.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class DeliverySlotController {
  constructor(private readonly deliverySlotService: DeliverySlotService) {}

  /**
   * Get available delivery slots for a zone.
   * Returns today + tomorrow slots with availability counts.
   */
  @Get('delivery-slots')
  @UseGuards(JwtAuthGuard)
  async getAvailableSlots(@Query('zoneId') zoneId: string) {
    if (!zoneId) throw new BadRequestException('zoneId query parameter is required');
    return this.deliverySlotService.getAvailableSlots(zoneId);
  }

  /**
   * Admin: create a new delivery slot config.
   */
  @Post('admin/delivery-slots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createSlot(@Body() data: {
    zoneId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    maxOrders?: number;
  }) {
    return this.deliverySlotService.upsertSlot(data);
  }
}
