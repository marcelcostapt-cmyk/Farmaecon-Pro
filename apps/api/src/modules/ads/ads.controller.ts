import { BadRequestException, Controller, ForbiddenException, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { createHash } from 'node:crypto';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import type { AuthPrincipal } from '../auth/auth.service';
import { AdsService } from './ads.service';

const MAX_BYTES = 2 * 1024 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadedCsv {
  buffer: Buffer;
  size: number;
}

/** Custos de ADS: importação (ADMIN) e leitura do resumo por SKU/período. */
@UseGuards(AuthGuard('jwt'))
@Controller('ads')
export class AdsController {
  constructor(private readonly service: AdsService) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async importCsv(
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @UploadedFile() file?: UploadedCsv,
  ) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode importar custos de ADS.');
    if (!accountId || !UUID.test(accountId)) throw new BadRequestException('account_id inválido.');
    if (!file || file.size === 0) throw new BadRequestException('Envie um ficheiro CSV.');
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    return ok(await this.service.importCsv(tenantId, accountId, file.buffer.toString('utf8'), hash));
  }

  @Get('summary')
  async summary(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    if (!accountId || !UUID.test(accountId)) throw new BadRequestException('account_id inválido.');
    if ((startDate && !DAY.test(startDate)) || (endDate && !DAY.test(endDate)))
      throw new BadRequestException('Datas devem ser AAAA-MM-DD.');
    return ok(
      await this.service.summary(
        tenantId,
        accountId,
        startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined,
        endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined,
      ),
    );
  }
}
