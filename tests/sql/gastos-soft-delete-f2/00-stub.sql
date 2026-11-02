-- Stub MÍNIMO e fictício do ambiente (só para PostgreSQL local descartável).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, descricao text, valor numeric NOT NULL, data date NOT NULL,
  origem text, grupo_parcelamento_id uuid, cartao_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, action text, target_user_id uuid,
  entity_type text, entity_id text, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.faturas_cartao (id uuid PRIMARY KEY, user_id uuid, valor_pago numeric);

-- RLS como em produção (dono) + "compartilhado" simplificado: B vê/edita A.
ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.gastos FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY shared ON public.gastos FOR ALL TO authenticated
  USING (user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND auth.uid() = 'cccccccc-0000-0000-0000-000000000003')
  WITH CHECK (user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND auth.uid() = 'cccccccc-0000-0000-0000-000000000003');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gastos TO authenticated;
GRANT ALL ON public.gastos, public.audit_logs, public.faturas_cartao TO service_role;
