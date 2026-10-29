import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCmsPageDto } from './dto/create-cms-page.dto';
import { UpdateCmsPageDto } from './dto/update-cms-page.dto';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { StoreType } from '@prisma/client';

@Injectable()
export class CmsService {
  constructor(private prisma: PrismaService) {}

  // ── Page Methods ─────────────────────────────────────────────────

  async createPage(dto: CreateCmsPageDto) {
    const existing = await this.prisma.cMS_Page.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('CMS page with this slug already exists');
    }

    return this.prisma.cMS_Page.create({ data: dto });
  }

  async findAllPages(isPublished?: boolean) {
    const where = isPublished !== undefined ? { isPublished } : {};
    return this.prisma.cMS_Page.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPageBySlug(slug: string) {
    const page = await this.prisma.cMS_Page.findUnique({
      where: { slug },
    });
    if (!page) throw new NotFoundException('CMS page not found');
    return page;
  }

  async updatePage(id: string, dto: UpdateCmsPageDto) {
    const page = await this.prisma.cMS_Page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('CMS page not found');

    if (dto.slug) {
      const slugExists = await this.prisma.cMS_Page.findUnique({
        where: { slug: dto.slug },
      });
      if (slugExists && slugExists.id !== id) {
        throw new ConflictException('CMS page with this slug already exists');
      }
    }

    return this.prisma.cMS_Page.update({ where: { id }, data: dto });
  }

  async removePage(id: string) {
    const page = await this.prisma.cMS_Page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('CMS page not found');

    return this.prisma.cMS_Page.delete({ where: { id } });
  }

  // ── Banner Methods ───────────────────────────────────────────────

  async createBanner(dto: CreateBannerDto) {
    return this.prisma.banner.create({
      data: {
        ...dto,
        position: dto.position ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAllBanners(storeType?: StoreType, isActive?: boolean) {
    const where: any = {};
    if (storeType) where.storeType = storeType;
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.banner.findMany({
      where,
      orderBy: { position: 'asc' },
    });
  }

  async findOneBanner(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    await this.findOneBanner(id);
    return this.prisma.banner.update({ where: { id }, data: dto });
  }

  async removeBanner(id: string) {
    await this.findOneBanner(id);
    return this.prisma.banner.delete({ where: { id } });
  }
}
