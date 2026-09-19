import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_MARKETPLACE_SYNC } from '../queue/queue.module';
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, @InjectQueue(QUEUE_MARKETPLACE_SYNC) private readonly queue: Queue) {}
  @Get('health') health() { return { status: 'ok', mode: 'OBSERVATION' }; }
  @Get('ready') async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([this.prisma.$queryRaw`SELECT 1`, this.queue.client.then(c => c.ping())]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), 2000); }),
      ]);
      return { status: 'ready' };
    } catch { throw new ServiceUnavailableException('Dependencies unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
}
