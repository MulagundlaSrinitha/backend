import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { StoreType } from '@prisma/client';

@Injectable()
export class SubCategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSubCategoryDto) {
    // Verify parent category exists
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundException('Parent category not found');
    }

    // Check slug uniqueness per storeType
    const existing = await this.prisma.subCategory.findFirst({
      where: { slug: dto.slug, storeType: dto.storeType },
    });
    if (existing) {
      throw new ConflictException('Sub-category with this slug already exists for this store type');
    }

    return this.prisma.subCategory.create({
      data: dto,
      include: { category: { select: { name: true } } },
    });
  }

  async findAll(categoryId?: string, storeType?: StoreType) {
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (storeType) where.storeType = storeType;

    return this.prisma.subCategory.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const subCategory = await this.prisma.subCategory.findUnique({
      where: { id },
      include: { category: true, products: { take: 10 } },
    });
    if (!subCategory) throw new NotFoundException('Sub-category not found');
    return subCategory;
  }

  async update(id: string, dto: UpdateSubCategoryDto) {
    await this.findOne(id);

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new NotFoundException('Parent category not found');
      }
    }

    return this.prisma.subCategory.update({
      where: { id },
      data: dto,
      include: { category: { select: { name: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const productCount = await this.prisma.product.count({
      where: { subCategoryId: id },
    });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete sub-category with ${productCount} products. Deactivate it instead.`,
      );
    }

    return this.prisma.subCategory.delete({ where: { id } });
  }
}
