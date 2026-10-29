import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, DeliveryPartnerStatus, Prisma } from '@prisma/client';
import { canTransition } from '../common/order-status-transitions';
import { EarningsPeriod } from './dto/earnings-query.dto';

const PAYOUT_SUMMARY_SELECT = {
  id: true,
  amount: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  paidAt: true,
  createdAt: true,
} as const;

type PayoutSummary = Prisma.PayoutGetPayload<{
  select: typeof PAYOUT_SUMMARY_SELECT;
}>;

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

const AUTO_ASSIGN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Flat delivery-partner fee charged per completed delivery (rupees).
// Single source of truth for earnings + weekly payouts in this module —
// mirrors the payments module's own DELIVERY_FEE so the two never diverge.
export const DELIVERY_FEE = 40;

// The platform is India-only (Hyderabad/Vijayawada; Asia/Kolkata = UTC+05:30).
// All financial period windows are IST-correct: boundaries are computed in IST
// and converted back to UTC for Prisma queries. No date library required.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function startOfTodayIst(): Date {
  const istMs = Date.now() + IST_OFFSET_MS;
  const ist = new Date(istMs);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIst - IST_OFFSET_MS);
}

function startOfWeekIst(): Date {
  const istMs = Date.now() + IST_OFFSET_MS;
  const ist = new Date(istMs);
  // Week starts Sunday (matches the pre-existing week definition).
  const startIst = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() - ist.getUTCDay(),
  );
  return new Date(startIst - IST_OFFSET_MS);
}

function startOfMonthIst(): Date {
  const istMs = Date.now() + IST_OFFSET_MS;
  const ist = new Date(istMs);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  return new Date(startIst - IST_OFFSET_MS);
}

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Map a live DeliveryAssignment's OrderVendorGroup status to the
 * delivery-app vocabulary. The DB OrderStatus enum and the mobile
 * DeliveryStatus union both exist — this is the explicit bridge between
 * them (no `as` casts hiding mismatched strings).
 *
 * The three courier-reported legs (GOING_TO_PICKUP, ARRIVED_AT_PICKUP,
 * ARRIVED_AT_CUSTOMER) pass through under their own names so the app can
 * show each step instead of collapsing them into the neighbouring state.
 *
 * DB:      ASSIGNED_TO_DELIVERY | GOING_TO_PICKUP | ARRIVED_AT_PICKUP |
 *          PICKED_UP | OUT_FOR_DELIVERY | ARRIVED_AT_CUSTOMER | DELIVERED
 * Mobile:  ASSIGNED              | GOING_TO_PICKUP| ARRIVED_AT_PICKUP |
 *          PICKING_UP            | IN_TRANSIT      | ARRIVED_AT_CUSTOMER |
 *          DELIVERED
 */
function mapActiveStatus(assignment: any): string {
  const groupStatus = assignment.orderVendorGroup.status;
  if (groupStatus === OrderStatus.OUT_FOR_DELIVERY) return 'IN_TRANSIT';
  if (groupStatus === OrderStatus.PICKED_UP) return 'PICKING_UP';
  if (groupStatus === OrderStatus.DELIVERED) return 'DELIVERED';
  if (groupStatus === OrderStatus.GOING_TO_PICKUP) return 'GOING_TO_PICKUP';
  if (groupStatus === OrderStatus.ARRIVED_AT_PICKUP) return 'ARRIVED_AT_PICKUP';
  if (groupStatus === OrderStatus.ARRIVED_AT_CUSTOMER) return 'ARRIVED_AT_CUSTOMER';
  return 'ASSIGNED';
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Resolve the DeliveryPartner record from the authenticated user ID.
   * Throws 404 if the user has no delivery partner profile.
   */
  private async getPartnerByUserId(userId: string) {
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
      include: {
        zone: { select: { id: true, name: true, city: true } },
      },
    });
    if (!partner) {
      throw new NotFoundException('Delivery partner profile not found');
    }
    return partner;
  }

  /**
   * PATCH /delivery/availability
   * Toggle delivery partner online/offline status.
   */
  async updateAvailability(userId: string, isAvailable: boolean) {
    const partner = await this.getPartnerByUserId(userId);

    // Cannot go available if currently on a delivery
    if (isAvailable && partner.status === DeliveryPartnerStatus.ON_DELIVERY) {
      throw new BadRequestException(
        'Cannot go online while on an active delivery',
      );
    }

    const newStatus = isAvailable
      ? DeliveryPartnerStatus.AVAILABLE
      : DeliveryPartnerStatus.OFFLINE;

    return this.prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: { status: newStatus },
      select: {
        id: true,
        status: true,
        currentLat: true,
        currentLng: true,
        updatedAt: true,
      },
    });
  }

  /**
   * PATCH /delivery/location
   * Update the delivery partner's current GPS coordinates.
   */
  async updateLocation(userId: string, lat: number, lng: number) {
    const partner = await this.getPartnerByUserId(userId);

    return this.prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: { currentLat: lat, currentLng: lng },
      select: {
        id: true,
        currentLat: true,
        currentLng: true,
        updatedAt: true,
      },
    });
  }

  /**
   * GET /delivery/new-orders
   * Returns OrderVendorGroups ready for delivery in the partner's zone.
   * These are vendor groups with status CONFIRMED or PACKED that have no DeliveryAssignment.
   */
  async getNewOrders(userId: string, page: number, limit: number) {
    const partner = await this.getPartnerByUserId(userId);
    const skip = (page - 1) * limit;

    // Find vendor groups that:
    // 1. Belong to a vendor in the same zone as the delivery partner
    // 2. Are in READY_FOR_PICKUP status (vendor has explicitly marked it ready)
    // 3. Have no DeliveryAssignment yet
    // Previously also checked CONFIRMED and PACKED — now only READY_FOR_PICKUP
    // ensures the vendor has explicitly signalled readiness before a DP can
    // claim the order (the vendor marks PACKED → READY_FOR_PICKUP first).
    const where = {
      status: { in: [OrderStatus.READY_FOR_PICKUP] },
      vendor: { zoneId: partner.zoneId },
      delivery: null,
      // Never re-offer a group the partner has already declined.
      rejections: { none: { deliveryPartnerId: partner.id } },
    };

    const [groups, total] = await Promise.all([
      this.prisma.orderVendorGroup.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              totalAmount: true,
              paymentMethod: true,
              status: true,
              createdAt: true,
              user: {
                select: { id: true, name: true, phone: true },
              },
              address: {
                select: {
                  id: true,
                  fullAddress: true,
                  city: true,
                  state: true,
                  pincode: true,
                  lat: true,
                  lng: true,
                  label: true,
                },
              },
            },
          },
          vendor: {
            select: {
              id: true,
              storeName: true,
              storeType: true,
            },
          },
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true, unit: true },
              },
            },
          },
        },
        orderBy: { order: { createdAt: 'desc' } },
        skip,
        take: limit,
      }),
      this.prisma.orderVendorGroup.count({ where }),
    ]);

    const items = groups.map((g) =>
      this.formatOrderForDelivery(g, g.status),
    );

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * GET /delivery/active
   * Returns orders currently assigned to this delivery partner that are not yet delivered.
   */
  async getActiveDeliveries(userId: string, page: number, limit: number) {
    const partner = await this.getPartnerByUserId(userId);
    const skip = (page - 1) * limit;

    const where = {
      deliveryPartnerId: partner.id,
      deliveredAt: null,
    };

    const [assignments, total] = await Promise.all([
      this.prisma.deliveryAssignment.findMany({
        where,
        include: {
          orderVendorGroup: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNo: true,
                  totalAmount: true,
                  paymentMethod: true,
                  status: true,
                  createdAt: true,
                  user: {
                    select: { id: true, name: true, phone: true },
                  },
                  address: {
                    select: {
                      id: true,
                      fullAddress: true,
                      city: true,
                      state: true,
                      pincode: true,
                      lat: true,
                      lng: true,
                      label: true,
                    },
                  },
                },
              },
              vendor: {
                select: {
                  id: true,
                  storeName: true,
                  storeType: true,
                },
              },
              items: {
                include: {
                  product: {
                    select: { id: true, name: true, images: true, unit: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deliveryAssignment.count({ where }),
    ]);

    const items = assignments.map((a) => {
      const formatted = this.formatOrderForDelivery(
        a.orderVendorGroup,
        mapActiveStatus(a),
      );
      formatted.deliveryAssignment = {
        id: a.id,
        assignedAt: a.assignedAt,
        pickedUpAt: a.pickedUpAt,
        deliveredAt: a.deliveredAt,
      };
      return formatted;
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * GET /delivery/history
   * Returns completed deliveries for this partner.
   */
  async getDeliveryHistory(userId: string, page: number, limit: number) {
    const partner = await this.getPartnerByUserId(userId);
    const skip = (page - 1) * limit;

    const where = {
      deliveryPartnerId: partner.id,
      deliveredAt: { not: null },
    };

    const [assignments, total] = await Promise.all([
      this.prisma.deliveryAssignment.findMany({
        where,
        include: {
          orderVendorGroup: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNo: true,
                  totalAmount: true,
                  paymentMethod: true,
                  status: true,
                  createdAt: true,
                  user: {
                    select: { id: true, name: true, phone: true },
                  },
                  address: {
                    select: {
                      id: true,
                      fullAddress: true,
                      city: true,
                      state: true,
                      pincode: true,
                      lat: true,
                      lng: true,
                      label: true,
                    },
                  },
                },
              },
              vendor: {
                select: {
                  id: true,
                  storeName: true,
                  storeType: true,
                },
              },
              items: {
                include: {
                  product: {
                    select: { id: true, name: true, images: true, unit: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { deliveredAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deliveryAssignment.count({ where }),
    ]);

    const items = assignments.map((a) => {
      const formatted = this.formatOrderForDelivery(
        a.orderVendorGroup,
        'DELIVERED',
      );
      formatted.deliveryAssignment = {
        id: a.id,
        assignedAt: a.assignedAt,
        pickedUpAt: a.pickedUpAt,
        deliveredAt: a.deliveredAt,
      };
      return formatted;
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
 * Format an OrderVendorGroup into the flat shape the delivery app expects.
 */
private formatOrderForDelivery(group: any, deliveryStatus: string) {
    const order = group.order;
    const totalEarnings = group.items.reduce(
      (sum: number, item: any) =>
        sum + Number(item.priceAtPurchase) * item.quantity,
      0,
    );

    return {
      id: group.id,
      groupId: group.id,
      orderId: order.id,
      orderNumber: order.orderNo,
      status: deliveryStatus,
      total: Number(order.totalAmount),
      subtotal: Number(group.subtotal),
      deliveryFee: DELIVERY_FEE,
      totalEarnings,
      createdAt: order.createdAt,
      paymentMethod: order.paymentMethod,
      user: order.user
        ? { name: order.user.name, phone: order.user.phone }
        : null,
      address: order.address
        ? {
            id: order.address.id,
            fullAddress: order.address.fullAddress,
            city: order.address.city,
            state: order.address.state,
            pincode: order.address.pincode,
            lat: order.address.lat,
            lng: order.address.lng,
            label: order.address.label,
          }
        : null,
      vendor: group.vendor,
      items: group.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        priceAtPurchase: Number(item.priceAtPurchase),
        product: item.product,
      })),
      deliveryAssignment: null as any,
    };
  }

  /**
   * POST /orders/:id/assign
   * Admin assigns a delivery partner to an OrderVendorGroup. Finds the first
   * unassigned vendor group in the order that falls within the partner's zone.
   */
  async assignOrder(orderId: string, deliveryPartnerId: string) {
    // Find the delivery partner
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { id: deliveryPartnerId },
      include: {
        zone: { select: { id: true, name: true, city: true } },
      },
    });
    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    if (partner.status !== DeliveryPartnerStatus.AVAILABLE) {
      throw new BadRequestException(
        'Delivery partner must be AVAILABLE to receive assignments',
      );
    }

    // Find the order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: {
            vendor: { select: { id: true, storeName: true, zoneId: true } },
            items: true,
          },
        },
        address: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Find the first vendor group that:
    // 1. Is in READY_FOR_PICKUP status (vendor has explicitly marked it)
    // 2. Belongs to a vendor in the partner's zone
    // 3. Has no existing DeliveryAssignment
    const eligibleGroup = order.vendorGroups.find(
      (g: any) =>
        g.status === OrderStatus.READY_FOR_PICKUP &&
        g.vendor.zoneId === partner.zoneId &&
        !g.delivery,
    );

    if (!eligibleGroup) {
      throw new BadRequestException(
        'No delivery assignments available for this order in your zone',
      );
    }

    const otp = generateOtp();

    // Create assignment and update statuses in a transaction
    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryAssignment.create({
        data: {
          orderVendorGroupId: eligibleGroup.id,
          deliveryPartnerId: partner.id,
          otp,
        },
        include: {
          orderVendorGroup: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNo: true,
                  totalAmount: true,
                  paymentMethod: true,
                  createdAt: true,
                  user: { select: { id: true, name: true, phone: true } },
                  address: {
                    select: {
                      fullAddress: true,
                      city: true,
                      state: true,
                      pincode: true,
                      lat: true,
                      lng: true,
                    },
                  },
                },
              },
              vendor: { select: { id: true, storeName: true } },
              items: true,
            },
          },
        },
      });

      // Update vendor group status to ASSIGNED_TO_DELIVERY
      await tx.orderVendorGroup.update({
        where: { id: eligibleGroup.id },
        data: { status: OrderStatus.ASSIGNED_TO_DELIVERY },
      });

      // Update delivery partner status to ON_DELIVERY
      await tx.deliveryPartner.update({
        where: { id: partner.id },
        data: { status: DeliveryPartnerStatus.ON_DELIVERY },
      });

      return created;
    });

    return {
      id: assignment.id,
      otp: assignment.otp,
      assignedAt: assignment.assignedAt,
      orderVendorGroupId: assignment.orderVendorGroupId,
      status: 'ASSIGNED',
      order: {
        id: assignment.orderVendorGroup.order.id,
        orderNumber: assignment.orderVendorGroup.order.orderNo,
        total: Number(assignment.orderVendorGroup.order.totalAmount),
        user: assignment.orderVendorGroup.order.user,
        address: assignment.orderVendorGroup.order.address,
      },
      vendor: assignment.orderVendorGroup.vendor,
    };
  }

  /**
   * POST /delivery/claim
   * A delivery partner accepts a delivery request (an OrderVendorGroup in
   * READY_FOR_PICKUP with no assignment yet) by group id. Zone check first,
   * then a transactional claim so two partners can never grab the same group:
   * the winning updateMany (status READY_FOR_PICKUP & no assignment) is the
   * lock; a losing claim rolls back and gets 409.
   */
  async claimOrder(userId: string, orderVendorGroupId: string) {
    const partner = await this.getPartnerByUserId(userId);

    const group = await this.prisma.orderVendorGroup.findUnique({
      where: { id: orderVendorGroupId },
      include: {
        vendor: { select: { id: true, storeName: true, zoneId: true } },
        delivery: true,
        order: {
          select: {
            id: true,
            orderNo: true,
            totalAmount: true,
            paymentMethod: true,
            createdAt: true,
            user: { select: { id: true, name: true, phone: true } },
            address: {
              select: {
                fullAddress: true,
                city: true,
                state: true,
                pincode: true,
                lat: true,
                lng: true,
              },
            },
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, images: true, unit: true } },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Delivery request not found');
    }

    if (group.vendor.zoneId !== partner.zoneId) {
      throw new ForbiddenException(
        'This delivery request is outside your zone',
      );
    }

    if (group.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new ConflictException(
        `Delivery request is no longer available (current status: ${group.status})`,
      );
    }

    if (group.delivery) {
      throw new ConflictException('Delivery request has already been accepted');
    }

    const otp = generateOtp();

    const assignment = await this.prisma.$transaction(async (tx) => {
      // The claim lock: only transitions if the group is still READY_FOR_PICKUP
      // AND has no assignment. A concurrent claim by another partner updates 0
      // rows and we roll back with 409.
      const claimed = await tx.orderVendorGroup.updateMany({
        where: {
          id: group.id,
          status: OrderStatus.READY_FOR_PICKUP,
          delivery: null,
        },
        data: { status: OrderStatus.ASSIGNED_TO_DELIVERY },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'Delivery request has already been accepted',
        );
      }

      const created = await tx.deliveryAssignment.create({
        data: {
          orderVendorGroupId: group.id,
          deliveryPartnerId: partner.id,
          otp,
        },
      });

      await tx.deliveryPartner.update({
        where: { id: partner.id },
        data: { status: DeliveryPartnerStatus.ON_DELIVERY },
      });

      return created;
    });

    const formatted = this.formatOrderForDelivery(group, 'ASSIGNED');
    formatted.deliveryAssignment = {
      id: assignment.id,
      assignedAt: assignment.assignedAt,
      pickedUpAt: null,
      deliveredAt: null,
    };

    return formatted;
  }

  /**
   * POST /delivery/reject
   * A partner declines a delivery request. The decline is persisted (one row
   * per partner+group) so getNewOrders stops offering it to them, and — if the
   * partner had already been assigned the group but hasn't picked up — the
   * assignment is released back to READY_FOR_PICKUP for another partner.
   * Idempotent: repeating the same decline is a no-op.
   */
  async declineOrder(
    userId: string,
    orderVendorGroupId: string,
    reason?: string,
  ) {
    const partner = await this.getPartnerByUserId(userId);

    // Persist the decline (upsert = repeat-call safe).
    await this.prisma.deliveryRejection.upsert({
      where: {
        deliveryPartnerId_orderVendorGroupId: {
          deliveryPartnerId: partner.id,
          orderVendorGroupId,
        },
      },
      create: {
        deliveryPartnerId: partner.id,
        orderVendorGroupId,
        reason: reason || null,
      },
      update: {},
    });

    // Release any assignment the partner holds on this group that hasn't been
    // picked up yet.
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId,
        deliveryPartnerId: partner.id,
        pickedUpAt: null,
      },
    });

    if (assignment) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deliveryAssignment.delete({
          where: { id: assignment.id },
        });

        await tx.orderVendorGroup.update({
          where: { id: orderVendorGroupId },
          data: { status: OrderStatus.READY_FOR_PICKUP },
        });

        const activeCount = await tx.deliveryAssignment.count({
          where: {
            deliveryPartnerId: partner.id,
            deliveredAt: null,
          },
        });
        if (activeCount === 0) {
          await tx.deliveryPartner.update({
            where: { id: partner.id },
            data: { status: DeliveryPartnerStatus.AVAILABLE },
          });
        }
      });
    }

    return { message: 'Delivery request declined', success: true };
  }

  /**
   * Auto-assign the nearest available Delivery Partner to an OrderVendorGroup
   * that is in READY_FOR_PICKUP status. Uses haversine distance from the
   * delivery address to each partner's last known GPS coordinates.
   * If no partner is available, schedules a fallback retry after AUTO_ASSIGN_TIMEOUT_MS.
   */
  async autoAssign(orderVendorGroupId: string) {
    const group = await this.prisma.orderVendorGroup.findUnique({
      where: { id: orderVendorGroupId },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            totalAmount: true,
            paymentMethod: true,
            createdAt: true,
            address: { select: { lat: true, lng: true } },
            user: { select: { id: true, name: true, phone: true } },
          },
        },
        vendor: { select: { id: true, storeName: true, zoneId: true } },
        delivery: true,
      },
    });

    if (!group) {
      this.logger.warn(`Auto-assign: OrderVendorGroup ${orderVendorGroupId} not found`);
      return null;
    }

    if (group.status !== OrderStatus.READY_FOR_PICKUP) {
      this.logger.warn(`Auto-assign: Group ${orderVendorGroupId} is ${group.status}, not READY_FOR_PICKUP`);
      return null;
    }

    if (group.delivery) {
      this.logger.warn(`Auto-assign: Group ${orderVendorGroupId} already has a DeliveryAssignment`);
      return null;
    }

    const orderAddress = group.order.address;
    if (!orderAddress?.lat == null|| !orderAddress?.lng == null) {
      this.logger.warn(`Auto-assign: Order ${group.order.id} has no delivery coordinates`);
      this.scheduleAutoAssignment(orderVendorGroupId);
      return null;
    }

    const availablePartners = await this.prisma.deliveryPartner.findMany({
      where: {
        zoneId: group.vendor.zoneId,
        status: DeliveryPartnerStatus.AVAILABLE,
        currentLat: { not: null },
        currentLng: { not: null },
      },
      select: {
        id: true,
        userId: true,
        currentLat: true,
        currentLng: true,
      },
    });

    if (availablePartners.length === 0) {
      this.logger.warn(`Auto-assign: No available DPs in zone ${group.vendor.zoneId} for group ${orderVendorGroupId}`);
      this.scheduleAutoAssignment(orderVendorGroupId);
      return null;
    }

    const partnersWithDistance = availablePartners
      .filter((p) => p.currentLat != null && p.currentLng != null)
      .map((p) => ({
        ...p,
        distance: haversineDistance(
          orderAddress.lat!,
          orderAddress.lng!,
          p.currentLat!,
          p.currentLng!,
        ),
      }))
      .sort((a, b) => a.distance - b.distance);

      if (partnersWithDistance.length === 0) {
        this.logger.warn(
          `Auto-assign: No delivery partners with valid coordinates found`,
        );
        this.scheduleAutoAssignment(orderVendorGroupId);
        return null;
      }
    const nearest = partnersWithDistance[0];
    const otp = generateOtp();

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryAssignment.create({
        data: {
          orderVendorGroupId: group.id,
          deliveryPartnerId: nearest.id,
          otp,
        },
      });

      await tx.orderVendorGroup.update({
        where: { id: group.id },
        data: { status: OrderStatus.ASSIGNED_TO_DELIVERY },
      });

      await tx.deliveryPartner.update({
        where: { id: nearest.id },
        data: { status: DeliveryPartnerStatus.ON_DELIVERY },
      });

      return created;
    });

    this.logger.log(
      `Auto-assigned DP ${nearest.id} (${nearest.distance.toFixed(1)}km) to group ${orderVendorGroupId}`,
    );

    return {
      id: assignment.id,
      otp: assignment.otp,
      assignedAt: assignment.assignedAt,
      orderVendorGroupId: group.id,
      status: 'AUTO_ASSIGNED',
      partner: { id: nearest.id, distance: nearest.distance },
      order: {
        id: group.order.id,
        orderNumber: group.order.orderNo,
        total: Number(group.order.totalAmount),
        user: group.order.user,
        address: group.order.address,
      },
      vendor: group.vendor,
    };
  }

  /**
   * Schedule a delayed auto-assign retry for an OrderVendorGroup.
   * After AUTO_ASSIGN_TIMEOUT_MS, if the group is still in READY_FOR_PICKUP
   * with no assignment, autoAssign will be called again. If still no DP is
   * available, the order remains in READY_FOR_PICKUP for manual assignment.
   */
  private scheduleAutoAssignment(orderVendorGroupId: string) {
    setTimeout(async () => {
      try {
        const group = await this.prisma.orderVendorGroup.findUnique({
          where: { id: orderVendorGroupId },
          select: { status: true, delivery: true },
        });

        if (!group) return;
        if (group.status !== OrderStatus.READY_FOR_PICKUP) return;
        if (group.delivery) return;

        this.logger.log(`Auto-assign fallback: retrying for group ${orderVendorGroupId}`);
        await this.autoAssign(orderVendorGroupId);
      } catch (error: any) {
        this.logger.error(`Auto-assign fallback failed for group ${orderVendorGroupId}: ${error.message}`);
      }
    }, AUTO_ASSIGN_TIMEOUT_MS);
  }

  /**
   * POST /orders/:id/reject
   * Decline or release a delivery assignment.
   * If the partner was assigned but hasn't picked up yet, release the assignment.
   * If the partner was never assigned, this is a no-op.
   */
  async rejectOrder(userId: string, orderId: string) {
    const partner = await this.getPartnerByUserId(userId);

    // Find the order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: {
            items: true,
            delivery: { select: { deliveryPartnerId: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Find a vendor group in this order assigned to this partner that hasn't been picked up
    const assignedGroupIds = order.vendorGroups
      .filter((g: any) => g.delivery?.deliveryPartnerId === partner.id)
      .map((g: any) => g.id);

    if (assignedGroupIds.length === 0) {
      // Not assigned to this partner — no-op
      return { message: 'Order rejected', success: true };
    }

    // Find the assignment that hasn't been picked up yet
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: assignedGroupIds },
        deliveryPartnerId: partner.id,
        pickedUpAt: null,
      },
    });

    if (!assignment) {
      // Already picked up — cannot reject
      throw new BadRequestException(
        'Cannot reject an order that has already been picked up',
      );
    }

    // Remove assignment and revert vendor group status
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryAssignment.delete({
        where: { id: assignment.id },
      });

      await tx.orderVendorGroup.update({
        where: { id: assignment.orderVendorGroupId },
        data: { status: OrderStatus.READY_FOR_PICKUP },
      });

      // Check if partner has any other active deliveries
      const activeCount = await tx.deliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          pickedUpAt: null,
        },
      });

      if (activeCount === 0) {
        await tx.deliveryPartner.update({
          where: { id: partner.id },
          data: { status: DeliveryPartnerStatus.AVAILABLE },
        });
      }
    });

    return { message: 'Order rejected', success: true };
  }

  /**
   * POST /orders/:id/going-to-pickup
   * ASSIGNED_TO_DELIVERY -> GOING_TO_PICKUP. The partner has accepted the
   * delivery and set off for the vendor. Purely informational: it touches no
   * DeliveryAssignment timestamp, it only advances the vendor group.
   */
  async goToPickup(userId: string, orderId: string) {
    return this.advanceDeliveryStatus(userId, orderId, OrderStatus.GOING_TO_PICKUP, {
      requirePickedUp: false,
      expectedFrom: [OrderStatus.ASSIGNED_TO_DELIVERY],
      alreadyThereMessage: 'Courier is already on the way to pickup',
    });
  }

  /**
   * POST /orders/:id/arrived-at-pickup
   * GOING_TO_PICKUP -> ARRIVED_AT_PICKUP. The partner is standing at the
   * vendor waiting on the pickup OTP.
   */
  async arriveAtPickup(userId: string, orderId: string) {
    return this.advanceDeliveryStatus(userId, orderId, OrderStatus.ARRIVED_AT_PICKUP, {
      requirePickedUp: false,
      expectedFrom: [OrderStatus.GOING_TO_PICKUP],
      alreadyThereMessage: 'Partner has already arrived at pickup',
    });
  }

  /**
   * POST /orders/:id/arrived-at-customer
   * OUT_FOR_DELIVERY -> ARRIVED_AT_CUSTOMER. The partner is at the drop
   * point; DELIVERED is the next (still separate) leg.
   */
  async arriveAtCustomer(userId: string, orderId: string) {
    return this.advanceDeliveryStatus(userId, orderId, OrderStatus.ARRIVED_AT_CUSTOMER, {
      requirePickedUp: true,
      expectedFrom: [OrderStatus.OUT_FOR_DELIVERY],
      alreadyThereMessage: 'Partner has already arrived at the customer',
    });
  }

  /**
   * Shared body for the intermediate delivery legs (GOING_TO_PICKUP,
   * ARRIVED_AT_PICKUP, ARRIVED_AT_CUSTOMER). One implementation so the three
   * endpoints cannot drift apart in their authorization, ordering or
   * idempotency behaviour.
   *
   * Ordering is enforced against the shared VALID_TRANSITIONS state machine
   * (../common/order-status-transitions) — never an ad-hoc check here — and
   * the write is a compare-and-set on the observed status so a double tap or
   * a concurrent request updates 0 rows and is rejected rather than
   * corrupting the lifecycle.
   */
  private async advanceDeliveryStatus(
    userId: string,
    orderId: string,
    target: OrderStatus,
    opts: {
      /** Leg sits after pickup, so the assignment must already be picked up. */
      requirePickedUp: boolean;
      /** The only states that may move to `target` (state-machine guard). */
      expectedFrom: OrderStatus[];
      /** Idempotent retry path — wording for "already in this state". */
      alreadyThereMessage: string;
    },
  ) {
    const partner = await this.getPartnerByUserId(userId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { vendorGroups: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const vendorGroupIds = order.vendorGroups.map((g) => g.id);

    // Scoped to this partner: another courier's delivery is a 404, never a
    // 403 that would confirm the order exists.
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: vendorGroupIds },
        deliveryPartnerId: partner.id,
        deliveredAt: null,
        ...(opts.requirePickedUp
          ? { pickedUpAt: { not: null } }
          : { pickedUpAt: null }),
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        opts.requirePickedUp
          ? 'No picked-up delivery assignment found for this order'
          : 'No active delivery assignment found for this order',
      );
    }

    const groupId = assignment.orderVendorGroupId;
    const group = await this.prisma.orderVendorGroup.findUnique({
      where: { id: groupId },
      select: { id: true, status: true },
    });

    const current = group?.status;
    if (!current) {
      throw new NotFoundException('Vendor group not found');
    }

    // Idempotent no-op: already in the target state (prior successful call, or
    // a concurrent request that won the race). Repeat calls must never
    // corrupt the lifecycle, and they must never throw.
    if (current === target) {
      return {
        message: opts.alreadyThereMessage,
        orderVendorGroupId: groupId,
        status: current,
      };
    }

    // Guard against a stale client: only the documented predecessor may
    // advance, and the shared state machine is the authority on legality.
    if (
      !opts.expectedFrom.includes(current) ||
      !canTransition(current, target)
    ) {
      throw new BadRequestException(
        `Cannot set status to ${target}: vendor group is in ${current} status. Expected one of: ${opts.expectedFrom.join(', ')}.`,
      );
    }

    const advanced = await this.prisma.orderVendorGroup.updateMany({
      where: { id: groupId, status: current },
      data: { status: target },
    });

    if (advanced.count !== 1) {
      // Someone else moved the group between our read and our write.
      throw new ConflictException(
        'Delivery status changed concurrently. Refresh and try again.',
      );
    }

    return {
      message: `Status updated to ${target}`,
      orderVendorGroupId: groupId,
      status: target,
    };
  }

  /**
   * POST /orders/:id/verify-pickup
   * Verify the pickup OTP for an assigned delivery. On success, marks the
   * assignment as picked up and updates the vendor group status.
   */
  async verifyPickup(userId: string, orderId: string, otp: string) {
    const partner = await this.getPartnerByUserId(userId);

    // Find the order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: {
          include: { items: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const vendorGroupIds = order.vendorGroups.map((g: any) => g.id);

    // Prefer the pending (not-yet-picked-up) assignment for a fresh OTP check;
    // fall back to an already-picked-up one only for the idempotent retry path.
    let assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: vendorGroupIds },
        deliveryPartnerId: partner.id,
        pickedUpAt: null,
      },
    });

    // Idempotent short-circuit: OTP was already verified on a prior call.
    if (!assignment) {
      assignment = await this.prisma.deliveryAssignment.findFirst({
        where: {
          orderVendorGroupId: { in: vendorGroupIds },
          deliveryPartnerId: partner.id,
          pickedUpAt: { not: null },
        },
      });
      if (assignment) {
        return {
          message: 'Pickup already verified',
          pickedUpAt: assignment.pickedUpAt,
        };
      }
    }

    if (!assignment) {
      throw new NotFoundException(
        'No delivery assignment found for this order',
      );
    }

    // Verify OTP
    if (assignment.otp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    // Mark as picked up and update status. The vendor group must be in a state
    // the state machine allows PICKED_UP from: ARRIVED_AT_PICKUP (the full
    // lifecycle) or ASSIGNED_TO_DELIVERY (the pre-existing short-cut). The OTP
    // above remains mandatory either way. Re-checked inside the transaction so
    // a concurrent transition can't slip an out-of-order pickup through.
    const PICKUP_ALLOWED_FROM: OrderStatus[] = [
      OrderStatus.ARRIVED_AT_PICKUP,
      OrderStatus.ASSIGNED_TO_DELIVERY,
    ];

    const updated = await this.prisma.$transaction(async (tx) => {
      const group = await tx.orderVendorGroup.findUnique({
        where: { id: assignment.orderVendorGroupId },
        select: { status: true },
      });

      if (
        !PICKUP_ALLOWED_FROM.includes(group?.status as OrderStatus) ||
        !canTransition(group?.status as string, OrderStatus.PICKED_UP)
      ) {
        throw new BadRequestException(
          `Cannot verify pickup: vendor group is in ${group?.status} status, expected ${PICKUP_ALLOWED_FROM.join(' or ')}.`,
        );
      }

      const a = await tx.deliveryAssignment.update({
        where: { id: assignment.id },
        data: { pickedUpAt: new Date() },
      });

      await tx.orderVendorGroup.update({
        where: { id: assignment.orderVendorGroupId },
        data: { status: OrderStatus.PICKED_UP },
      });

      return a;
    });

    return {
      message: 'Pickup verified successfully',
      pickedUpAt: updated.pickedUpAt,
    };
  }

  /**
   * POST /orders/:id/start-transit
   * Move a picked-up delivery onto the road: PICKED_UP -> OUT_FOR_DELIVERY.
   * This is the leg completeDelivery was skipping; the state machine requires
   * the partner to explicitly start transit before completing delivery.
   */
  async startTransit(userId: string, orderId: string) {
    const partner = await this.getPartnerByUserId(userId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { vendorGroups: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const vendorGroupIds = order.vendorGroups.map((g: any) => g.id);

    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: vendorGroupIds },
        deliveryPartnerId: partner.id,
        pickedUpAt: { not: null },
        deliveredAt: null,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        'No picked-up delivery assignment found for this order',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const group = await tx.orderVendorGroup.findUnique({
        where: { id: assignment.orderVendorGroupId },
      });
      // Idempotent no-op: group already out for delivery (prior successful call
      // or a concurrent startTransit won the race).
      if (group?.status === OrderStatus.OUT_FOR_DELIVERY) {
        return assignment;
      }
      if (group?.status !== OrderStatus.PICKED_UP) {
        throw new BadRequestException(
          `Cannot start transit: vendor group is in ${group?.status} status, expected ${OrderStatus.PICKED_UP}`,
        );
      }

      await tx.orderVendorGroup.update({
        where: { id: assignment.orderVendorGroupId },
        data: { status: OrderStatus.OUT_FOR_DELIVERY },
      });

      return assignment;
    });

    try {
      await this.notificationsService.sendOrderStatusNotification(
        orderId,
        'OUT_FOR_DELIVERY',
        order.userId,
      );
    } catch (error: any) {
      this.logger.error(`Transit notification failed: ${error.message}`);
    }

    return {
      message: 'Delivery out for delivery',
      orderVendorGroupId: updated.orderVendorGroupId,
    };
  }

  /**
   * POST /orders/:id/deliver
   * Mark a delivery as complete. Sets deliveredAt and updates the vendor group status.
   */
  async completeDelivery(userId: string, orderId: string) {
    const partner = await this.getPartnerByUserId(userId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        vendorGroups: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const vendorGroupIds = order.vendorGroups.map((g: any) => g.id);

    // Prefer the active (undelivered) assignment for the state-machine check;
    // fall back to an already-delivered one only for the idempotent retry path.
    let assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: vendorGroupIds },
        deliveryPartnerId: partner.id,
        deliveredAt: null,
      },
    });

    // Idempotent short-circuit: delivery was already completed on a prior call.
    if (!assignment) {
      assignment = await this.prisma.deliveryAssignment.findFirst({
        where: {
          orderVendorGroupId: { in: vendorGroupIds },
          deliveryPartnerId: partner.id,
          deliveredAt: { not: null },
        },
      });
      if (assignment) {
        return {
          message: 'Delivery already completed',
          deliveredAt: assignment.deliveredAt,
        };
      }
    }

    if (!assignment) {
      throw new NotFoundException(
        'No active delivery assignment found for this order',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Validate the vendor group is on the road before marking delivered.
      // OUT_FOR_DELIVERY is the pre-existing path; ARRIVED_AT_CUSTOMER is the
      // full lifecycle's final step before delivery. The direct
      // PICKED_UP -> DELIVERED jump bypasses the state machine and stays blocked.
      const DELIVER_ALLOWED_FROM: OrderStatus[] = [
        OrderStatus.ARRIVED_AT_CUSTOMER,
        OrderStatus.OUT_FOR_DELIVERY,
      ];
      const group = await tx.orderVendorGroup.findUnique({
        where: { id: assignment.orderVendorGroupId },
      });
      if (!DELIVER_ALLOWED_FROM.includes(group?.status as OrderStatus)) {
        // Idempotent no-op: a concurrent completeDelivery already delivered it.
        if (group?.status === OrderStatus.DELIVERED) {
          return assignment;
        }
        throw new BadRequestException(
          `Cannot deliver: vendor group is in ${group?.status} status, expected ${DELIVER_ALLOWED_FROM.join(' or ')}.`,
        );
      }

      const a = await tx.deliveryAssignment.update({
        where: { id: assignment.id },
        data: { deliveredAt: new Date() },
      });

      await tx.orderVendorGroup.update({
        where: { id: assignment.orderVendorGroupId },
        data: { status: OrderStatus.DELIVERED },
      });

      // Check if ALL vendor groups in the order are delivered → update
      // the order-level status to DELIVERED. paymentStatus is touched only
      // for COD (cash collected on delivery); Razorpay orders are already
      // PAID via webhook, and FAILED/REFUNDED must never be overwritten.
      const allGroups = await tx.orderVendorGroup.findMany({
        where: { orderId },
        select: { status: true },
      });
      const allDelivered = allGroups.every(
        (g: any) => g.status === OrderStatus.DELIVERED,
      );
      if (allDelivered) {
        const parentData: any = { status: OrderStatus.DELIVERED };
        if (order.paymentMethod === 'COD' && order.paymentStatus !== 'REFUNDED') {
          parentData.paymentStatus = 'PAID';
        }
        await tx.order.update({
          where: { id: orderId },
          data: parentData,
        });
      }

      // Check if partner has more active deliveries
      const activeCount = await tx.deliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          deliveredAt: null,
        },
      });

      if (activeCount === 0) {
        await tx.deliveryPartner.update({
          where: { id: partner.id },
          data: { status: DeliveryPartnerStatus.AVAILABLE },
        });
      }

      return a;
    });

    // Send delivery complete notification to the delivery partner
    try {
      await this.notificationsService.sendDeliveryCompletedNotification(
        partner.userId,
        orderId,
      );
    } catch (error: any) {
      this.logger.error(`Delivery complete notification failed: ${error.message}`);
    }

    // Send order delivered notification to the customer
    try {
      await this.notificationsService.sendOrderStatusNotification(
        orderId,
        'DELIVERED',
        order.userId,
      );
    } catch (error: any) {
      this.logger.error(`Order delivered notification failed: ${error.message}`);
    }

    return {
      message: 'Delivery completed',
      deliveredAt: updated.deliveredAt,
    };
  }

  /**
   * POST /delivery/failure
   * Report a failed delivery attempt (customer unavailable, wrong address, etc.).
   * Records the failure reason, releases the assignment, and reverts the vendor
   * group status so it can be reassigned. The admin reviews the failure record
   * and decides next steps.
   */
  async reportFailure(
    userId: string,
    orderId: string,
    reason: string,
    details?: string,
  ) {
    const partner = await this.getPartnerByUserId(userId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { vendorGroups: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const vendorGroupIds = order.vendorGroups.map((g: any) => g.id);

    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderVendorGroupId: { in: vendorGroupIds },
        deliveryPartnerId: partner.id,
        deliveredAt: null,
      },
    });
    if (!assignment) {
      throw new NotFoundException('No active delivery assignment found');
    }

    // Create failure record, release assignment, revert status — in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryFailure.create({
        data: {
          deliveryAssignmentId: assignment.id,
          reason,
          details: details || null,
        },
      });

      // Release the assignment
      await tx.deliveryAssignment.delete({
        where: { id: assignment.id },
      });

      // Revert vendor group to READY_FOR_PICKUP so it can be reassigned
      await tx.orderVendorGroup.update({
        where: { id: assignment.orderVendorGroupId },
        data: { status: OrderStatus.READY_FOR_PICKUP },
      });

      // Mark partner available if no other active deliveries
      const activeCount = await tx.deliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          deliveredAt: null,
        },
      });
      if (activeCount <= 1) {
        await tx.deliveryPartner.update({
          where: { id: partner.id },
          data: { status: DeliveryPartnerStatus.AVAILABLE },
        });
      }
    });

    return { message: 'Delivery failure reported', reason };
  }

  /**
   * GET /delivery/earnings?period=today|week|month|all
   * Calculate earnings for a delivery partner across all time windows.
   *
   * One stable response contract for every period value:
   *   period             — echoed requested period ('all' when omitted)
   *   totalEarnings      — earnings for the requested period (rupees)
   *   deliveryCount      — completed deliveries in the requested period
   *   averagePerDelivery — totalEarnings / deliveryCount for the period
   *   today/thisWeek/thisMonth/allTime — full breakdown (rupees)
   *   totalDeliveries    — all-time completed delivery count
   *
   * All windows are IST. A partner with no deliveries gets zeros, never an error.
   */
  async getEarnings(userId: string, period?: EarningsPeriod) {
    const partner = await this.getPartnerByUserId(userId);

    const buildWhere = (deliveredFrom?: Date) => ({
      deliveryPartnerId: partner.id,
      deliveredAt: deliveredFrom ? { gte: deliveredFrom } : { not: null },
    });

    const computeEarnings = (
      assignments: Array<{
        orderVendorGroup: {
          items: Array<{ priceAtPurchase: Prisma.Decimal; quantity: number }>;
        } | null;
      }>,
    ) => {
      const itemTotal = assignments.reduce((sum, a) => {
        const groupTotal =
          a.orderVendorGroup?.items.reduce(
            (s: number, item) => s + Number(item.priceAtPurchase) * item.quantity,
            0,
          ) ?? 0;
        return sum + groupTotal;
      }, 0);
      return itemTotal + assignments.length * DELIVERY_FEE;
    };

    const include = {
      orderVendorGroup: {
        select: {
          items: {
            select: { priceAtPurchase: true, quantity: true },
          },
        },
      },
    };

    const [todayDeliveries, weekDeliveries, monthDeliveries, allDeliveries] =
      await Promise.all([
        this.prisma.deliveryAssignment.findMany({
          where: buildWhere(startOfTodayIst()),
          include,
        }),
        this.prisma.deliveryAssignment.findMany({
          where: buildWhere(startOfWeekIst()),
          include,
        }),
        this.prisma.deliveryAssignment.findMany({
          where: buildWhere(startOfMonthIst()),
          include,
        }),
        this.prisma.deliveryAssignment.findMany({
          where: buildWhere(),
          include,
        }),
      ]);

    const today = computeEarnings(todayDeliveries);
    const thisWeek = computeEarnings(weekDeliveries);
    const thisMonth = computeEarnings(monthDeliveries);
    const allTime = computeEarnings(allDeliveries);
    const totalDeliveries = allDeliveries.length;

    const requested = period || 'all';
    const periodSlice = {
      today: { totalEarnings: today, deliveryCount: todayDeliveries.length },
      week: { totalEarnings: thisWeek, deliveryCount: weekDeliveries.length },
      month: { totalEarnings: thisMonth, deliveryCount: monthDeliveries.length },
      all: { totalEarnings: allTime, deliveryCount: totalDeliveries },
    }[requested];

    return {
      period: requested,
      totalEarnings: periodSlice.totalEarnings,
      deliveryCount: periodSlice.deliveryCount,
      averagePerDelivery:
        periodSlice.deliveryCount > 0
          ? periodSlice.totalEarnings / periodSlice.deliveryCount
          : 0,
      today,
      thisWeek,
      thisMonth,
      allTime,
      totalDeliveries,
    };
  }

  /**
   * GET /delivery/transactions
   * Paginated earnings ledger for the authenticated partner, derived from
   * completed DeliveryAssignments (the persisted delivery record) — no
   * fabricated financial rows. Each transaction = one completed delivery,
   * valued exactly like getEarnings (items total + DELIVERY_FEE).
   */
  async getDeliveryTransactions(userId: string, page = 1, limit = 20) {
    const partner = await this.getPartnerByUserId(userId);
    const skip = (page - 1) * limit;
    const where = { deliveryPartnerId: partner.id, deliveredAt: { not: null } };

    const [assignments, total] = await Promise.all([
      this.prisma.deliveryAssignment.findMany({
        where,
        include: {
          orderVendorGroup: {
            select: {
              order: { select: { id: true, orderNo: true } },
              items: {
                select: { priceAtPurchase: true, quantity: true },
              },
            },
          },
        },
        orderBy: { deliveredAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deliveryAssignment.count({ where }),
    ]);

    return {
      data: assignments.map((a) => this.formatDeliveryTransaction(a)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * GET /delivery/transactions/:id
   * Single transaction (completed delivery) owned by the authenticated partner.
   * 404 when the assignment does not exist OR belongs to another partner —
   * existence is never leaked cross-partner.
   */
  async getDeliveryTransaction(userId: string, id: string) {
    const partner = await this.getPartnerByUserId(userId);

    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: { id, deliveryPartnerId: partner.id, deliveredAt: { not: null } },
      include: {
        orderVendorGroup: {
          select: {
            order: { select: { id: true, orderNo: true } },
            items: {
              select: { priceAtPurchase: true, quantity: true },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Transaction not found');
    }

    return this.formatDeliveryTransaction(assignment);
  }

  /**
   * GET /delivery/payouts
   * Paginated payout history for the authenticated partner (Payout rows created
   * by the weekly cron), newest first. Empty history returns [] — never an error.
   */
  async getDeliveryPayouts(userId: string, page = 1, limit = 20) {
    const partner = await this.getPartnerByUserId(userId);
    const skip = (page - 1) * limit;
    const where = { deliveryPartnerId: partner.id };

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        select: PAYOUT_SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payout.count({ where }),
    ]);

    return {
      data: payouts.map((p) => this.formatPayout(p)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * GET /delivery/payouts/:id
   * Single payout owned by the authenticated partner. 404 when the payout does
   * not exist or belongs to another partner — existence is not leaked.
   */
  async getDeliveryPayout(userId: string, id: string) {
    const partner = await this.getPartnerByUserId(userId);

    const payout = await this.prisma.payout.findFirst({
      where: { id, deliveryPartnerId: partner.id },
      select: PAYOUT_SUMMARY_SELECT,
    });

    if (!payout) {
      throw new NotFoundException('Payout not found');
    }

    return this.formatPayout(payout);
  }

  private formatDeliveryTransaction(a: {
    id: string;
    deliveredAt: Date | null;
    orderVendorGroup: {
      order: { id: string; orderNo: string } | null;
      items: Array<{ priceAtPurchase: Prisma.Decimal; quantity: number }>;
    } | null;
  }) {
    const items = a.orderVendorGroup?.items ?? [];
    const itemsTotal = items.reduce(
      (sum, item) => sum + Number(item.priceAtPurchase) * item.quantity,
      0,
    );
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: a.id,
      orderId: a.orderVendorGroup?.order?.id ?? null,
      orderNumber: a.orderVendorGroup?.order?.orderNo ?? null,
      itemsTotal,
      deliveryFee: DELIVERY_FEE,
      amount: itemsTotal + DELIVERY_FEE,
      itemCount,
      deliveredAt: a.deliveredAt,
      status: 'DELIVERED',
    };
  }

  private formatPayout(p: PayoutSummary) {
    return {
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    };
  }

  /**
   * Weekly batch payout for Delivery Partners.
   * Processes completed deliveries that have not yet been included in a payout,
   * groups them by partner, calculates totals, and creates one Payout per partner.
   * Runs automatically every Monday at 00:05 AM.
   */
  @Cron('5 0 * * 1')
  async processWeeklyPayouts() {
    // Last completed week in IST, Sunday-start (Sun 00:00 → Sat 23:59:59.999).
    const istMs = Date.now() + IST_OFFSET_MS;
    const ist = new Date(istMs);
    const thisSundayIst = Date.UTC(
      ist.getUTCFullYear(),
      ist.getUTCMonth(),
      ist.getUTCDate() - ist.getUTCDay(),
    );
    const endOfLastWeek = new Date(thisSundayIst - 1);
    const startOfLastWeek = new Date(thisSundayIst - 7 * 24 * 60 * 60 * 1000);

    // Fetch all completed deliveries in the period
    const completedAssignments = await this.prisma.deliveryAssignment.findMany({
      where: {
        deliveredAt: { gte: startOfLastWeek, lte: endOfLastWeek },
      },
      include: {
        orderVendorGroup: {
          select: {
            vendorId: true,
            items: {
              select: { priceAtPurchase: true, quantity: true },
            },
          },
        },
      },
    });

    if (completedAssignments.length === 0) {
      return { periodStart: startOfLastWeek, periodEnd: endOfLastWeek, payouts: [] };
    }

    // Collect unique partner IDs
    const partnerIds = [...new Set(completedAssignments.map((a) => a.deliveryPartnerId))];

    // Fetch existing payouts for these partners in this period to exclude already-paid deliveries
    const existingPayouts = await this.prisma.payout.findMany({
      where: {
        deliveryPartnerId: { in: partnerIds },
        periodStart: startOfLastWeek,
        periodEnd: endOfLastWeek,
      },
      select: { deliveryPartnerId: true },
    });

    const paidPartnerIds = new Set(existingPayouts.map((p) => p.deliveryPartnerId));

    // Filter out partners who already have a payout for this period
    const unpaidPartnerIds = partnerIds.filter((id) => !paidPartnerIds.has(id));

    if (unpaidPartnerIds.length === 0) {
      return { periodStart: startOfLastWeek, periodEnd: endOfLastWeek, payouts: [] };
    }

    // Filter assignments to only unpaid partners
    const eligibleAssignments = completedAssignments.filter((a) =>
      unpaidPartnerIds.includes(a.deliveryPartnerId),
    );

    // Group by partner
    const partnerGroups = new Map<string, typeof eligibleAssignments>();
    for (const a of eligibleAssignments) {
      const list = partnerGroups.get(a.deliveryPartnerId) || [];
      list.push(a);
      partnerGroups.set(a.deliveryPartnerId, list);
    }

    // Create payout for each partner
    const payouts = await this.prisma.$transaction(
      Array.from(partnerGroups.entries()).map(([partnerId, assignments]) => {
        const itemTotal = assignments.reduce((sum, a) => {
          const groupTotal = a.orderVendorGroup.items.reduce(
            (s: number, item: any) => s + Number(item.priceAtPurchase) * item.quantity,
            0,
          );
          return sum + groupTotal;
        }, 0);

        const totalAmount = itemTotal + assignments.length * DELIVERY_FEE;

        return this.prisma.payout.create({
          data: {
            deliveryPartnerId: partnerId,
            amount: totalAmount,
            status: 'PENDING',
            periodStart: startOfLastWeek,
            periodEnd: endOfLastWeek,
          },
          select: {
            id: true,
            deliveryPartnerId: true,
            amount: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            createdAt: true,
          },
        });
      }),
    );

    return {
      periodStart: startOfLastWeek,
      periodEnd: endOfLastWeek,
      payouts,
    };
  }

  /**
   * POST /delivery/setup
   * Set up a delivery partner profile for the first time.
   * Creates a DeliveryPartner record linked to the authenticated user.
   */
  async setupPartner(userId: string, vehicleType: string, zoneName: string) {
    // Check if partner already has a profile
    const existing = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
      include: { zone: { select: { id: true, name: true } } },
    });
    if (existing) {
      // If zone name changed, look up the new zone
      let zoneId = existing.zoneId;
      if (zoneName && (existing.zone?.name !== zoneName)) {
        const newZone = await this.prisma.zone.findFirst({
          where: { name: { equals: zoneName, mode: 'insensitive' }, isActive: true },
        });
        if (!newZone) {
          throw new NotFoundException(
            `Zone "${zoneName}" not found. Available zones: Hyderabad, Vijayawada`,
          );
        }
        zoneId = newZone.id;
      }
      // Update existing profile instead
      return this.prisma.deliveryPartner.update({
        where: { id: existing.id },
        data: { vehicleType, zoneId },
        select: {
          id: true,
          vehicleType: true,
          status: true,
        },
      });
    }

    // Find the zone by name
    const zone = await this.prisma.zone.findFirst({
      where: { name: { equals: zoneName, mode: 'insensitive' }, isActive: true },
    });

    if (!zone) {
      throw new NotFoundException(
        `Zone "${zoneName}" not found. Available zones: Hyderabad, Vijayawada`,
      );
    }

    // Create the delivery partner profile
    return this.prisma.deliveryPartner.create({
      data: {
        userId,
        vehicleType,
        zoneId: zone.id,
        status: DeliveryPartnerStatus.OFFLINE,
      },
      include: {
        zone: { select: { id: true, name: true, city: true } },
      },
    });
  }

  /**
   * POST /delivery/process-payouts — manual trigger of the same weekly payout
   * run the Monday cron performs (see processWeeklyPayouts above).
   */
  async triggerWeeklyPayouts() {
    return this.processWeeklyPayouts();
  }

  /**
   * POST /delivery/auto-assign/:orderVendorGroupId
   * Automatically assign a delivery to the nearest available DP in the same zone.
   */
  async autoAssignDelivery(orderVendorGroupId: string) {
    const group = await this.prisma.orderVendorGroup.findUnique({
      where: { id: orderVendorGroupId },
      include: { vendor: true },
    });
    if (!group) throw new NotFoundException('Order vendor group not found');

    const availableDps = await this.prisma.deliveryPartner.findMany({
      where: {
        zoneId: group.vendor.zoneId,
        status: 'AVAILABLE',
      },
      orderBy: { updatedAt: 'asc' },
      take: 1,
    });

    if (availableDps.length === 0) {
      return { message: 'No available delivery partners' };
    }

    const dp = availableDps[0];
    const otp = crypto.randomInt(100000, 999999).toString();

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryAssignment.create({
        data: { orderVendorGroupId, deliveryPartnerId: dp.id, otp },
      });

      await tx.deliveryPartner.update({
        where: { id: dp.id },
        data: { status: 'ON_DELIVERY' },
      });

      await tx.orderVendorGroup.update({
        where: { id: orderVendorGroupId },
        data: { status: 'ASSIGNED_TO_DELIVERY' },
      });

      return created;
    });

    return assignment;
  }
}
