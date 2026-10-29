import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto/order-query.dto';
import { VerifyPickupDto } from '../delivery/dto/verify-pickup.dto';
import { AssignDeliveryDto } from '../delivery/dto/assign-delivery.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly deliveryService: DeliveryService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAll(user.id, user.role, query);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.ordersService.getSummary(user.id, user.role);
  }

  @Get('vendor')
  @Roles('VENDOR')
  findVendorOrders(
    @CurrentUser() user: { id: string },
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findVendorOrders(user.id, query);
  }

  @Get(':id/timeline')
  getTimeline(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderStatusTimeline(user.id, user.role, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.ordersService.findOne(user.id, user.role, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user.id, user.role, id, dto);
  }

  @Patch(':id/groups/:groupId/status')
  updateVendorGroupStatus(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user.id, user.role, id, dto, groupId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.ordersService.cancel(user.id, user.role, id, undefined, reason);
  }

  @Post(':id/groups/:groupId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelVendorGroup(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body('reason') reason?: string,
  ) {
    return this.ordersService.cancel(user.id, user.role, id, groupId, reason);
  }

  @Post(':id/assign')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  assignDelivery(
    @Param('id') id: string,
    @Body() dto: AssignDeliveryDto,
  ) {
    return this.deliveryService.assignOrder(id, dto.deliveryPartnerId);
  }

  @Post(':id/reject')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  rejectDelivery(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.rejectOrder(userId, id);
  }

  @Post(':id/going-to-pickup')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  goToPickup(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.goToPickup(userId, id);
  }

  @Post(':id/arrived-at-pickup')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  arriveAtPickup(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.arriveAtPickup(userId, id);
  }

  @Post(':id/arrived-at-customer')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  arriveAtCustomer(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.arriveAtCustomer(userId, id);
  }

  @Post(':id/verify-pickup')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  verifyPickup(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: VerifyPickupDto,
  ) {
    return this.deliveryService.verifyPickup(userId, id, dto.otp);
  }

  @Post(':id/start-transit')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  startTransit(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.startTransit(userId, id);
  }

  @Post(':id/deliver')
  @Roles(UserRole.DELIVERY_PARTNER)
  @HttpCode(HttpStatus.OK)
  completeDelivery(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryService.completeDelivery(userId, id);
  }
}
