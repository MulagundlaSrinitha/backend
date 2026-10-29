import { OrderStatus } from '@prisma/client';

/**
 * The single source of truth for order/delivery status transitions.
 *
 * `OrderStatus` is intentionally the only status system in this codebase — the
 * delivery leg (ASSIGNED_TO_DELIVERY onwards) is tracked per
 * `OrderVendorGroup.status` using these same values. There is no second,
 * competing delivery-status enum.
 *
 * Lifecycle (13 states):
 *
 *   PLACED → CONFIRMED → PACKED → READY_FOR_PICKUP → ASSIGNED_TO_DELIVERY
 *     → GOING_TO_PICKUP → ARRIVED_AT_PICKUP → PICKED_UP
 *     → OUT_FOR_DELIVERY → ARRIVED_AT_CUSTOMER → DELIVERED
 *
 * GOING_TO_PICKUP / ARRIVED_AT_PICKUP / ARRIVED_AT_CUSTOMER are the three
 * courier-reported legs the delivery-partner app needs. They are optional in
 * the sense that the two pre-existing short-cuts below remain legal, so an
 * in-flight order created before this change (and any client that has not yet
 * been updated) keeps working:
 *
 *   - ASSIGNED_TO_DELIVERY → PICKED_UP   (pickup is OTP-gated in delivery.service)
 *   - OUT_FOR_DELIVERY    → DELIVERED    (the original complete-delivery path)
 *
 * Everything else is strictly ordered: skipping a leg is rejected.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PLACED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  [OrderStatus.PACKED]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.ASSIGNED_TO_DELIVERY, OrderStatus.CANCELLED],
  [OrderStatus.ASSIGNED_TO_DELIVERY]: [
    OrderStatus.GOING_TO_PICKUP,
    // Pre-existing short-cut, still OTP-gated by DeliveryService.verifyPickup.
    OrderStatus.PICKED_UP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.GOING_TO_PICKUP]: [OrderStatus.ARRIVED_AT_PICKUP],
  [OrderStatus.ARRIVED_AT_PICKUP]: [OrderStatus.PICKED_UP],
  [OrderStatus.PICKED_UP]: [OrderStatus.OUT_FOR_DELIVERY],
  [OrderStatus.OUT_FOR_DELIVERY]: [
    OrderStatus.ARRIVED_AT_CUSTOMER,
    // Pre-existing short-cut: "Mark Delivered" straight from the road.
    OrderStatus.DELIVERED,
  ],
  [OrderStatus.ARRIVED_AT_CUSTOMER]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
};

/**
 * True when `to` is a legal next state for `from`.
 * An unknown source state has no legal successors.
 */
export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * How far along the lifecycle a state is, used to roll a multi-vendor parent
 * Order up to its most-advanced active vendor group. Terminal/negative states
 * sort below every active state.
 */
export const STATUS_RANK: Record<string, number> = {
  [OrderStatus.PLACED]: 0,
  [OrderStatus.CONFIRMED]: 1,
  [OrderStatus.PACKED]: 2,
  [OrderStatus.READY_FOR_PICKUP]: 3,
  [OrderStatus.ASSIGNED_TO_DELIVERY]: 4,
  [OrderStatus.GOING_TO_PICKUP]: 5,
  [OrderStatus.ARRIVED_AT_PICKUP]: 6,
  [OrderStatus.PICKED_UP]: 7,
  [OrderStatus.OUT_FOR_DELIVERY]: 8,
  [OrderStatus.ARRIVED_AT_CUSTOMER]: 9,
  [OrderStatus.DELIVERED]: 10,
  [OrderStatus.CANCELLED]: -1,
  [OrderStatus.REFUNDED]: -2,
};
