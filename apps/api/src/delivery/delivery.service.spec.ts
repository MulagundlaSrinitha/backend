import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { DeliveryService } from './delivery.service';

const PARTNER_USER_ID = 'dp-user-1';
const ORDER_ID = 'order-1';
const GROUP_ID = 'grp-1';
const ASSIGNMENT_ID = 'asn-1';
const OTP = '123456';

type HarnessState = {
  groupStatus: OrderStatus;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  otp: string;
  /** false simulates "the order exists but this partner holds no assignment". */
  partnerHasAssignment: boolean;
  /** forces the compare-and-set write to miss (concurrent-update simulation). */
  updateManyCount?: number;
};

/**
 * Prisma/Notifications doubles. No database is touched: every read and write
 * resolves from the mutable `state` object, so a test can assert the exact
 * lifecycle the service produced.
 */
function createHarness(overrides: Partial<HarnessState> = {}) {
  const state: HarnessState = {
    groupStatus: OrderStatus.ASSIGNED_TO_DELIVERY,
    pickedUpAt: null,
    deliveredAt: null,
    otp: OTP,
    partnerHasAssignment: true,
    ...overrides,
  };

  const prisma: any = {
    deliveryPartner: {
      findUnique: jest.fn(async () => ({
        id: 'dp-1',
        userId: PARTNER_USER_ID,
        zoneId: 'zone-1',
        status: 'ON_DELIVERY',
      })),
      update: jest.fn(async () => ({})),
    },
    order: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        orderNo: 'N360-1',
        userId: 'customer-1',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
        vendorGroups: [{ id: GROUP_ID }],
      })),
      update: jest.fn(async () => ({})),
    },
    orderVendorGroup: {
      findUnique: jest.fn(async () => ({ id: GROUP_ID, status: state.groupStatus })),
      findMany: jest.fn(async () => [{ status: state.groupStatus }]),
      updateMany: jest.fn(async ({ data }: any) => {
        if (state.updateManyCount !== undefined) {
          return { count: state.updateManyCount };
        }
        state.groupStatus = data.status;
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        if (data.status) state.groupStatus = data.status;
        return { id: GROUP_ID };
      }),
    },
    deliveryAssignment: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (!state.partnerHasAssignment) return null;
        const w = where ?? {};
        const wantPickedUp = w.pickedUpAt?.not !== undefined;
        const wantNotPickedUp = w.pickedUpAt === null;
        const wantNotDelivered = w.deliveredAt === null;
        const wantDelivered = w.deliveredAt?.not !== undefined;

        if (wantPickedUp && !state.pickedUpAt) return null;
        if (wantNotPickedUp && state.pickedUpAt) return null;
        if (wantNotDelivered && state.deliveredAt) return null;
        if (wantDelivered && !state.deliveredAt) return null;

        return {
          id: ASSIGNMENT_ID,
          orderVendorGroupId: GROUP_ID,
          deliveryPartnerId: 'dp-1',
          otp: state.otp,
          pickedUpAt: state.pickedUpAt,
          deliveredAt: state.deliveredAt,
        };
      }),
      update: jest.fn(async ({ data }: any) => {
        if (data.pickedUpAt) state.pickedUpAt = data.pickedUpAt;
        if (data.deliveredAt) state.deliveredAt = data.deliveredAt;
        return {
          id: ASSIGNMENT_ID,
          pickedUpAt: state.pickedUpAt,
          deliveredAt: state.deliveredAt,
        };
      }),
      count: jest.fn(async () => 0),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const notificationsService: any = {
    sendOrderStatusNotification: jest.fn(async () => undefined),
    sendDeliveryCompletedNotification: jest.fn(async () => undefined),
  };

  const service = new DeliveryService(prisma, notificationsService);
  return { service, prisma, state, notificationsService };
}

describe('DeliveryService — delivery lifecycle transitions', () => {
  describe('the full ordered flow', () => {
    it('walks ASSIGNED_TO_DELIVERY → GOING_TO_PICKUP → ARRIVED_AT_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → ARRIVED_AT_CUSTOMER → DELIVERED', async () => {
      const { service, state } = createHarness();
      expect(state.groupStatus).toBe(OrderStatus.ASSIGNED_TO_DELIVERY);

      await service.goToPickup(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.GOING_TO_PICKUP);

      await service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_PICKUP);

      await service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP);
      expect(state.groupStatus).toBe(OrderStatus.PICKED_UP);
      expect(state.pickedUpAt).toBeInstanceOf(Date);

      await service.startTransit(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.OUT_FOR_DELIVERY);

      await service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_CUSTOMER);

      await service.completeDelivery(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.DELIVERED);
      expect(state.deliveredAt).toBeInstanceOf(Date);
    });
  });

  describe('valid transitions, one per leg', () => {
    it('accepts GOING_TO_PICKUP from ASSIGNED_TO_DELIVERY', async () => {
      const { service, state } = createHarness();
      const res = await service.goToPickup(PARTNER_USER_ID, ORDER_ID);
      expect(res.status).toBe(OrderStatus.GOING_TO_PICKUP);
      expect(state.groupStatus).toBe(OrderStatus.GOING_TO_PICKUP);
    });

    it('accepts ARRIVED_AT_PICKUP from GOING_TO_PICKUP', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.GOING_TO_PICKUP,
      });
      const res = await service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID);
      expect(res.status).toBe(OrderStatus.ARRIVED_AT_PICKUP);
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_PICKUP);
    });

    it('accepts PICKED_UP from ARRIVED_AT_PICKUP (OTP verified)', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_PICKUP,
      });
      await service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP);
      expect(state.groupStatus).toBe(OrderStatus.PICKED_UP);
    });

    it('still accepts the pre-existing ASSIGNED_TO_DELIVERY → PICKED_UP short-cut', async () => {
      const { service, state } = createHarness();
      await service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP);
      expect(state.groupStatus).toBe(OrderStatus.PICKED_UP);
    });

    it('accepts OUT_FOR_DELIVERY from PICKED_UP', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.PICKED_UP,
        pickedUpAt: new Date(),
      });
      await service.startTransit(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.OUT_FOR_DELIVERY);
    });

    it('accepts ARRIVED_AT_CUSTOMER from OUT_FOR_DELIVERY', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.OUT_FOR_DELIVERY,
        pickedUpAt: new Date(),
      });
      const res = await service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID);
      expect(res.status).toBe(OrderStatus.ARRIVED_AT_CUSTOMER);
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_CUSTOMER);
    });

    it('accepts DELIVERED from ARRIVED_AT_CUSTOMER', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_CUSTOMER,
        pickedUpAt: new Date(),
      });
      await service.completeDelivery(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.DELIVERED);
      expect(state.deliveredAt).toBeInstanceOf(Date);
    });

    it('still accepts the pre-existing OUT_FOR_DELIVERY → DELIVERED short-cut', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.OUT_FOR_DELIVERY,
        pickedUpAt: new Date(),
      });
      await service.completeDelivery(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.DELIVERED);
    });
  });

  describe('invalid / out-of-order transitions are rejected', () => {
    it('rejects ASSIGNED_TO_DELIVERY → ARRIVED_AT_PICKUP (skipped a leg)', async () => {
      const { service, state } = createHarness();
      await expect(service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.ASSIGNED_TO_DELIVERY);
    });

    it('rejects ASSIGNED_TO_DELIVERY → ARRIVED_AT_CUSTOMER', async () => {
      // pickedUpAt is set so the assignment IS found and the state machine is
      // what rejects, rather than the assignment lookup.
      const { service, state } = createHarness({ pickedUpAt: new Date() });
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.ASSIGNED_TO_DELIVERY);
    });

    it('404s on ARRIVED_AT_CUSTOMER when nothing was ever picked up', async () => {
      const { service } = createHarness();
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects GOING_TO_PICKUP → ARRIVED_AT_CUSTOMER', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.GOING_TO_PICKUP,
        pickedUpAt: new Date(),
      });
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.GOING_TO_PICKUP);
    });

    it('rejects GOING_TO_PICKUP → PICKED_UP (pickup before arrival)', async () => {
      const { service } = createHarness({
        groupStatus: OrderStatus.GOING_TO_PICKUP,
      });
      await expect(
        service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects ARRIVED_AT_PICKUP → DELIVERED', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_PICKUP,
        pickedUpAt: new Date(),
      });
      await expect(service.completeDelivery(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_PICKUP);
      expect(state.deliveredAt).toBeNull();
    });

    it('rejects PICKED_UP → DELIVERED (must go via OUT_FOR_DELIVERY / ARRIVED_AT_CUSTOMER)', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.PICKED_UP,
        pickedUpAt: new Date(),
      });
      await expect(service.completeDelivery(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.PICKED_UP);
    });

    it('rejects startTransit before pickup', async () => {
      const { service } = createHarness({
        groupStatus: OrderStatus.ASSIGNED_TO_DELIVERY,
        pickedUpAt: new Date(),
      });
      await expect(service.startTransit(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects any transition out of DELIVERED', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.DELIVERED,
        pickedUpAt: null,
        deliveredAt: null,
      });
      await expect(service.goToPickup(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.groupStatus).toBe(OrderStatus.DELIVERED);
    });

    it('rejects an invalid pickup OTP', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_PICKUP,
      });
      await expect(
        service.verifyPickup(PARTNER_USER_ID, ORDER_ID, '999999'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_PICKUP);
      expect(state.pickedUpAt).toBeNull();
    });

    it('404s for an unknown order', async () => {
      const { service, prisma } = createHarness();
      prisma.order.findUnique.mockResolvedValueOnce(null);
      await expect(service.goToPickup(PARTNER_USER_ID, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('repeated transitions are idempotent', () => {
    it('treats a repeated GOING_TO_PICKUP as a no-op and keeps the state intact', async () => {
      const { service, state, prisma } = createHarness();

      await service.goToPickup(PARTNER_USER_ID, ORDER_ID);
      expect(state.groupStatus).toBe(OrderStatus.GOING_TO_PICKUP);

      const res = await service.goToPickup(PARTNER_USER_ID, ORDER_ID);
      expect(res.status).toBe(OrderStatus.GOING_TO_PICKUP);
      expect(state.groupStatus).toBe(OrderStatus.GOING_TO_PICKUP);

      // Only the first call performed the write.
      expect(prisma.orderVendorGroup.updateMany).toHaveBeenCalledTimes(1);
    });

    it('treats a repeated ARRIVED_AT_PICKUP as a no-op', async () => {
      const { service, state, prisma } = createHarness({
        groupStatus: OrderStatus.GOING_TO_PICKUP,
      });
      await service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID);
      await expect(service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID)).resolves.toBeDefined();
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_PICKUP);
      expect(prisma.orderVendorGroup.updateMany).toHaveBeenCalledTimes(1);
    });

    it('treats a repeated ARRIVED_AT_CUSTOMER as a no-op', async () => {
      const { service, state } = createHarness({
        groupStatus: OrderStatus.OUT_FOR_DELIVERY,
        pickedUpAt: new Date(),
      });
      await service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID);
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).resolves.toBeDefined();
      expect(state.groupStatus).toBe(OrderStatus.ARRIVED_AT_CUSTOMER);
    });

    it('keeps the existing verify-pickup and complete-delivery retry paths idempotent', async () => {
      const { service } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_PICKUP,
      });
      await service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP);
      const retry = await service.verifyPickup(PARTNER_USER_ID, ORDER_ID, OTP);
      expect(retry.message).toBe('Pickup already verified');

      const { service: s2, state: st2 } = createHarness({
        groupStatus: OrderStatus.ARRIVED_AT_CUSTOMER,
        pickedUpAt: new Date(),
      });
      await s2.completeDelivery(PARTNER_USER_ID, ORDER_ID);
      const deliverRetry = await s2.completeDelivery(PARTNER_USER_ID, ORDER_ID);
      expect(deliverRetry.message).toBe('Delivery already completed');
      expect(st2.groupStatus).toBe(OrderStatus.DELIVERED);
    });

    it('rejects with 409 when a concurrent request wins the compare-and-set', async () => {
      const { service, prisma, state } = createHarness();
      prisma.orderVendorGroup.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.goToPickup(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(state.groupStatus).toBe(OrderStatus.ASSIGNED_TO_DELIVERY);
    });
  });

  describe('authorization', () => {
    it('404s when the caller has no delivery partner profile', async () => {
      const { service, prisma } = createHarness();
      prisma.deliveryPartner.findUnique.mockResolvedValue(null);

      await expect(service.goToPickup('random-user', ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.arriveAtPickup('random-user', ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.arriveAtCustomer('random-user', ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when another delivery partner holds the assignment (never a 403 that leaks existence)', async () => {
      const { service, state, prisma } = createHarness({
        partnerHasAssignment: false,
      });

      await expect(service.goToPickup(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // Nothing was written.
      expect(state.groupStatus).toBe(OrderStatus.ASSIGNED_TO_DELIVERY);
      expect(prisma.orderVendorGroup.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the assignment lookup to the authenticated partner', async () => {
      const { service, prisma } = createHarness();
      await service.goToPickup(PARTNER_USER_ID, ORDER_ID);

      const call = prisma.deliveryAssignment.findFirst.mock.calls[0][0];
      expect(call.where.deliveryPartnerId).toBe('dp-1');
      expect(call.where.orderVendorGroupId).toEqual({ in: [GROUP_ID] });
    });

    it('never writes a new status when the transition is rejected', async () => {
      const { service, prisma } = createHarness({
        groupStatus: OrderStatus.GOING_TO_PICKUP,
        pickedUpAt: new Date(),
      });
      await expect(service.arriveAtCustomer(PARTNER_USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.orderVendorGroup.update).not.toHaveBeenCalled();
    });
  });

  describe('the new legs do not touch earnings or notification behaviour', () => {
    it('sends no notifications for GOING_TO_PICKUP / ARRIVED_AT_PICKUP / ARRIVED_AT_CUSTOMER', async () => {
      const { service, notificationsService } = createHarness();

      await service.goToPickup(PARTNER_USER_ID, ORDER_ID);
      await service.arriveAtPickup(PARTNER_USER_ID, ORDER_ID);

      expect(notificationsService.sendOrderStatusNotification).not.toHaveBeenCalled();
      expect(notificationsService.sendDeliveryCompletedNotification).not.toHaveBeenCalled();
    });

    it('keeps the existing OUT_FOR_DELIVERY notification on startTransit', async () => {
      const { service, notificationsService } = createHarness({
        groupStatus: OrderStatus.PICKED_UP,
        pickedUpAt: new Date(),
      });
      await service.startTransit(PARTNER_USER_ID, ORDER_ID);
      expect(notificationsService.sendOrderStatusNotification).toHaveBeenCalledWith(
        ORDER_ID,
        'OUT_FOR_DELIVERY',
        'customer-1',
      );
    });
  });
});
