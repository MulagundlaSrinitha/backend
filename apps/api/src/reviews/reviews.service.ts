import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReviewDto) {
    // Verify product exists
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Check if user already reviewed this product
    const existing = await this.prisma.review.findUnique({
      where: { userId_productId: { userId, productId: dto.productId } },
    });
    if (existing) {
      throw new ConflictException('You have already reviewed this product');
    }

    return this.prisma.review.create({
      data: {
        userId,
        productId: dto.productId,
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        isVerifiedPurchase: false, // Can be updated via order verification
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async getRatingSummary() {
    const [totalReviews, avgRating, ratingDistribution, topRated] = await Promise.all([
      this.prisma.review.count(),
      this.prisma.review.aggregate({ _avg: { rating: true } }),
      this.prisma.review.groupBy({
        by: ['rating'],
        _count: true,
        orderBy: { rating: 'desc' },
      }),
      this.prisma.review.groupBy({
        by: ['productId'],
        _avg: { rating: true },
        _count: true,
        orderBy: { _avg: { rating: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalReviews,
      averageRating: avgRating._avg.rating
        ? Number(avgRating._avg.rating.toFixed(1))
        : 0,
      ratingDistribution: ratingDistribution.map((r) => ({
        rating: r.rating,
        count: r._count,
      })),
      topRatedProducts: topRated.map((p) => ({
        productId: p.productId,
        averageRating: Number(p._avg.rating?.toFixed(1) || 0),
        totalReviews: p._count,
      })),
    };
  }

  async findByProduct(productId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [reviews, total, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.review.count({ where: { productId } }),
      this.prisma.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return {
      reviews,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      averageRating: aggregate._avg.rating
        ? Number(aggregate._avg.rating.toFixed(1))
        : 0,
      ratingsCount: aggregate._count.rating,
    };
  }

  async findAll(page = 1, limit = 20, rating?: number) {
  const skip = (page - 1) * limit;

  const where = rating ? { rating } : undefined;


  const [reviews, total] = await Promise.all([
    this.prisma.review.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            images: true,
          },
        },
      },
    }),
    this.prisma.review.count({
      where,
    }),
  ]);

  return {
    items : reviews,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

  async findByUser(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { userId },
      include: {
        product: {
          select: { id: true, name: true, images: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { reviews, count: reviews.length };
  }

  async delete(userId: string, reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId) {
      throw new NotFoundException('Review not found');
    }

    await this.prisma.review.delete({ where: { id: reviewId } });
    return { message: 'Review deleted' };
  }

  /*async getRatingsAggregate(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [overallAggregate, ratingDistribution, recentReviews, total] = await Promise.all([
      this.prisma.review.aggregate({
        _avg: { rating: true },
        _count: { rating: true },
        _min: { rating: true },
        _max: { rating: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        _count: true,
        orderBy: { rating: 'asc' },
      }),
      this.prisma.review.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          product: { select: { id: true, name: true, images: true } },
        },
      }),
      this.prisma.review.count(),
    ]);

    const distribution = [1, 2, 3, 4, 5].map((rating) => {
      const found = ratingDistribution.find((r) => r.rating === rating);
      return {
        rating,
        count: found ? found._count : 0,
        percentage: total > 0
          ? Math.round(((found ? found._count : 0) / total) * 100)
          : 0,
      };
    });

    return {
      summary: {
        averageRating: overallAggregate._avg.rating
          ? Number(overallAggregate._avg.rating.toFixed(1))
          : 0,
        totalReviews: overallAggregate._count.rating,
        minRating: overallAggregate._min.rating || 0,
        maxRating: overallAggregate._max.rating || 0,
      },
      distribution,
      recentReviews,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }*/
  async getRatingsAggregate(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [overallAggregate, ratingDistribution, recentReviews, total] =
    await Promise.all([
      this.prisma.review.aggregate({
        _avg: { rating: true },
        _count: { rating: true },
        _min: { rating: true },
        _max: { rating: true },
      }),

      this.prisma.review.groupBy({
        by: ['rating'],
        _count: true,
        orderBy: { rating: 'asc' },
      }),

      this.prisma.review.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              images: true,
            },
          },
        },
      }),

      this.prisma.review.count(),
    ]);

  const distribution = [1, 2, 3, 4, 5].map((rating) => {
    const found = ratingDistribution.find((r) => r.rating === rating);

    return {
      rating,
      count: found ? found._count : 0,
      percentage:
        total > 0
          ? Math.round(((found ? found._count : 0) / total) * 100)
          : 0,
    };
  });

  return {
    success: true,

    data: {
      items: recentReviews,

      summary: {
        averageRating: overallAggregate._avg.rating
          ? Number(overallAggregate._avg.rating.toFixed(1))
          : 0,
        totalReviews: overallAggregate._count.rating,
        minRating: overallAggregate._min.rating || 0,
        maxRating: overallAggregate._max.rating || 0,
      },

      distribution,
    },

    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
  }
}
