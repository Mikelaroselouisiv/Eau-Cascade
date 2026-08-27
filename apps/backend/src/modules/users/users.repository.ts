import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const userPublicSelect = {
  id: true,
  uuid: true,
  email: true,
  role: true,
  fullName: true,
  phone: true,
  isActive: true,
  companyId: true,
  departmentId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  managedDepartments: {
    where: { deletedAt: null },
    select: { departmentId: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findAll(): Promise<SafeUser[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: userPublicSelect,
    });
  }

  findById(id: number): Promise<SafeUser | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userPublicSelect,
    });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
  }

  update(id: number, data: Prisma.UserUpdateInput): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data,
      select: userPublicSelect,
    });
  }

  delete(id: number): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: userPublicSelect,
    });
  }
}
