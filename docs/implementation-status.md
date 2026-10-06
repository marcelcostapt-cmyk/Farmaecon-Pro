# Estado de implementação

## Checkpoint 20 — sincronização retomável de pedidos

Data: 2026-10-03 (UTC)

Branch: `feature/ml-resumable-sync`

### Entregue nesta branch

- Paginação de pedidos processada uma página por job, com tamanho padrão de 50.
- `marketplace_sync_states` persistindo `next_offset`, `expected_total`, páginas concluídas, contagem processada e estado por tenant/conta.
- Upsert idempotente por `tenant_id + marketplace_account_id + external_order_id`.
- Transição explícita `PARTIAL → COMPLETE` e `FAILED` para falhas sanitizadas.
- Continuação BullMQ com job determinístico por conta e offset.
- Retomada a partir do cursor persistido após falha.
- Relatório de Observação exibindo estado, cobertura esperada/importada, próximo offset e última sincronização.
- Nenhum endpoint comercial de escrita foi adicionado; o modo permanece `OBSERVATION`.
- O workflow de CI agora exporta as imagens verificadas como artefato versionado e gera `SHA256SUMS` após o smoke test local.

### Evidências locais

- Testes API: 32 testes passaram, incluindo retomada após falha, reexecução idempotente, cursores independentes por conta e transição `PARTIAL → COMPLETE`.
- Typecheck API/Web: passou.
- Build API/Web: passou.
- A validação local não usa contas reais nem tokens reais.

### Ainda não comprovado

- Nenhuma conta real foi sincronizada por esta branch.
- Não há contagem ou amostra manual comparada com a fonte Mercado Livre nesta sessão.
- O workflow de CI desta branch ainda não foi executado em um runner nem o artefato foi promovido para a VPS.
- Checksum de um artefato CI e migração contra uma cópia do banco de produção ainda precisam ser validados antes de qualquer deploy.

### Próximo gate

1. Executar CI completo e gerar artefato rastreável.
2. Validar SHA-256 do artefato contra o valor publicado pelo CI.
3. Aplicar a migration em banco de teste e validar restore.
4. Fazer deploy controlado apenas de API/Web, após autorização explícita.
5. Sincronizar uma única conta real em leitura, comparar uma amostra com o Mercado Livre e registrar o resultado.
