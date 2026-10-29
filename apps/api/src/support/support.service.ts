import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: { subject: string; message: string; category?: string; orderId?: string; priority?: string }) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
        category: dto.category || 'OTHER',
        orderId: dto.orderId || null,
        priority: dto.priority || undefined,
      },
    });
  }

  async findAll(status?: string, page = 1, limit = 20) {
    const where: any = {};
    if (status && status !== 'ALL') where.status = status;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Owner-scoped ticket list — lets any user (customer, vendor, delivery
   *  partner) list their own tickets without seeing anyone else's. */
  async findMine(userId: string, page = 1, limit = 20) {
    const where = { userId };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, userId: string, role: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        replies: {
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (role !== 'ADMIN' && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return ticket;
  }

  async assign(id: string, assignedToId: string) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { assignedToId, status: 'ASSIGNED' },
    });
  }

  async addReply(ticketId: string, userId: string, message: string, role: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (role !== 'ADMIN' && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return this.prisma.ticketReply.create({
      data: { ticketId, userId, message },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { status },
    });
  }
}
