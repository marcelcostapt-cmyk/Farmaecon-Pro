import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string; document?: string }) {
    return this.prisma.tenant.create({ data });
  }

  async findById(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id } });
  }
}
