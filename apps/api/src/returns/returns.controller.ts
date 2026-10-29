import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { CreateReturnDto, ProcessReturnDto } from './dto/return.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('returns')
@UseGuards(JwtAuthGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateReturnDto) {
    return this.returnsService.create(user.id, dto);
  }

  //@Get()
  //findAll(@CurrentUser() user: any) {
   // return this.returnsService.findAll(user.id, user.role);
  //}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('status') status?: string,
  ) {
    return this.returnsService.findAll(user.id, user.role, status);
  }

  // Vendor-specific returns
  @Get('vendor')
  @UseGuards(RolesGuard)
  @Roles('VENDOR')
  findVendorReturns(@CurrentUser() user: any) {
    return this.returnsService.findAll(user.id, 'VENDOR');
  }

  @Get('refunds')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findRefunds() {
    return this.returnsService.findRefunds();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  async findOne(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
  ) {
    // Ownership enforced in service (findOne filters non-admins to their own returns)
    return this.returnsService.findOne(id, user.id, user.role);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  process(@Param('id') id: string, @Body() dto: ProcessReturnDto) {
    return this.returnsService.process(id, dto);
  }
}
