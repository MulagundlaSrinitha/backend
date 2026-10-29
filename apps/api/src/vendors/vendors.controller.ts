import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, ParseEnumPipe, ParseIntPipe, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { UploadVendorKycDocumentDto } from './dto/upload-vendor-kyc-document.dto';
import { ReviewVendorKycDocumentDto } from './dto/review-vendor-kyc-document.dto';
import { QueryVendorsDto } from './dto/query-vendors.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole, StoreType, VendorKycDocumentType } from '@prisma/client';

interface TransactionQueryDto {
  page?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
}

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard)
  async register(@CurrentUser('id') userId: string, @Body() dto: CreateVendorDto) {
    return this.vendorsService.register(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findAll(@Query() query: QueryVendorsDto) {
    return this.vendorsService.findAll(query);
  }

  @Get('storefront/:storeType')
  async getStorefrontVendors(@Param('storeType', new ParseEnumPipe(StoreType)) storeType: StoreType) {
    return this.vendorsService.getStorefrontVendors(storeType);
  }

  @Get('my-profile')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@CurrentUser('id') userId: string) {
    return this.vendorsService.getVendorByUserId(userId);
  }

  @Patch('my-profile')
  @UseGuards(JwtAuthGuard)
  async updateMyProfile(
    @Body() dto: UpdateVendorDto,
    @CurrentUser('id') userId: string,
  ) {
    const vendor = await this.vendorsService.getVendorByUserId(userId);
    if (!vendor) throw new NotFoundException('Vendor profile not found');
    return this.vendorsService.update(vendor.id, dto, userId);
  }

  @Get('me/payouts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyPayouts(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.vendorsService.getVendorPayouts(vendorId);
  }

  @Get('me/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyAnalytics(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.vendorsService.getAnalytics(vendorId);
  }

  @Get('me/earnings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyEarnings(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.vendorsService.getVendorEarnings(vendorId);
  }

  @Get('me/transactions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyTransactions(
    @CurrentUser('vendorId') vendorId: string,
    @Query() query: TransactionQueryDto,
  ) {
    if (!vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.vendorsService.getVendorTransactions(vendorId, {
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get('me/customers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyCustomers(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) {
      throw new ForbiddenException('You do not have a vendor profile');
    }
    return this.vendorsService.getCustomers(vendorId);
  }

  // ── Vendor KYC (self-service) ─────────────────────────────────────────

  @Get('me/kyc')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyKyc(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) throw new ForbiddenException('You do not have a vendor profile');
    return this.vendorsService.getMyKycOverview(vendorId);
  }

  @Post('me/kyc/documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadMyKycDocument(
    @CurrentUser('vendorId') vendorId: string,
    @Body() dto: UploadVendorKycDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!vendorId) throw new ForbiddenException('You do not have a vendor profile');
    if (!file) throw new BadRequestException('File is required');
    return this.vendorsService.uploadKycDocument(vendorId, dto.documentType, file);
  }

  @Get('me/kyc/documents/:documentId/url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMyKycDocumentUrl(
    @CurrentUser('vendorId') vendorId: string,
    @Param('documentId') documentId: string,
  ) {
    if (!vendorId) throw new ForbiddenException('You do not have a vendor profile');
    return this.vendorsService.getKycDocumentSignedUrl(vendorId, documentId);
  }

  @Post('me/kyc/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async submitMyKyc(@CurrentUser('vendorId') vendorId: string) {
    if (!vendorId) throw new ForbiddenException('You do not have a vendor profile');
    return this.vendorsService.submitForVerification(vendorId);
  }

  @Get(':id/storefront')
  async getStorefront(@Param('id') id: string) {
    return this.vendorsService.findOne(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.vendorsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.vendorsService.update(id, dto, userId);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approve(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.vendorsService.approve(id, adminId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.vendorsService.updateStatus(id, status, adminId);
  }

  @Get(':id/detail')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAdminDetail(@Param('id') id: string) {
    return this.vendorsService.getAdminDetail(id);
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getVendorStats(@Param('id') id: string) {
    return this.vendorsService.getVendorStats(id);
  }

  // ── Vendor KYC (admin review) ─────────────────────────────────────────

  @Get(':id/kyc/documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getVendorKycDocuments(@Param('id') id: string) {
    return this.vendorsService.getVendorKycDocumentsForAdmin(id);
  }

  @Get(':id/kyc/documents/:documentId/url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getVendorKycDocumentUrl(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.vendorsService.adminGetKycDocumentSignedUrl(id, documentId);
  }

  @Patch(':id/kyc/documents/:documentId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reviewVendorKycDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: ReviewVendorKycDocumentDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.vendorsService.adminReviewKycDocument(id, documentId, adminId, dto.status, dto.rejectionReason);
  }

  @Get(':id/products')
  async getVendorProducts(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.vendorsService.getVendorProducts(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }
}
