import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

// Collapses vendor.kycDocuments (an approved-NPOP-certificate lookup, see the
// `kycDocuments` select above) into a plain boolean the customer app can
// trust for the "NPOP Verified" badge — Organic products from a vendor
// without an admin-approved certificate must never render as verified.
function withNpopVerified<T extends { vendor?: { kycDocuments?: { id: string }[] } | null }>(product: T): T {
  if (!product.vendor) return product;
  const { kycDocuments, ...vendor } = product.vendor as any;
  return { ...product, vendor: { ...vendor, isNpopVerified: (kycDocuments?.length ?? 0) > 0 } };
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private async findVendorByUserId(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new ForbiddenException('You need a vendor profile to manage products');
    return vendor;
  }

  async create(userId: string, dto: CreateProductDto) {
    const vendor = await this.findVendorByUserId(userId);

    // Verify category exists
    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Category not found');

    return this.prisma.product.create({
      data: {
        vendorId: vendor.id,
        name: dto.name,
        description: dto.description || null,
        categoryId: dto.categoryId,
        subCategoryId: dto.subCategoryId || null,
        brandId: dto.brandId || null,
        price: dto.price,
        compareAtPrice: dto.compareAtPrice || null,
        unit: dto.unit,
        stock: dto.stock,
        images: dto.images || [],
        isActive: dto.isActive ?? true,
        // New products require admin approval before appearing in public listings
        isApproved: dto.isApproved ?? false,
        ...(dto.variants && dto.variants.length > 0
          ? {
              variants: {
                create: dto.variants.map((v) => ({
                  name: v.name,
                  price: v.price,
                  stock: v.stock ?? 0,
                  sku: v.sku || null,
                })),
              },
            }
          : {}),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { storeName: true, deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true } },
        variants: true,
      },
    });
  }

  async findAll(query: QueryProductsDto) {
    const {
      storeType,
      categoryId,
      vendorId,
      minPrice,
      maxPrice,
      search,
      isActive,
      isApproved,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = query;

    const where: any = {};

    if (storeType) {
      where.vendor = { storeType };
    }
    if (categoryId) where.categoryId = categoryId;
    if (vendorId) where.vendorId = vendorId;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    } else {
      // By default, show only active products for public browsing
      where.isActive = true;
    }
    if (isApproved !== undefined) {
      where.isApproved = isApproved === 'true';
    } else if (!vendorId) {
      // Only filter by approval for public (cross-vendor) browsing.
      // When viewing a specific vendor's catalog (vendor dashboard, admin
      // vendor view), show all products regardless of approval status so
      // the list isn't silently empty for new vendors.
      where.isApproved = true;
    }

    const skip = (page - 1) * limit;

    const orderBy: any = {};
    const validSortFields = ['price', 'name', 'createdAt', 'stock'];
    const field = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    orderBy[field] = sortOrder === 'asc' ? 'asc' : 'desc';

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          vendor: {
            select: {
              id: true, storeName: true, storeSlug: true,
              deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true,
              kycDocuments: {
                where: { documentType: 'NPOP_CERTIFICATE', status: 'APPROVED' },
                select: { id: true },
                take: 1,
              },
            },
          },
          _count: { select: { reviews: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products.map(withNpopVerified),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true, storeType: true } },
        subCategory: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        vendor: {
          select: {
            id: true,
            storeName: true,
            storeSlug: true,
            logoUrl: true,
            status: true,
            kycDocuments: {
              where: { documentType: 'NPOP_CERTIFICATE', status: 'APPROVED' },
              select: { id: true },
              take: 1,
            },
          },
        },
        variants: true,
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true, avatarUrl: true } } },
        },
        _count: { select: { reviews: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return withNpopVerified(product);
  }

  async update(userId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    // Verify ownership: vendor owns this product or user is admin
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor || vendor.id !== product.vendorId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== 'ADMIN') {
        throw new ForbiddenException('You can only update your own products');
      }
    }

    // Strip isApproved from the update data — product approval must go through
    // the dedicated PATCH /products/:id/approve endpoint (admin-only) to prevent
    // vendors from self-approving their own products.
    // Strip variants too — Prisma's nested-write shape for updating a relation
    // isn't a bare array, and there's no variant-editing endpoint yet.
    const { isApproved, variants, ...safeDto } = dto;

    return this.prisma.product.update({
      where: { id: productId },
      data: safeDto,
      include: {
        category: { select: { name: true } },
        vendor: { select: { storeName: true, deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true } },
      },
    });
  }

  async remove(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor || vendor.id !== product.vendorId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== 'ADMIN') {
        throw new ForbiddenException('You can only delete your own products');
      }
    }

    // Soft delete
    return this.prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
  }

  async approve(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.isApproved) throw new ConflictException('Product is already approved');

    return this.prisma.product.update({
      where: { id: productId },
      data: { isApproved: true, isActive: true },
      include: {
        category: { select: { name: true } },
        vendor: { select: { storeName: true, deliveryTimeMin: true, deliveryTimeMax: true, deliveryLabel: true } },
      },
    });
  }

  async getVendorStats(vendorId: string) {
    const [total, active, inactive] = await Promise.all([
      this.prisma.product.count({ where: { vendorId } }),
      this.prisma.product.count({ where: { vendorId, isActive: true } }),
      this.prisma.product.count({ where: { vendorId, isActive: false } }),
    ]);

    return { total, active, inactive };
  }
}
