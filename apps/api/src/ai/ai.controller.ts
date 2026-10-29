import { Controller, Post, Get, Body, Query, UseGuards, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /ai/chat - Send message to AI assistant
   */
  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @Throttle({ ai: { ttl: 60000, limit: 20 } })
  async chat(
    @Req() req: any,
    @Body() body: { message: string; context?: { productId?: string; orderId?: string } },
  ) {
    const userId = req.user.id;
    return this.aiService.chat(userId, body.message, body.context);
  }

  /**
   * POST /ai/scan - Scan product image
   */
  @Post('scan')
  @UseGuards(JwtAuthGuard)
  @Throttle({ ai: { ttl: 60000, limit: 10 } })
  @UseInterceptors(FileInterceptor('file'))
  async scan(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user.id;
    return this.aiService.scanProduct(userId, file.buffer);
  }

  /**
   * GET /ai/recommendations - Get personalized recommendations
   */
  @Get('recommendations')
  @UseGuards(JwtAuthGuard)
  async getRecommendations(
    @Req() req: any,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.aiService.getRecommendations(userId, limitNum);
  }

  /**
   * GET /ai/health-insights - Get health insights
   */
  @Get('health-insights')
  @UseGuards(JwtAuthGuard)
  async getHealthInsights(@Req() req: any) {
    const userId = req.user.id;
    return this.aiService.getHealthInsights(userId);
  }

  /**
   * GET /ai/chat-history - Get chat history
   */
  @Get('chat-history')
  @UseGuards(JwtAuthGuard)
  async getChatHistory(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.aiService.getChatHistory(userId, pageNum, limitNum);
  }

  /**
   * GET /ai/admin/logs - Get AI logs (admin only)
   */
  @Get('admin/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getAdminLogs(
    @Query('type') type?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.aiService.getAdminLogs({
      type,
      userId,
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  /**
   * GET /ai/admin/analytics - Get AI analytics (admin only)
   */
  @Get('admin/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getAdminAnalytics(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const dateRange = start && end ? { start, end } : undefined;
    return this.aiService.getAdminAnalytics(dateRange);
  }
}
