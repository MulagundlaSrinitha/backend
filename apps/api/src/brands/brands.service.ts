import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { StoreType } from '@prisma/client';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBrandDto) {
    const existing = await this.prisma.brand.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Brand with this slug already exists');
    }

    return this.prisma.brand.create({ data: dto });
  }

  async findAll(storeType?: StoreType) {
    const where = storeType ? { storeType } : {};
    return this.prisma.brand.findMany({
      where,
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto) {
    await this.findOne(id);

    if (dto.slug) {
      const slugExists = await this.prisma.brand.findUnique({
        where: { slug: dto.slug },
      });
      if (slugExists && slugExists.id !== id) {
        throw new ConflictException('Brand with this slug already exists');
      }
    }

    return this.prisma.brand.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);

    const productCount = await this.prisma.product.count({ where: { brandId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${productCount} products. Deactivate it instead.`,
      );
    }

    return this.prisma.brand.delete({ where: { id } });
  }
}
