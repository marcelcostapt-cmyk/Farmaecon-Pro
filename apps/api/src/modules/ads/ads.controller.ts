import { BadRequestException, Controller, ForbiddenException, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { createHash } from 'node:crypto';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import type { AuthPrincipal } from '../auth/auth.service';
import { AdsService } from './ads.service';
import { ADS_MAX_BYTES } from '../costs/ads-csv';
import { toJsonSafe } from '../costs/decimal-json';

const MAX_BYTES = ADS_MAX_BYTES;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadedCsv {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

/** Valida conta, tamanho, extensão e conteúdo mínimo. O conteúdo é lido só aqui; nada sai do servidor. */
function readCsv(accountId: string | undefined, file: UploadedCsv | undefined): { text: string; hash: string } {
  if (!accountId || !UUID.test(accountId)) throw new BadRequestException('account_id inválido.');
  if (!file || file.size === 0) throw new BadRequestException('Envie um ficheiro CSV.');
  if (!/\.csv$/i.test(file.originalname ?? '')) throw new BadRequestException('O ficheiro deve ter extensão .csv.');
  return { text: file.buffer.toString('utf8'), hash: createHash('sha256').update(file.buffer).digest('hex') };
}

/** Custos de ADS: pré-visualização e importação (ADMIN) e indicadores da conta (leitura). */
@UseGuards(AuthGuard('jwt'))
@Controller('ads')
export class AdsController {
  constructor(private readonly service: AdsService) {}

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async previewCsv(
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @UploadedFile() file?: UploadedCsv,
  ) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode importar custos de ADS.');
    const { text, hash } = readCsv(accountId, file);
    return ok(toJsonSafe(await this.service.preview(tenantId, accountId!, text, hash)));
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async importCsv(
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('confirm_overlap') confirmOverlap?: string,
    @UploadedFile() file?: UploadedCsv,
  ) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode importar custos de ADS.');
    const { text, hash } = readCsv(accountId, file);
    // Confirmação explícita de sobreposição: só o valor exato 'true' conta. Validada no serviço.
    return ok(
      await this.service.importCsv(tenantId, accountId!, text, hash, {
        confirmOverlap: confirmOverlap === 'true',
        fileName: file?.originalname ?? null,
        requestedBy: user.sub,
      }),
    );
  }

  /** Indicadores do ADS da conta (período, investimento, SKU e campanha). Leitura para qualquer papel. */
  @Get('overview')
  async overview(@CurrentTenant() tenantId: string, @Query('account_id') accountId?: string) {
    if (!accountId || !UUID.test(accountId)) throw new BadRequestException('account_id inválido.');
    return ok(toJsonSafe(await this.service.profile(tenantId, accountId)));
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
