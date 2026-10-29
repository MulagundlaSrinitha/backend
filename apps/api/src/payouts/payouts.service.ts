import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Scopes a payout query to one side of the split-rail ledger. */
export type PayoutScope = "vendor" | "delivery";

@Injectable()
export class PayoutsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Maps the `type` query param to a payout scope. The admin payout pages send
   * `type=vendor|delivery`; without this it was accepted but silently dropped,
   * so both pages rendered the combined ledger.
   */
  private scopeWhere(type?: string): any {
    if (!type) return {};
    const normalized = type.trim().toLowerCase();
    if (normalized === "vendor") return { vendorId: { not: null } };
    if (normalized === "delivery") return { deliveryPartnerId: { not: null } };
    throw new BadRequestException(
      `Invalid type "${type}". Expected one of: vendor, delivery`,
    );
  }

  async findAll(status?: string, page = 1, limit = 20, type?: string) {
    const where: any = { ...this.scopeWhere(type) };
    if (status) where.status = status;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.payout.findMany({
        where, skip, take: limit,
        include: {
          vendor: { select: { id: true, storeName: true } },
          deliveryPartner: { select: { id: true, vehicleType: true, user: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findVendorPayouts(vendorId?: string, status?: string, page = 1, limit = 20) {
    const where: any = { vendorId: { not: null } };
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.payout.findMany({
        where, skip, take: limit,
        include: { vendor: { select: { id: true, storeName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findDeliveryPayouts(page = 1, limit = 20) {
    const where = { deliveryPartnerId: { not: null } };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.payout.findMany({
        where, skip, take: limit,
        include: { deliveryPartner: { select: { id: true, vehicleType: true, user: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.payout.update({
      where: { id },
      data: { status, paidAt: status === "PAID" ? new Date() : undefined },
    });
  }

  async getSummary() {
    const [vendorPayouts, deliveryPayouts] = await Promise.all([
      this.prisma.payout.aggregate({
        where: { vendorId: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payout.aggregate({
        where: { deliveryPartnerId: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return {
      vendorPayouts: { total: Number(vendorPayouts._sum.amount || 0), count: vendorPayouts._count },
      deliveryPayouts: { total: Number(deliveryPayouts._sum.amount || 0), count: deliveryPayouts._count },
    };
  }

  // ─── CSV Export ────────────────────────────────────────────────────────

  private toCsvEscape(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return "";
    const str = String(value);
    // Neutralize spreadsheet formula injection: a cell starting with =, +, - or @
    // is executed as a formula when the exported file is opened in Excel/Sheets.
    const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    if (guarded.includes(",") || guarded.includes('"') || guarded.includes("\n")) {
      return `"${guarded.replace(/"/g, '""')}"`;
    }
    return guarded;
  }

  private formatPeriod(start: Date | null, end: Date | null): string {
    if (!start && !end) return "";
    const fmt = (d: Date | null) => (d ? d.toISOString().split("T")[0] : "");
    if (start && end) return `${fmt(start)} to ${fmt(end)}`;
    return fmt(start) || fmt(end);
  }

  private toCsvRow(cells: (string | number | null | undefined)[]): string {
    return cells.map((c) => this.toCsvEscape(c)).join(",");
  }

  /**
   * Full CSV export of one payout scope. Unlike the list endpoints this is not
   * paginated — an export that silently contained only the first page of rows
   * would be worse than no export at all.
   */
  private async buildCsv(scope: PayoutScope, status?: string): Promise<{ csv: string; count: number }> {
    const where: any = this.scopeWhere(scope);
    if (status) where.status = status;

    const payouts = await this.prisma.payout.findMany({
      where,
      include: {
        vendor: { select: { storeName: true } },
        deliveryPartner: { select: { vehicleType: true, user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const isVendor = scope === "vendor";
    const headers = isVendor
      ? ["Payout ID", "Vendor", "Amount (INR)", "Period", "Status", "Transfer ID", "Paid At", "Created At"]
      : ["Payout ID", "Partner", "Vehicle", "Amount (INR)", "Period", "Status", "Paid At", "Created At"];

    const rows = payouts.map((p: any) =>
      isVendor
        ? this.toCsvRow([
            p.id,
            p.vendor?.storeName || "",
            Number(p.amount),
            this.formatPeriod(p.periodStart, p.periodEnd),
            p.status,
            p.transferId || "",
            p.paidAt ? new Date(p.paidAt).toISOString() : "",
            new Date(p.createdAt).toISOString(),
          ])
        : this.toCsvRow([
            p.id,
            p.deliveryPartner?.user?.name || "",
            p.deliveryPartner?.vehicleType || "",
            Number(p.amount),
            this.formatPeriod(p.periodStart, p.periodEnd),
            p.status,
            p.paidAt ? new Date(p.paidAt).toISOString() : "",
            new Date(p.createdAt).toISOString(),
          ]),
    );

    // Header row is always emitted, so an empty export is a valid, self-
    // describing CSV rather than a zero-byte download.
    return { csv: [this.toCsvRow(headers), ...rows].join("\n"), count: payouts.length };
  }

  async getVendorPayoutsCsv(status?: string) {
    return this.buildCsv("vendor", status);
  }

  async getDeliveryPayoutsCsv(status?: string) {
    return this.buildCsv("delivery", status);
  }
}
