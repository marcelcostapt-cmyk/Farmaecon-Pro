-- Validade e fabricação do lote (NF-e rastro dVal/dFab). Apenas adiciona colunas NULL; NULL = não informado ou multi-lote.
ALTER TABLE purchase_invoice_items ADD COLUMN fabrication_date DATE;
ALTER TABLE purchase_invoice_items ADD COLUMN expiry_date DATE;
