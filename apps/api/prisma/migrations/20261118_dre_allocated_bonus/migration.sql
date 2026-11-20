-- Bonificação alocada por linha (auditoria da publicação de custos). Apenas adiciona coluna.
ALTER TABLE purchase_invoice_items ADD COLUMN allocated_bonus DECIMAL(19,4);
