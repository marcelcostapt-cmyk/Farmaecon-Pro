import { Body, Controller, Get, Param, Post, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsUUID } from 'class-validator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import type { AuthPrincipal } from '../auth/auth.service';
import { ok } from '../../shared/types/api-response.type';
import { AGENT_CATALOG } from './agent-catalog';
import { AgentsService } from './agents.service';

class RunAgentDto {
  @IsUUID() accountId!: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Escritório de agentes: só leitura sobre dados reais; a única escrita é o registo da execução. */
@UseGuards(AuthGuard('jwt'))
@Controller('agents')
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Get()
  async catalog(@CurrentTenant() tenantId: string) {
    return ok(await this.service.listCatalog(tenantId));
  }

  @Post(':key/runs')
  async run(
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenant() tenantId: string,
    @Param('key') key: string,
    @Body() dto: RunAgentDto,
  ) {
    return ok(await this.service.run(tenantId, user.sub, key, dto.accountId));
  }

  @Get('runs')
  async runs(
    @CurrentTenant() tenantId: string,
    @Query('agent_key') agentKey?: string,
    @Query('account_id') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    if (agentKey && !AGENT_CATALOG.some((a) => a.key === agentKey)) throw new BadRequestException('agent_key desconhecido.');
    if (accountId && !/^[0-9a-f-]{36}$/i.test(accountId)) throw new BadRequestException('account_id inválido.');
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    const take = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
    return ok(await this.service.listRuns(tenantId, { agentKey: agentKey || undefined, accountId: accountId || undefined, limit: take }));
  }

  @Get('runs/:id')
  async getRun(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return ok(await this.service.getRun(tenantId, id));
  }
}
