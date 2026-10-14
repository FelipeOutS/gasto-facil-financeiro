-- Stub MÍNIMO e fictício (só PostgreSQL local descartável).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.gastos (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, descricao text, valor numeric NOT NULL, data date NOT NULL,
  forma_pagamento text, cartao_id uuid, grupo_parcelamento_id uuid, total_parcelas int DEFAULT 1,
  recorrencia_id uuid, bem_id uuid, import_batch_id uuid,
  deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.receitas (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, descricao text, valor numeric NOT NULL, data date NOT NULL,
  recorrencia_id uuid, import_batch_id uuid, deleted_at timestamptz, deleted_source text, deleted_reason text,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.contas_a_pagar (id uuid PRIMARY KEY, user_id uuid, gasto_id uuid);
GRANT ALL ON public.gastos, public.receitas, public.contas_a_pagar TO service_role;
GRANT SELECT, UPDATE ON public.gastos, public.receitas TO authenticated;
