-- vProd bruto da linha (aditiva, NULL). Base da regra de custo médio quando vItem é zero ou ausente.
ALTER TABLE public.purchase_invoice_items ADD COLUMN "products_value" DECIMAL(19,4);
