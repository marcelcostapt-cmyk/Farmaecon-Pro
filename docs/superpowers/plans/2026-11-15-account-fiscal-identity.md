# Identidade fiscal das contas ML — Plano de entrega (Parte A)

**Spec:** prompt do utilizador 2026-11-15 "Identificação das contas ML e vínculo fiscal" + decisões confirmadas.
**Base:** `feature/account-fiscal-identity` (← head da PR #6 `security/next-bump-16-4-x`, que já tem `display_name` + UI de contas).
**Decisões confirmadas:** (1) A construída sobre o branch da PR #6; (2) elegibilidade de conta = todas do tenant como candidatas a revisão, auto-confirma só por CNPJ exato único, nome nunca confirma (isto é da Parte B).
**Regras de ouro:** aditivo; nada removido; sem unicidade de CNPJ por tenant; PATCH parcial real (nunca `?? null`); CNPJ inválido → 400 (nunca vira null+sucesso); sem tokens no retorno/logs; migrations só no ensaio; zero produção.

## Parte A — Cadastro, validação e UI

### A1 — Schema + migration aditiva (marketplace_accounts)
Campos: `business_name` VARCHAR(255)?, `business_name_normalized` VARCHAR(255)?, `cnpj` VARCHAR(18)? (todos NULLABLE). Índices compostos **não-parciais** `(tenant_id,status,cnpj)` e `(tenant_id,status,business_name_normalized)` — declarados no schema.prisma para não haver drift com o Prisma (sem `WHERE`, coerente SQL↔schema). SEM unicidade de CNPJ. Migration depois de `20261114_integrations_account_management`.

### A2 — Validação de CNPJ (numérico e alfanumérico) + normalização
`cnpj.ts`: `normalizeCnpj` (remove só máscara `.`/`/`/`-` e espaços, **não** `\D`; maiúsculas; preserva zeros); `validateCnpj` (14 posições; valor de cada char = ASCII−48; DV mod-11 pesos 5..2,9..2 / 6..2,9..2; rejeita DV inválido). `normalizeBusinessName` (sem acentos/pontuação/sufixos societários; preserva texto original à parte).
- Testes: numérico válido (11222333000181) aceita; DV trocado rejeita; exemplo oficial RFB alfanumérico `12ABC34501DE35` aceita, `...34` rejeita; `replace(/\D/g,'')` NÃO usado (letra preservada); formato só por comprimento não basta.

### A3 — Endpoint PATCH parcial + serviço + auditoria
DTO `UpdateAccountIdentityDto { displayName?, businessName?, cnpj? }` (todos `@IsOptional`). Serviço `updateIdentity(tenantId, accountId, actor, patch)`:
- só inclui no `data` as chaves **presentes** (distingue `undefined` de `null`); omitido → preserva.
- `cnpj`: valida; inválido → `BadRequest` sem gravar; `null` explícito limpa; normaliza e grava com máscara canónica.
- `businessName`: grava + recalcula `business_name_normalized` **só** quando enviado; `''`→regra explícita (null).
- `displayName`: mantém semântica atual (`''`/espaços → null).
- escopo tenant + permissão (admin) na leitura e escrita; nunca altera tenant/seller/credenciais/status.
- auditoria (autor, data, campos alterados) sem dados fiscais completos no log de app.
- retorno: só campos de UI (sem tokens).
- Testes: alterar só displayName preserva businessName/cnpj; atualizar businessName não apaga cnpj; limpar opcional; CNPJ inválido rejeita sem modificar; bloqueio cross-tenant/sem permissão.

### A4 — Interface /integrations
Card: título = displayName ?? nickname ?? `ML #<sellerId>`; mostra sellerId+nickname (distinto do id interno), estado+última sync, razão social+CNPJ com selo informado/revisado. Botão "Editar identificação" → form explícito (displayName, businessName, cnpj), validação por campo, Salvar/Cancelar, feedback; **sem** gravar fiscal no blur. Texto explicativo (nome organiza; identidade fiscal vincula notas; nome nunca associa automaticamente). Route handler passa os 3 campos preservando omitidos.

### A5 — Ensaio (Postgres real) + evidências
Verificar isolamento do ensaio (projeto/BD/filas/credenciais locais). Aplicar migration no ensaio. Casos §6: 1 (só displayName preserva fiscal), 2 (businessName sem apagar cnpj; limpar opcional; rejeitar inválido intacto), 3 (numérico+alfanumérico válidos; DV inválido rejeita), 4 (cross-tenant/sem permissão), 8 (form salvar/cancelar/falha sem expor tokens). Secrets scan nos staged.

## Parte B — Integração DRE (DEPENDE de A; branch `feature/dre-increment-1`)
Ligar `resolveDocumentAccount` à ingestão usando `business_name`/`cnpj`. Reconciliar divergências §5 (elegibilidade ampla; nome nunca auto-confirma → PENDING_REVIEW; 2 candidatos CNPJ → PENDING_REVIEW). Persistir doc+vínculo+auditoria transacional com dedup. **Dependência explícita:** precisa dos campos de A no schema de `dre-increment-1`. Não iniciar B sem A disponível nesse branch.

## Fora de escopo: merge, deploy, produção, desenho de agentes, ações comerciais ML.
