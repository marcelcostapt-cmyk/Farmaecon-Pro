-- Migration ADITIVA: identidade fiscal da conta ML (empresa COMPRADORA), para o vínculo de documentos do DRE.
-- Nada é removido ou alterado; todas as colunas novas são NULLABLE. display_name já existe (migration de integrações).
-- Sem unicidade de CNPJ: uma empresa pode ter mais de uma conta (ambiguidade resolvida na parte B).
-- Grants de tabela a farmaecon_runtime já cobrem colunas novas (privilégio ao nível da tabela).

-- AlterTable
ALTER TABLE "marketplace_accounts" ADD COLUMN     "business_name" VARCHAR(255),
ADD COLUMN     "business_name_normalized" VARCHAR(255),
ADD COLUMN     "cnpj" VARCHAR(18);

-- CreateIndex (não-parciais, coerentes com @@index do schema — sem WHERE)
CREATE INDEX "marketplace_accounts_tenant_id_status_cnpj_idx" ON "marketplace_accounts"("tenant_id", "status", "cnpj");

-- CreateIndex
CREATE INDEX "marketplace_accounts_tenant_id_status_business_name_normali_idx" ON "marketplace_accounts"("tenant_id", "status", "business_name_normalized");
