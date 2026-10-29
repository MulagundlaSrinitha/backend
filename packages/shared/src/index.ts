// Shared types, constants, and utilities for Next360 platform

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum StoreType {
  ORGANIC = 'ORGANIC',
  NATURAL = 'NATURAL',
  ECO_FRIENDLY = 'ECO_FRIENDLY',
}

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
  DELIVERY_PARTNER = 'DELIVERY_PARTNER',
  ADMIN = 'ADMIN',
}

export enum OrderStatus {
  PLACED = 'PLACED',
  CONFIRMED = 'CONFIRMED',
  PACKED = 'PACKED',
  ASSIGNED_TO_DELIVERY = 'ASSIGNED_TO_DELIVERY',
  PICKED_UP = 'PICKED_UP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum VendorStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export enum DeliveryPartnerStatus {
  OFFLINE = 'OFFLINE',
  AVAILABLE = 'AVAILABLE',
  ON_DELIVERY = 'ON_DELIVERY',
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const API_PORTS = {
  API: 4000,
  VENDOR_DASHBOARD: 3001,
  ADMIN_PANEL: 3002,
  CUSTOMER_APP: 8081,
  DELIVERY_APP: 8082,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const LOW_STOCK_THRESHOLD = 5;

export const COD_MAX_AMOUNT = 2000;

export const DEFAULT_COMMISSION_PCT = 15;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    requestId: string;
  };
}

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  requestId: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta & { timestamp: string; requestId: string };
}
