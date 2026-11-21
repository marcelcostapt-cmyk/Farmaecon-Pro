-- Registro Anvisa do produto (informativo, opcional). Aditiva: só adiciona coluna NULL.
ALTER TABLE public.products ADD COLUMN "anvisa_register" TEXT;
