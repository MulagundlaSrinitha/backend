import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  // ── Role Methods ─────────────────────────────────────────────────

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('Role with this name already exists');
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description || null,
        permissions: dto.permissions || [],
      },
    });
  }

  async findAllRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOneRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.findOneRole(id);

    if (dto.name) {
      const nameExists = await this.prisma.role.findUnique({
        where: { name: dto.name },
      });
      if (nameExists && nameExists.id !== id) {
        throw new ConflictException('Role with this name already exists');
      }
    }

    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async removeRole(id: string) {
    const role = await this.findOneRole(id);

    if (role.isSystem) {
      throw new ConflictException('Cannot delete system role');
    }

    return this.prisma.role.delete({ where: { id } });
  }

  // ── Permission Methods ───────────────────────────────────────────

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.prisma.permission.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('Permission with this name already exists');
    }

    return this.prisma.permission.create({ data: dto });
  }

  async findAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async removePermission(id: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
    });
    if (!permission) throw new NotFoundException('Permission not found');

    return this.prisma.permission.delete({ where: { id } });
  }
}
