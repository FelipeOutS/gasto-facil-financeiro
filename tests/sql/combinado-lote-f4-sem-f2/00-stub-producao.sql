-- Stub FICTÍCIO com o formato ATUAL da produção (conferido por metadados em 15/10/2026):
-- gastos/receitas já têm deleted_at; NÃO existem deleted_by/deletion_batch_id/deletion_source
-- nem o gatilho gastos_guard_soft_delete (F2 não aplicada). Só PostgreSQL local descartável.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, descricao text, valor numeric NOT NULL DEFAULT 1,
  data date NOT NULL DEFAULT '2026-09-01', origem text, forma_pagamento text, cartao_id uuid, grupo_parcelamento_id uuid,
  total_parcelas int DEFAULT 1, recorrencia_id uuid, bem_id uuid, import_batch_id uuid, deleted_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.receitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, descricao text, valor numeric NOT NULL DEFAULT 1,
  data date NOT NULL DEFAULT '2026-09-01', recorrencia_id uuid, import_batch_id uuid, deleted_at timestamptz,
  deleted_source text, deleted_reason text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.contas_a_pagar (id uuid PRIMARY KEY, user_id uuid NOT NULL, gasto_id uuid,
  status text NOT NULL DEFAULT 'pendente', data_pagamento date, updated_at timestamptz DEFAULT now());
CREATE TABLE public.extratos_importados (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL,
  reverted_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.transferencias_internas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.dinheiro_guardado (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.movimentacoes_meta (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, import_batch_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['gastos','receitas','contas_a_pagar','extratos_importados','transferencias_internas','dinheiro_guardado','movimentacoes_meta'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY own ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP; END $$;
