import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { PaymentsService } from './payments.service';
import {
  CreateRazorpayOrderDto,
  VerifyPaymentDto,
  RazorpayWebhookDto,
  PaymentQueryDto,
  ProcessDeliveryPayoutsDto,
  AutoSettleVendorsDto,
} from './dto/create-razorpay-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async findAll(
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.listPayments({
      status,
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post('razorpay/order')
  @UseGuards(JwtAuthGuard)
  createRazorpayOrder(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    return this.paymentsService.createRazorpayOrder(user.id, dto);
  }

  @Post('razorpay/verify')
  @UseGuards(JwtAuthGuard)
  @Throttle({ payment: { ttl: 60000, limit: 20 } })
  verifyPayment(
    @CurrentUser() user: { id: string },
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(user.id, dto);
  }

  @Post('razorpay/webhook')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: RazorpayWebhookDto,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      throw new UnauthorizedException('RAZORPAY_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Raw request body not available');
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(signature, 'hex');
    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return this.paymentsService.handleWebhook(dto);
  }

  @Post('refund/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  refund(@Param('orderId') orderId: string, @Body() dto: { reason?: string }) {
    return this.paymentsService.initiateRefund(orderId, dto.reason);
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  listPayments(@Query() query: PaymentQueryDto) {
    return this.paymentsService.listPayments(query);
  }

  @Post('process-delivery-payouts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  processDeliveryPayouts(@Body() dto: ProcessDeliveryPayoutsDto) {
    return this.paymentsService.processDeliveryPartnerPayouts(
      dto.periodStart,
      dto.periodEnd,
    );
  }

  @Post('auto-settle-vendors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  autoSettleVendors(@Body() dto: AutoSettleVendorsDto) {
    return this.paymentsService.autoSettleVendors(dto.threshold);
  }

  @Get('settlements/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getVendorSettlementInfo(@Param('vendorId') vendorId: string) {
    return this.paymentsService.getVendorSettlementInfo(vendorId);
  }

  @Get('analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getPaymentAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.paymentsService.getPaymentAnalytics(startDate, endDate);
  }

  @Get('list-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async listAll() {
    return this.paymentsService.listAll();
  }

  @Get(':orderId')
  @UseGuards(JwtAuthGuard)
  getPayments(
    @CurrentUser() user: { id: string; role: string },
    @Param('orderId') orderId: string,
  ) {
    return this.paymentsService.getPaymentsForOrder(orderId, user.id, user.role);
  }
}
