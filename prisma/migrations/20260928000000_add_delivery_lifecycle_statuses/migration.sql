-- AlterEnum
-- Delivery lifecycle granularity: the courier now reports the two "in between"
-- legs the partner app needs (en route to the vendor, arrived at the vendor,
-- arrived at the customer). These are appended to the existing OrderStatus
-- enum — no existing value is renamed or removed, so current rows are untouched.
ALTER TYPE "OrderStatus" ADD VALUE 'GOING_TO_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVED_AT_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVED_AT_CUSTOMER';
