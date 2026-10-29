import { OrderStatus } from '@prisma/client';
import {
  VALID_TRANSITIONS,
  STATUS_RANK,
  canTransition,
} from './order-status-transitions';

describe('VALID_TRANSITIONS (order + delivery state machine)', () => {
  it('covers every OrderStatus value — no state is missing from the machine', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('exposes the three new lifecycle states', () => {
    expect(Object.values(OrderStatus)).toEqual(
      expect.arrayContaining([
        'GOING_TO_PICKUP',
        'ARRIVED_AT_PICKUP',
        'ARRIVED_AT_CUSTOMER',
      ]),
    );
  });

  describe('the full ordered delivery lifecycle', () => {
    const flow: Array<[OrderStatus, OrderStatus]> = [
      [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.GOING_TO_PICKUP],
      [OrderStatus.GOING_TO_PICKUP, OrderStatus.ARRIVED_AT_PICKUP],
      [OrderStatus.ARRIVED_AT_PICKUP, OrderStatus.PICKED_UP],
      [OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.ARRIVED_AT_CUSTOMER, OrderStatus.DELIVERED],
    ];

    it.each(flow)('allows %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('preserved pre-existing transitions', () => {
    it('still allows PLACED -> CONFIRMED', () => {
      expect(canTransition(OrderStatus.PLACED, OrderStatus.CONFIRMED)).toBe(true);
    });
    it('still allows PACKED -> READY_FOR_PICKUP', () => {
      expect(canTransition(OrderStatus.PACKED, OrderStatus.READY_FOR_PICKUP)).toBe(true);
    });
    it('still allows READY_FOR_PICKUP -> ASSIGNED_TO_DELIVERY', () => {
      expect(canTransition(OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DELIVERY)).toBe(true);
    });
    it('still allows the OTP-gated ASSIGNED_TO_DELIVERY -> PICKED_UP short-cut', () => {
      expect(canTransition(OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.PICKED_UP)).toBe(true);
    });
    it('still allows OUT_FOR_DELIVERY -> DELIVERED short-cut', () => {
      expect(canTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED)).toBe(true);
    });
    it('still allows ASSIGNED_TO_DELIVERY -> CANCELLED', () => {
      expect(canTransition(OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.CANCELLED)).toBe(true);
    });
  });

  describe('out-of-order / skipping transitions are rejected', () => {
    const rejected: Array<[OrderStatus, OrderStatus]> = [
      // Skipping a leg on the way to the vendor
      [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.ARRIVED_AT_PICKUP],
      [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.DELIVERED],
      [OrderStatus.GOING_TO_PICKUP, OrderStatus.PICKED_UP],
      [OrderStatus.GOING_TO_PICKUP, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.GOING_TO_PICKUP, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.GOING_TO_PICKUP, OrderStatus.DELIVERED],
      [OrderStatus.ARRIVED_AT_PICKUP, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.ARRIVED_AT_PICKUP, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.ARRIVED_AT_PICKUP, OrderStatus.DELIVERED],
      // Skipping a leg on the way to the customer
      [OrderStatus.PICKED_UP, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.PICKED_UP, OrderStatus.DELIVERED],
      [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.ARRIVED_AT_PICKUP],
      [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.GOING_TO_PICKUP],
      // Going backwards
      [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.PICKED_UP],
      [OrderStatus.ARRIVED_AT_CUSTOMER, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.DELIVERED, OrderStatus.PICKED_UP],
      [OrderStatus.DELIVERED, OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.DELIVERED, OrderStatus.ARRIVED_AT_CUSTOMER],
      [OrderStatus.DELIVERED, OrderStatus.ASSIGNED_TO_DELIVERY],
      [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      [OrderStatus.REFUNDED, OrderStatus.PLACED],
    ];

    it.each(rejected)('rejects %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });

  it('treats an unknown source state as having no legal successors', () => {
    expect(canTransition('NOT_A_STATUS', OrderStatus.DELIVERED)).toBe(false);
  });

  it('has no outgoing edges from DELIVERED and REFUNDED', () => {
    expect(VALID_TRANSITIONS[OrderStatus.DELIVERED]).toEqual([]);
    expect(VALID_TRANSITIONS[OrderStatus.REFUNDED]).toEqual([]);
  });
});

describe('STATUS_RANK (parent order roll-up)', () => {
  it('orders the delivery leg in strict progression', () => {
    const progression = [
      OrderStatus.ASSIGNED_TO_DELIVERY,
      OrderStatus.GOING_TO_PICKUP,
      OrderStatus.ARRIVED_AT_PICKUP,
      OrderStatus.PICKED_UP,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.ARRIVED_AT_CUSTOMER,
      OrderStatus.DELIVERED,
    ];

    for (let i = 1; i < progression.length; i++) {
      expect(STATUS_RANK[progression[i]]).toBeGreaterThan(STATUS_RANK[progression[i - 1]]);
    }
  });

  it('ranks terminal states below every active state', () => {
    for (const status of Object.values(OrderStatus)) {
      if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) continue;
      expect(STATUS_RANK[status]).toBeGreaterThan(STATUS_RANK[OrderStatus.CANCELLED]);
    }
    expect(STATUS_RANK[OrderStatus.REFUNDED]).toBeLessThan(STATUS_RANK[OrderStatus.CANCELLED]);
  });
});
