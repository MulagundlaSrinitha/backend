import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryQueryDto, UpdateStockDto, LowStockQueryDto } from './dto/inventory.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.VENDOR)
  async findAll(
    @CurrentUser() user: { id: string; role: string; vendorId?: string },
    @Query() query: InventoryQueryDto,
  ) {
    if (user.role === UserRole.VENDOR && !user.vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    const vendorId = user.role === UserRole.VENDOR ? user.vendorId : query.vendorId;
    return this.inventoryService.findAll(query, vendorId);
  }

  @Get('low-stock')
  @Roles(UserRole.ADMIN, UserRole.VENDOR)
  async getLowStock(
    @CurrentUser() user: { id: string; role: string; vendorId?: string },
    @Query() query: LowStockQueryDto,
  ) {
    if (user.role === UserRole.VENDOR && !user.vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    const vendorId = user.role === UserRole.VENDOR ? user.vendorId : query.vendorId;
    return this.inventoryService.getLowStock(query, vendorId);
  }

  @Patch(':productId')
  @Roles(UserRole.ADMIN, UserRole.VENDOR)
  async updateStock(
    @CurrentUser() user: { id: string; role: string; vendorId?: string },
    @Param('productId') productId: string,
    @Body() dto: UpdateStockDto,
  ) {
    if (user.role === UserRole.VENDOR && !user.vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.inventoryService.updateStock(productId, dto.quantity, user.role, user.vendorId);
  }
}
