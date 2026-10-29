import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CmsService } from './cms.service';
import { CreateCmsPageDto } from './dto/create-cms-page.dto';
import { UpdateCmsPageDto } from './dto/update-cms-page.dto';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, StoreType } from '@prisma/client';

@Controller('cms')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  // ── Pages ────────────────────────────────────────────────────────

  @Post('pages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createPage(@Body() dto: CreateCmsPageDto) {
    return this.cmsService.createPage(dto);
  }

  @Get('pages')
  async findAllPages(@Query('isPublished') isPublished?: string) {
    return this.cmsService.findAllPages(
      isPublished !== undefined ? isPublished === 'true' : undefined,
    );
  }

  @Get('pages/:slug')
  async findPageBySlug(@Param('slug') slug: string) {
    return this.cmsService.findPageBySlug(slug);
  }

  @Patch('pages/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updatePage(@Param('id') id: string, @Body() dto: UpdateCmsPageDto) {
    return this.cmsService.updatePage(id, dto);
  }

  @Delete('pages/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async removePage(@Param('id') id: string) {
    return this.cmsService.removePage(id);
  }

  // ── Banners ──────────────────────────────────────────────────────

  @Post('banners')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createBanner(@Body() dto: CreateBannerDto) {
    return this.cmsService.createBanner(dto);
  }

  @Get('banners')
  async findAllBanners(
    @Query('storeType') storeType?: StoreType,
    @Query('isActive') isActive?: string,
  ) {
    return this.cmsService.findAllBanners(
      storeType,
      isActive !== undefined ? isActive === 'true' : undefined,
    );
  }

  @Get('banners/:id')
  async findOneBanner(@Param('id') id: string) {
    return this.cmsService.findOneBanner(id);
  }

  @Patch('banners/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.cmsService.updateBanner(id, dto);
  }

  @Delete('banners/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async removeBanner(@Param('id') id: string) {
    return this.cmsService.removeBanner(id);
  }
}
