-- Base do custo médio (decisão #2): IPI e ICMS-ST por linha, e o IPI recuperável decidido no documento. Aditiva; NULL = não informado.
ALTER TABLE public.purchase_invoice_items ADD COLUMN "ipi_amount" DECIMAL(19,4);
ALTER TABLE public.purchase_invoice_items ADD COLUMN "icms_st_amount" DECIMAL(19,4);
ALTER TABLE public.purchase_invoices ADD COLUMN "ipi_recoverable" BOOLEAN;
