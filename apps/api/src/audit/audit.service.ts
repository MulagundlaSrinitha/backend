import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Log an admin action to the audit trail.
   * Core invariant: every meaningful admin action must call this.
   */
  async log(params: {
    adminId: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, any>;
    ip?: string;
  }) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          adminId: params.adminId,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId || null,
          details: params.details ?? undefined,
          ip: params.ip || null,
        },
      });
    } catch (error: any) {
      // Audit logging must never break the calling operation
      this.logger.error(`Failed to create audit log: ${error.message}`);
      return null;
    }
  }

  /**
   * Find all audit logs with pagination and optional filters.
   */
  async findAll(query: {
    page?: number;
    limit?: number;
    action?: string;
    resource?: string;
    resourceId?: string;
    adminId?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.action) where.action = query.action;
    if (query.resource) where.resource = query.resource;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.adminId) where.adminId = query.adminId;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          admin: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a summary of log counts grouped by action (for dashboard widgets).
   */
  async getSummary(since?: Date) {
    const where: any = {};
    if (since) {
      where.createdAt = { gte: since };
    }

    // Top 10 most frequent actions
    const actionCounts = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    });

    // Per-resource counts
    const resourceCounts = await this.prisma.auditLog.groupBy({
      by: ['resource'],
      where,
      _count: true,
      orderBy: { _count: { resource: 'desc' } },
      take: 10,
    });

    const total = since
      ? await this.prisma.auditLog.count({ where })
      : await this.prisma.auditLog.count();

    return {
      total,
      actionCounts: actionCounts.map((item: any) => ({
        action: item.action,
        count: item._count,
      })),
      resourceCounts: resourceCounts.map((item: any) => ({
        resource: item.resource,
        count: item._count,
      })),
    };
  }
}
