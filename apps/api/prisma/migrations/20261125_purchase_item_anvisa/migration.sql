-- Grupo med da NF-e (aditiva, NULL): registo ANVISA, motivo da isenção e PMC por linha.
ALTER TABLE public.purchase_invoice_items ADD COLUMN "anvisa_register" TEXT;
ALTER TABLE public.purchase_invoice_items ADD COLUMN "anvisa_exemption_reason" TEXT;
ALTER TABLE public.purchase_invoice_items ADD COLUMN "pmc" DECIMAL(15,4);
