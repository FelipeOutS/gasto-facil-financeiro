-- Stub fictício extra (após o stub F2 + F2 aplicada no PG local descartável).
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS import_batch_id uuid;
CREATE TABLE public.contas_a_pagar (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL,
  data_pagamento date, gasto_id uuid, updated_at timestamptz DEFAULT now());
CREATE TABLE public.extratos_importados (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL,
  reverted_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.receitas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid);
CREATE TABLE public.transferencias_internas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid);
CREATE TABLE public.dinheiro_guardado (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid);
CREATE TABLE public.movimentacoes_meta (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contas_a_pagar','extratos_importados','receitas','transferencias_internas','dinheiro_guardado','movimentacoes_meta'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY own ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP; END $$;
-- Colunas usadas pela reversão com paridade do fluxo seguro (conforme types.ts do repositório).
ALTER TABLE public.receitas ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.transferencias_internas ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.dinheiro_guardado ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.movimentacoes_meta ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
