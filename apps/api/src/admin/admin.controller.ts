import { Controller, Get, Patch, Query, Body, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Executive dashboard — aggregate live metrics for the admin panel.
   * Returns today's pulse, pending actions, order pipeline, weekly revenue
   * chart, recent orders, and total aggregate counts across all entities.
   *
   * All data is computed server-side from a set of parallel Prisma queries,
   * eliminating the client-side aggregation the dashboard was doing before
   * (5 separate API calls with full data transfer).
   */
  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  // ── Platform Settings ──────────────────────────────────────────────

  /**
   * Get current platform settings. Auto-seeds defaults on first access.
   */
  @Get('settings')
  async getSettings() {
    return this.adminService.getSettings();
  }

  /**
   * Update platform settings. Logs the change to the audit trail.
   */
  @Patch('settings')
  async updateSettings(
    @Body() data: Record<string, any>,
    @CurrentUser('id') adminId: string,
  ) {
    const updated = await this.adminService.updateSettings(data);

    // Audit log the settings change
    this.auditService.log({
      adminId,
      action: 'UPDATE_SETTINGS',
      resource: 'Settings',
      resourceId: updated.id,
      details: { updatedFields: Object.keys(data) },
    });

    return updated;
  }

  @Get('analytics')
  async getAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('period') period?: string,
  ) {
    return this.adminService.getAnalytics(startDate, endDate, period);
  }
}
