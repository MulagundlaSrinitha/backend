import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { StoreType } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { slug_storeType: { slug: dto.slug, storeType: dto.storeType } },
    });
    if (existing) {
      throw new ConflictException('Category with this slug already exists for this store type');
    }

    return this.prisma.category.create({ data: dto });
  }

  async findAll(storeType?: StoreType) {
    const where = storeType ? { storeType } : {};
    return this.prisma.category.findMany({
      where,
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { subCategories: true, products: { take: 10 } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete category with ${productCount} products. Deactivate it instead.`,
      );
    }

    return this.prisma.category.delete({ where: { id } });
  }
}
