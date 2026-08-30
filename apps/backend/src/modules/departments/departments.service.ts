import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepartmentKind } from '@prisma/client';
import { departmentAllowsHomeDelivery } from '../../common/department-kind';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCompanyId(explicit?: number) {
    if (explicit) return explicit;
    const c = await this.prisma.company.findFirst({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
    });
    if (!c) {
      throw new BadRequestException('Aucune entreprise configurée');
    }
    return c.id;
  }

  findAll(companyId?: number) {
    return this.prisma.department.findMany({
      where: {
        deletedAt: null,
        company: { deletedAt: null },
        ...(companyId !== undefined ? { companyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async create(dto: CreateDepartmentDto) {
    const companyId = await this.resolveCompanyId(dto.companyId);
    const kind = dto.kind ?? DepartmentKind.DISTRIBUTION;
    return this.prisma.department.create({
      data: {
        companyId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        kind,
        offersHomeDelivery:
          departmentAllowsHomeDelivery(kind) && dto.offersHomeDelivery === true,
      },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async update(id: number, dto: UpdateDepartmentDto) {
    const existing = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Rayon introuvable');
    }
    const nextKind = dto.kind ?? existing.kind;
    const requestedHome =
      dto.offersHomeDelivery !== undefined
        ? dto.offersHomeDelivery
        : existing.offersHomeDelivery;
    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description?.trim() ?? null,
        }),
        ...(dto.kind !== undefined && { kind: dto.kind }),
        offersHomeDelivery:
          departmentAllowsHomeDelivery(nextKind) && requestedHome === true,
      },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Département introuvable');
    }
    // Soft delete + libère @@unique([companyId, name]) pour recreations
    const tombstoneName = `__DEL_${id}__${existing.name}`.slice(0, 190);
    return this.prisma.department.update({
      where: { id },
      data: { deletedAt: new Date(), name: tombstoneName },
    });
  }
}
