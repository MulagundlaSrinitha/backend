import { Controller, Get, Patch, Param, Query, Body, UseGuards, Res } from "@nestjs/common";
import { Response } from "express";
import { PayoutsService } from "./payouts.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "@prisma/client";

@Controller("payouts")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  /**
   * Streams a CSV as a file attachment. The filename is set server-side so the
   * browser download is named correctly even before the response body is read.
   */
  private sendCsv(res: Response, csv: string, filename: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get()
  async findAll(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("type") type?: string,
  ) {
    return this.payoutsService.findAll(
      status,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      type,
    );
  }

  @Get("vendors/export")
  async exportVendorPayouts(@Query("status") status?: string, @Res() res?: Response) {
    const { csv, count } = await this.payoutsService.getVendorPayoutsCsv(status);
    if (res) {
      this.sendCsv(res, csv, `vendor-payouts-${new Date().toISOString().split("T")[0]}.csv`);
    }
    return { count, csv };
  }

  @Get("delivery/export")
  async exportDeliveryPayouts(@Query("status") status?: string, @Res() res?: Response) {
    const { csv, count } = await this.payoutsService.getDeliveryPayoutsCsv(status);
    if (res) {
      this.sendCsv(res, csv, `delivery-payouts-${new Date().toISOString().split("T")[0]}.csv`);
    }
    return { count, csv };
  }

  @Get("vendors")
  async findVendorPayouts(@Query("vendorId") vendorId?: string, @Query("status") status?: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.payoutsService.findVendorPayouts(vendorId, status, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  }

  @Get("delivery")
  async findDeliveryPayouts(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.payoutsService.findDeliveryPayouts(page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  }

  @Get("summary")
  async getSummary() {
    return this.payoutsService.getSummary();
  }

  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body("status") status: string) {
    return this.payoutsService.updateStatus(id, status);
  }
}
