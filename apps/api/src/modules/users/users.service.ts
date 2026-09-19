import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.service';
import * as bcrypt from 'bcryptjs';

const publicUser = { id: true, name: true, email: true, role: true, createdAt: true } as const;
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  private async authorize(actor: AuthPrincipal) {
    const user = await this.prisma.user.findFirst({ where: { id: actor.sub, tenantId: actor.tenantId }, select: { role: true } });
    if (!user || user.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator required');
  }
  async create(actor: AuthPrincipal, data: { name: string; email: string; password: string; role?: UserRole }) {
    await this.authorize(actor);
    const password = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: { tenantId: actor.tenantId, name: data.name, email: data.email, password, role: data.role ?? UserRole.OPERATOR },
      select: publicUser,
    });
  }
  async updateRole(actor: AuthPrincipal, id: string, role: UserRole) {
    await this.authorize(actor);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id, tenantId: actor.tenantId }, data: { role } });
      if (!changed.count) throw new NotFoundException('User not found');
      await tx.authSession.updateMany({ where: { userId: id, tenantId: actor.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.user.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: publicUser });
    });
  }
  findAll(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, select: publicUser });
  }
}
