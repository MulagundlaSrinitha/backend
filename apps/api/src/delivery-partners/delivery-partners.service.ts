import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryPartnerStatus, UserRole } from '@prisma/client';
import { CreateDeliveryPartnerDto } from './dto/create-delivery-partner.dto';


@Injectable()
export class DeliveryPartnersService {
  private readonly logger = new Logger(DeliveryPartnersService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private readonly statusMap: Record<string, DeliveryPartnerStatus> = {
    PENDING: DeliveryPartnerStatus.OFFLINE,
    SUSPENDED: DeliveryPartnerStatus.OFFLINE,
    REJECTED: DeliveryPartnerStatus.OFFLINE,
    OFFLINE: DeliveryPartnerStatus.OFFLINE,
    AVAILABLE: DeliveryPartnerStatus.AVAILABLE,
    ON_DELIVERY: DeliveryPartnerStatus.ON_DELIVERY,
  };

  private readonly userSelect = {
    id: true,
    email: true,
    name: true,
    phone: true,
    avatarUrl: true,
  };
  async create(dto: CreateDeliveryPartnerDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.DELIVERY_PARTNER) {
      throw new BadRequestException('User is not a delivery partner');
    }

    const existing = await this.prisma.deliveryPartner.findUnique({
      where: { userId: dto.userId },
    });

    if (existing) {
      throw new BadRequestException('Delivery partner already exists');
    }

    return this.prisma.deliveryPartner.create({
      data: {
        userId: dto.userId,
        vehicleType: dto.vehicleType,
        zoneId: dto.zoneId,
      },
      include: {
        user: {
          select: this.userSelect,
        },
        zone: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
      },
    });
  }

  async setup(userId: string, dto: { vehicleType: string; zoneId: string }) {
    const existing = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('Delivery partner profile already exists');
    }

    const zone = await this.prisma.zone.findUnique({
      where: { id: dto.zoneId },
    });

    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    if (!zone.isActive) {
      throw new BadRequestException('Zone is not active');
    }

    return this.prisma.deliveryPartner.create({
      data: {
        userId,
        vehicleType: dto.vehicleType,
        zoneId: dto.zoneId,
        status: DeliveryPartnerStatus.AVAILABLE,
      },
      include: {
        user: {
          select: this.userSelect,
        },
        zone: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
      },
    });
  }

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }) {
    const { page, limit, search, status } = params;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { phone: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) {
      const mappedStatus = this.statusMap[status];
      if (mappedStatus) {
        where.status = mappedStatus;
      }
    }

    const [partners, total] = await Promise.all([
      this.prisma.deliveryPartner.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              ...this.userSelect,
              kyc: { select: { id: true, status: true, documentType: true } },
            },
          },
          zone: { select: { id: true, name: true, city: true } },
          _count: {
            select: {
              assignments: { where: { deliveredAt: { not: null } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.deliveryPartner.count({ where }),
    ]);

    const mapped = partners.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user.name,
      email: p.user.email,
      phone: p.user.phone,
      user: p.user,
      vehicleType: p.vehicleType,
      zone: p.zone,
      status: p.status,
      currentLat: p.currentLat,
      currentLng: p.currentLng,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      completedDeliveries: p._count.assignments,
      rating: null,
    }));

    return {
      items: mapped,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            ...this.userSelect,
            kyc: {
              select: {
                id: true,
                status: true,
                documentType: true,
                documentNumber: true,
                submittedAt: true,
                verifiedAt: true,
              },
            },
          },
        },
        zone: true,
        _count: {
          select: {
            assignments: { where: { deliveredAt: { not: null } } },
          },
        },
      },
    });

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return {
      id: partner.id,
      userId: partner.userId,
      name: partner.user.name,
      email: partner.user.email,
      phone: partner.user.phone,
      user: partner.user,
      vehicleType: partner.vehicleType,
      zone: partner.zone,
      status: partner.status,
      currentLat: partner.currentLat,
      currentLng: partner.currentLng,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
      completedDeliveries: partner._count.assignments,
      rating: null,
    };
  }

  async updateStatus(id: string, status: string) {
    const partner = await this.prisma.deliveryPartner.findUnique({ where: { id } });
    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const mappedStatus = this.statusMap[status];
    if (!mappedStatus) {
      throw new BadRequestException(
        `Invalid status: ${status}. Valid statuses: OFFLINE, AVAILABLE, ON_DELIVERY`,
      );
    }

    return this.prisma.deliveryPartner.update({
      where: { id },
      data: { status: mappedStatus },
      include: {
        user: { select: this.userSelect },
        zone: { select: { id: true, name: true, city: true } },
      },
    });
  }
}
