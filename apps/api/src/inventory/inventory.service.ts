import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryQueryDto, LowStockQueryDto, InventoryStockStatus } from './dto/inventory.dto';

/**
 * Single source of truth for "what counts as low stock".
 *
 * Previously the number 10 was hardcoded inside `updateStock` and separately
 * used as the default in `getLowStock`, while the admin table invented its own
 * fallback of 5 — so the Low Stock tab and the Status badge could disagree.
 * Both now derive from this constant.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Translates a stock-status bucket into a Prisma stock predicate.
   *
   * `out_of_stock` is `stock <= 0` and `low_stock` is strictly
   * `0 < stock < threshold`, which keeps the buckets disjoint — a zero-stock
   * product is never also counted as low stock, so the three counts plus "all"
   * always reconcile.
   */
  private stockWhere(status: InventoryStockStatus, threshold: number): Prisma.ProductWhereInput {
    switch (status) {
      case InventoryStockStatus.OUT_OF_STOCK:
        return { stock: { lte: 0 } };
      case InventoryStockStatus.LOW_STOCK:
        return { stock: { gt: 0, lt: threshold } };
      case InventoryStockStatus.IN_STOCK:
        return { stock: { gte: threshold } };
      default:
        return {};
    }
  }

  /**
   * Builds the row filter shared by `findMany` and every `count`, so the
   * paginated `meta.total` and the tab counts are always derived from the same
   * predicate set. Filtering only the in-memory page would make the totals and
   * the tab badges disagree with the table.
   */
  private buildWhere(query: InventoryQueryDto, vendorId?: string, threshold = DEFAULT_LOW_STOCK_THRESHOLD): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    if (vendorId) {
      where.vendorId = vendorId;
    }

    if (query.status && query.status !== InventoryStockStatus.ALL) {
      Object.assign(where, this.stockWhere(query.status, threshold));
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { vendor: { storeName: { contains: search, mode: 'insensitive' } } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  async findAll(query: InventoryQueryDto, vendorId?: string) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const threshold = query.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    const where = this.buildWhere(query, vendorId, threshold);

    // Counts for the tab badges ignore the status filter itself, so the
    // badges keep showing how many records each tab *would* return.
    const countScope = this.buildWhere({ ...query, status: InventoryStockStatus.ALL }, vendorId, threshold);

    const [data, total, allCount, outOfStockCount, lowStockCount, inStockCount] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          stock: true,
          unit: true,
          isActive: true,
          vendor: { select: { id: true, storeName: true } },
          category: { select: { id: true, name: true } },
          variants: {
            select: {
              id: true,
              name: true,
              sku: true,
              stock: true,
              price: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
      this.prisma.product.count({ where: countScope }),
      this.prisma.product.count({
        where: { ...countScope, ...this.stockWhere(InventoryStockStatus.OUT_OF_STOCK, threshold) },
      }),
      this.prisma.product.count({
        where: { ...countScope, ...this.stockWhere(InventoryStockStatus.LOW_STOCK, threshold) },
      }),
      this.prisma.product.count({
        where: { ...countScope, ...this.stockWhere(InventoryStockStatus.IN_STOCK, threshold) },
      }),
    ]);

    // SKU lives on ProductVariant, not Product, and there is no persisted
    // `lowStockThreshold` column. Surface both on the row so the client renders
    // real values instead of falling back to its own invented defaults.
    const rows = data.map((p) => ({
      ...p,
      sku: p.variants[0]?.sku ?? '',
      lowStockThreshold: threshold,
      stockStatus: this.resolveStockStatus(p.stock, threshold),
    }));

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        threshold,
        counts: {
          all: allCount,
          outOfStock: outOfStockCount,
          lowStock: lowStockCount,
          inStock: inStockCount,
        },
      },
    };
  }

  /**
   * The canonical stock-status rule, shared by the table's Status column and
   * the filter predicates above so a row can never be badged "IN STOCK" while
   * being excluded from the In Stock tab.
   */
  private resolveStockStatus(stock: number, threshold: number): InventoryStockStatus {
    if (stock <= 0) return InventoryStockStatus.OUT_OF_STOCK;
    if (stock < threshold) return InventoryStockStatus.LOW_STOCK;
    return InventoryStockStatus.IN_STOCK;
  }

  async updateStock(productId: string, quantity: number, userRole: string, userVendorId?: string) {
    if (!Number.isInteger(quantity)) {
      throw new BadRequestException('Stock quantity must be an integer');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (quantity < 0) {
      throw new BadRequestException('Stock quantity cannot be negative');
    }

    if (userRole === 'VENDOR' && product.vendorId !== userVendorId) {
      throw new ForbiddenException('You can only update stock for your own products');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { stock: quantity },
      select: {
        id: true,
        name: true,
        stock: true,
        unit: true,
      },
    });

    // Send low stock notification if below threshold
    const LOW_STOCK_THRESHOLD = DEFAULT_LOW_STOCK_THRESHOLD;
    if (updated.stock <= LOW_STOCK_THRESHOLD && updated.stock > 0) {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: product.vendorId },
      });
      if (vendor) {
        this.notificationsService
          .sendLowStockNotification(vendor.userId, updated.name, updated.stock, LOW_STOCK_THRESHOLD)
          .catch(() => {});
      }
    } else if (updated.stock === 0) {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: product.vendorId },
      });
      if (vendor) {
        this.notificationsService
          .sendOutOfStockNotification(vendor.userId, updated.name)
          .catch(() => {});
      }
    }

    return updated;
  }

  async getLowStock(query: LowStockQueryDto, vendorId?: string) {
    const threshold = query.threshold || DEFAULT_LOW_STOCK_THRESHOLD;
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      stock: { lt: threshold },
      isActive: true,
    };

    if (vendorId) {
      where.vendorId = vendorId;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          stock: true,
          unit: true,
          vendor: { select: { id: true, storeName: true } },
        },
        orderBy: { stock: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
