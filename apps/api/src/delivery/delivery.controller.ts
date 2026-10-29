import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { EarningsQueryDto } from './dto/earnings-query.dto';
import { ClaimDeliveryDto } from './dto/claim-delivery.dto';
import { DeclineDeliveryDto } from './dto/decline-delivery.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('delivery')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DELIVERY_PARTNER)
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Patch('availability')
  updateAvailability(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.deliveryService.updateAvailability(userId, dto.isAvailable);
  }

  @Patch('location')
  updateLocation(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.deliveryService.updateLocation(userId, dto.lat, dto.lng);
  }

  @Get('new-orders')
  getNewOrders(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deliveryService.getNewOrders(
      userId,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('active')
  getActiveDeliveries(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deliveryService.getActiveDeliveries(
      userId,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('history')
  getDeliveryHistory(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deliveryService.getDeliveryHistory(
      userId,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('earnings')
  getEarnings(
    @CurrentUser('id') userId: string,
    @Query() query: EarningsQueryDto,
  ) {
    return this.deliveryService.getEarnings(userId, query.period);
  }

  @Get('transactions')
  getTransactions(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deliveryService.getDeliveryTransactions(
      userId,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('transactions/:id')
  getTransaction(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.getDeliveryTransaction(userId, id);
  }

  @Get('payouts')
  getPayouts(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deliveryService.getDeliveryPayouts(
      userId,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('payouts/:id')
  getPayout(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.getDeliveryPayout(userId, id);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser('id') userId: string, @Body() dto: ClaimDeliveryDto) {
    return this.deliveryService.claimOrder(userId, dto.groupId);
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentUser('id') userId: string,
    @Body() dto: DeclineDeliveryDto,
  ) {
    return this.deliveryService.declineOrder(
      userId,
      dto.groupId,
      dto.reason,
    );
  }

  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  setupPartner(
    @CurrentUser('id') userId: string,
    @Body() dto: { vehicleType: string; zoneName: string },
  ) {
    return this.deliveryService.setupPartner(userId, dto.vehicleType, dto.zoneName);
  }

  @Post('failure')
  @HttpCode(HttpStatus.OK)
  reportFailure(
    @CurrentUser('id') userId: string,
    @Body() dto: { orderId: string; reason: string; details?: string },
  ) {
    return this.deliveryService.reportFailure(
      userId,
      dto.orderId,
      dto.reason,
      dto.details,
    );
  }
}
