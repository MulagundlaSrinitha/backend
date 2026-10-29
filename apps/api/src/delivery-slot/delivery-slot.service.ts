import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeliverySlotService {
  private readonly logger = new Logger(DeliverySlotService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get available delivery slots for a zone.
   * Returns slots for today and tomorrow (the two most common choices at checkout).
   * Each slot includes how many orders are already booked so the client can show
   * remaining capacity.
   */
  async getAvailableSlots(zoneId: string) {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException('Zone not found');

    const today = new Date();
    const todayDayOfWeek = today.getDay(); // 0=Sun
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDayOfWeek = tomorrow.getDay();

    // Fetch slot configs for today and tomorrow
    const configs = await this.prisma.deliverySlotConfig.findMany({
      where: {
        zoneId,
        dayOfWeek: { in: [todayDayOfWeek, tomorrowDayOfWeek] },
        isActive: true,
      },
    });

    // Get booking counts for today and tomorrow
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const bookings = await this.prisma.deliverySlotBooking.findMany({
      where: {
        slotConfigId: { in: configs.map((c) => c.id) },
        deliveryDate: { gte: todayStart, lte: tomorrowEnd },
      },
    });

    const bookingCountBySlot = new Map<string, number>();
    for (const b of bookings) {
      const key = `${b.slotConfigId}-${b.deliveryDate.toDateString()}`;
      bookingCountBySlot.set(key, (bookingCountBySlot.get(key) || 0) + 1);
    }

    // For slots that have already passed today, mark as unavailable
    const now = today.getHours() * 60 + today.getMinutes();

    const mapDate = (day: number) => {
      if (day === todayDayOfWeek) return today;
      return tomorrow;
    };

    const slotsToday = configs
      .filter((c) => c.dayOfWeek === todayDayOfWeek)
      .map((c) => {
        const [h, m] = c.startTime.split(':').map(Number);
        const slotStartMinutes = h * 60 + m;
        const booked = bookingCountBySlot.get(`${c.id}-${today.toDateString()}`) || 0;
        return {
          id: c.id,
          startTime: c.startTime,
          endTime: c.endTime,
          maxOrders: c.maxOrders,
          booked,
          available: c.maxOrders - booked,
          isPast: slotStartMinutes <= now,
          date: today.toISOString().split('T')[0],
        };
      })
      .filter((s) => !s.isPast);

    const slotsTomorrow = configs
      .filter((c) => c.dayOfWeek === tomorrowDayOfWeek)
      .map((c) => {
        const booked = bookingCountBySlot.get(`${c.id}-${tomorrow.toDateString()}`) || 0;
        return {
          id: c.id,
          startTime: c.startTime,
          endTime: c.endTime,
          maxOrders: c.maxOrders,
          booked,
          available: c.maxOrders - booked,
          isPast: false,
          date: tomorrow.toISOString().split('T')[0],
        };
      });

    return {
      today: {
        date: today.toISOString().split('T')[0],
        dayName: today.toLocaleDateString('en-IN', { weekday: 'long' }),
        slots: slotsToday,
      },
      tomorrow: {
        date: tomorrow.toISOString().split('T')[0],
        dayName: tomorrow.toLocaleDateString('en-IN', { weekday: 'long' }),
        slots: slotsTomorrow,
      },
    };
  }

  /**
   * Book a delivery slot for an order vendor group.
   * Returns the booking record.
   */
  async bookSlot(slotConfigId: string, orderVendorGroupId: string, deliveryDate: Date) {
    const config = await this.prisma.deliverySlotConfig.findUnique({
      where: { id: slotConfigId },
    });
    if (!config) throw new NotFoundException('Slot config not found');

    const timeRange = `${config.startTime}-${config.endTime}`;

    return this.prisma.deliverySlotBooking.create({
      data: {
        slotConfigId,
        orderVendorGroupId,
        deliveryDate,
        timeRange,
      },
    });
  }

  /**
   * Admin: create or update a delivery slot config.
   */
  async upsertSlot(data: {
    id?: string;
    zoneId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    maxOrders?: number;
  }) {
    if (data.id) {
      return this.prisma.deliverySlotConfig.update({
        where: { id: data.id },
        data: {
          startTime: data.startTime,
          endTime: data.endTime,
          maxOrders: data.maxOrders ?? 20,
        },
      });
    }
    return this.prisma.deliverySlotConfig.create({
      data: {
        zoneId: data.zoneId,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        maxOrders: data.maxOrders ?? 20,
      },
    });
  }
}
