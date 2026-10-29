import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

export const MVP_ZONES = ['Hyderabad', 'Vijayawada'];
export const DEFAULT_DELIVERY_RADIUS = 10;
export const DEFAULT_COD_CAP = 2000;
export const MAX_COD_CAP = 2000;

@Injectable()
export class ZonesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateZoneDto) {
    const city = dto.city || dto.name;

    const existing = await this.prisma.zone.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`Zone "${dto.name}" already exists`);
    }

    return this.prisma.zone.create({
      data: {
        name: dto.name,
        city,
        pincodes: dto.pincodes ?? [],
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll() {
    const zones = await this.prisma.zone.findMany({
      include: {
        _count: {
          select: { vendors: true, deliveryPartners: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      city: z.city,
      pincodes: z.pincodes,
      isActive: z.isActive,
      createdAt: z.createdAt,
      updatedAt: z.updatedAt,
      deliveryRadius: DEFAULT_DELIVERY_RADIUS,
      codCap: DEFAULT_COD_CAP,
      vendorCount: z._count.vendors,
      _count: { vendors: z._count.vendors, deliveryPartners: z._count.deliveryPartners },
    }));
  }

  async findOne(id: string) {
    const zone = await this.prisma.zone.findUnique({
      where: { id },
      include: {
        _count: {
          select: { vendors: true, deliveryPartners: true },
        },
      },
    });

    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    return {
      id: zone.id,
      name: zone.name,
      city: zone.city,
      pincodes: zone.pincodes,
      isActive: zone.isActive,
      createdAt: zone.createdAt,
      updatedAt: zone.updatedAt,
      deliveryRadius: DEFAULT_DELIVERY_RADIUS,
      codCap: DEFAULT_COD_CAP,
      vendorCount: zone._count.vendors,
      _count: { vendors: zone._count.vendors, deliveryPartners: zone._count.deliveryPartners },
    };
  }

  async update(id: string, dto: UpdateZoneDto) {
    await this.findOne(id);

    if (dto.codCap !== undefined && dto.codCap > MAX_COD_CAP) {
      throw new BadRequestException(`COD cap cannot exceed ₹${MAX_COD_CAP.toLocaleString()}`);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.pincodes !== undefined) data.pincodes = dto.pincodes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.zone.update({
      where: { id },
      data,
      include: {
        _count: {
          select: { vendors: true, deliveryPartners: true },
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      city: updated.city,
      pincodes: updated.pincodes,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      deliveryRadius: dto.deliveryRadius ?? DEFAULT_DELIVERY_RADIUS,
      codCap: dto.codCap ?? DEFAULT_COD_CAP,
      vendorCount: updated._count.vendors,
      _count: { vendors: updated._count.vendors, deliveryPartners: updated._count.deliveryPartners },
    };
  }

  async remove(id: string) {
    await this.findOne(id);

    const vendorCount = await this.prisma.vendor.count({ where: { zoneId: id } });
    if (vendorCount > 0) {
      throw new BadRequestException(
        `Cannot delete zone with ${vendorCount} active vendor(s). Deactivate the zone instead.`,
      );
    }

    await this.prisma.zone.delete({ where: { id } });
    return { deleted: true };
  }

  async validateZone(zoneId: string): Promise<{ valid: boolean; error?: string }> {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) {
      return { valid: false, error: 'Zone not found' };
    }
    if (!zone.isActive) {
      return { valid: false, error: 'This zone is currently not active' };
    }
    const cityLower = zone.city.toLowerCase();
    const isMvpZone = MVP_ZONES.some((z) => z.toLowerCase() === cityLower);
    if (!isMvpZone) {
      return {
        valid: false,
        error: `We currently serve only ${MVP_ZONES.join(' and ')}. Your location is outside our service area.`,
      };
    }
    return { valid: true };
  }

  async validateCodAmount(zoneId: string, amount: number): Promise<{ valid: boolean; error?: string }> {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) {
      return { valid: false, error: 'Zone not found' };
    }
    if (!zone.isActive) {
      return { valid: false, error: 'Zone is not active' };
    }
    if (amount > MAX_COD_CAP) {
      return {
        valid: false,
        error: `COD orders are capped at ₹${MAX_COD_CAP.toLocaleString()}`,
      };
    }
    return { valid: true };
  }

  async validatePincode(pincode: string): Promise<{ valid: boolean; zone?: any; error?: string }> {
    const zone = await this.prisma.zone.findFirst({
      where: {
        pincodes: { has: pincode },
        isActive: true,
      },
    });

    if (!zone) {
      return {
        valid: false,
        error: `Pincode ${pincode} is not serviceable. We currently serve Hyderabad and Vijayawada.`,
      };
    }

    const cityLower = zone.city.toLowerCase();
    const isMvpZone = MVP_ZONES.some((z) => z.toLowerCase() === cityLower);
    if (!isMvpZone) {
      return {
        valid: false,
        error: `Pincode ${pincode} belongs to a zone outside the MVP service area.`,
      };
    }

    return {
      valid: true,
      zone: {
        id: zone.id,
        name: zone.name,
        city: zone.city,
        isActive: zone.isActive,
      },
    };
  }

  async findByPincode(pincode: string) {
    return this.prisma.zone.findFirst({
      where: {
        pincodes: { has: pincode },
      },
    });
  }
}
