import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MarginService } from '../margin/margin.service';
import { toJsonSafe } from '../costs/decimal-json';
import { AGENT_CATALOG, findAgent } from './agent-catalog';
import {
  analyseFinancialMargin,
  blockReasonFor,
  type AnalysisInput,
  type AnalysisResult,
} from './central-farma-analysis';

export interface AgentRunSummary {
  id: string;
  agentKey: string;
  accountId: string;
  status: string;
  blockReason: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

interface AccountRef {
  id: string;
  name: string;
  displayName: string | null;
  status: 'ACTIVE' | 'WARNING' | 'DISCONNECTED';
}

const FAILURE_MESSAGE = 'A análise falhou. Tente novamente; se persistir, consulte os registos do servidor.';
// Uma análise dura segundos. RUNNING mais antigo do que isto foi interrompido (processo reiniciado,
// falha de rede a meio): fica FAILED, sem reexecução automática e sem apagar o histórico.
export const STALE_RUN_MS = 10 * 60 * 1000;
export const STALE_RUN_MESSAGE = 'Execução interrompida: sem conclusão registada dentro do limite de 10 minutos. Execute novamente se necessário.';

/**
 * Orquestra execuções de agentes operacionais. Nesta versão só a Central Farma executa, e só
 * em LEITURA: lê serviços reais (margem, alertas, taxas, contagens) e grava apenas o registo
 * da execução em `agent_runs`. Nunca escreve no Mercado Livre nem altera preços/anúncios/estoque.
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly margin: MarginService,
  ) {}

  /** Catálogo com a última execução de cada agente, opcionalmente da conta escolhida (null = nunca executado). */
  async listCatalog(tenantId: string, accountId?: string) {
    await this.recoverStaleRuns(tenantId);
    return Promise.all(
      AGENT_CATALOG.map(async (agent) => {
        const latest = await this.prisma.agentRun.findFirst({
          where: { tenantId, agentKey: agent.key, ...(accountId ? { marketplaceAccountId: accountId } : {}) },
          orderBy: { startedAt: 'desc' },
        });
        return { ...agent, latestRun: latest ? toSummary(latest) : null };
      }),
    );
  }

  /** Executa um agente para uma conta do tenant. Estados: COMPLETED, BLOCKED (dependência) ou FAILED. */
  async run(tenantId: string, requestedBy: string | null, agentKey: string, accountId: string) {
    const agent = findAgent(agentKey);
    if (!agent) throw new NotFoundException('Agente desconhecido.');
    if (!agent.implemented) throw new BadRequestException('Este agente ainda não está implementado.');

    const account = await this.prisma.marketplaceAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true, name: true, displayName: true, status: true },
    });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    await this.recoverStaleRuns(tenantId, { agentKey: agent.key, marketplaceAccountId: account.id });

    const run = await this.prisma.agentRun.create({
      data: { tenantId, marketplaceAccountId: account.id, agentKey: agent.key, status: 'RUNNING', requestedBy },
    });

    try {
      const analysis = await this.analyse(tenantId, account);
      const updated = await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: analysis.status,
          blockReason: analysis.blockReason,
          result: toJsonObject(analysis),
          finishedAt: new Date(),
        },
      });
      return toRunView(updated);
    } catch (error) {
      // Regista só o tipo do erro: mensagens de base de dados podem conter detalhes internos.
      this.logger.error(`Execução ${run.id} (${agent.key}) falhou: ${error instanceof Error ? error.name : 'erro desconhecido'}`);
      const failed = await this.prisma.agentRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: FAILURE_MESSAGE, finishedAt: new Date() },
      });
      return toRunView(failed);
    }
  }

  /**
   * Fecha como FAILED as execuções RUNNING mais antigas do que STALE_RUN_MS, dentro do tenant
   * (e opcionalmente do agente/conta). Idempotente; só altera estado, nunca apaga nem reexecuta.
   */
  async recoverStaleRuns(
    tenantId: string,
    scope: { agentKey?: string; marketplaceAccountId?: string } = {},
    now: Date = new Date(),
  ): Promise<number> {
    const result = await this.prisma.agentRun.updateMany({
      where: {
        tenantId,
        status: 'RUNNING',
        startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) },
        ...(scope.agentKey ? { agentKey: scope.agentKey } : {}),
        ...(scope.marketplaceAccountId ? { marketplaceAccountId: scope.marketplaceAccountId } : {}),
      },
      data: { status: 'FAILED', errorMessage: STALE_RUN_MESSAGE, finishedAt: now },
    });
    if (result.count > 0) this.logger.warn(`Execuções interrompidas recuperadas: ${result.count}`);
    return result.count;
  }

  async listRuns(tenantId: string, filter: { agentKey?: string; accountId?: string; limit: number }) {
    await this.recoverStaleRuns(tenantId);
    const runs = await this.prisma.agentRun.findMany({
      where: {
        tenantId,
        ...(filter.agentKey ? { agentKey: filter.agentKey } : {}),
        ...(filter.accountId ? { marketplaceAccountId: filter.accountId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: filter.limit,
    });
    return runs.map(toSummary);
  }

  async getRun(tenantId: string, id: string) {
    await this.recoverStaleRuns(tenantId);
    const run = await this.prisma.agentRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Execução não encontrada.');
    return toRunView(run);
  }

  /** Lê os dados reais da conta. Sem dependências, não calcula nada e devolve o bloqueio. */
  private async analyse(tenantId: string, account: AccountRef): Promise<AnalysisResult> {
    const accountName = account.displayName ?? account.name;
    const [orders, approvedCosts, marginRules] = await Promise.all([
      this.prisma.order.count({ where: { tenantId, marketplaceAccountId: account.id } }),
      this.prisma.productCost.count({ where: { tenantId, marketplaceAccountId: account.id, status: 'APPROVED' } }),
      this.prisma.marginRule.count({ where: { tenantId } }),
    ]);
    const counts = { orders, approvedCosts, marginRules };
    const base = { account: { id: account.id, name: accountName, status: account.status }, counts };
    if (blockReasonFor(base)) {
      return analyseFinancialMargin({ ...base, preview: emptyPreview(), alerts: [], feeChanges: [] });
    }
    const filters = { accountId: account.id };
    const [preview, alerts, feeChanges] = await Promise.all([
      this.margin.preview(tenantId, { ...filters, groupBy: 'sku' }),
      this.margin.alerts(tenantId, { ...filters, groupBy: 'sku' }),
      this.margin.feeChanges(tenantId, filters),
    ]);
    const input: AnalysisInput = { ...base, preview, alerts, feeChanges };
    return analyseFinancialMargin(input);
  }
}

function emptyPreview(): AnalysisInput['preview'] {
  return { group_by: 'sku', lines: [], totals: { revenue: new Prisma.Decimal(0), groupsAvailable: 0, groupsUnavailable: 0 } };
}

function toJsonObject(value: AnalysisResult): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

interface RunRow {
  id: string;
  agentKey: string;
  marketplaceAccountId: string;
  status: string;
  blockReason: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  result?: unknown;
}

function toSummary(run: RunRow): AgentRunSummary {
  return {
    id: run.id,
    agentKey: run.agentKey,
    accountId: run.marketplaceAccountId,
    status: run.status,
    blockReason: run.blockReason,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function toRunView(run: RunRow) {
  return { ...toSummary(run), result: toJsonSafe(run.result ?? null) };
}
