-- Quantidade em estoque por lote (aditiva, opcional). NULL = não informada (não é alocada).
ALTER TABLE public.product_lots ADD COLUMN "quantity" DECIMAL(19,4);
