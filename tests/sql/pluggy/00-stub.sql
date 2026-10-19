-- Stub mínimo do ambiente Supabase para banco DESCARTÁVEL.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
-- Reproduz os privilégios padrão do Lovable Cloud (pg_default_acl lido do banco real).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- sandbox_exec como no banco real: LOGIN, BYPASSRLS, sem superusuário; padrão ar (tabelas) e rU (sequências).
CREATE ROLE sandbox_exec LOGIN BYPASSRLS;
GRANT sandbox_exec TO CURRENT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO sandbox_exec;
GRANT USAGE ON SCHEMA public TO sandbox_exec;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('owner','admin','user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
GRANT SELECT ON public.user_roles TO authenticated;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ begin new.updated_at = now(); return new; end; $$;
-- Tabela financeira existente (deve permanecer intocada).
CREATE TABLE public.gastos (id uuid PRIMARY KEY, user_id uuid, valor numeric);
INSERT INTO public.gastos VALUES ('00000000-0000-0000-0000-0000000000a1','3324b9f8-ea68-465c-8e1e-ab1cc8caebf1',10);
INSERT INTO public.user_roles(user_id, role) VALUES
 ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','owner'), ('47df50ce-df1e-4c54-8fae-0ffb5105478d','owner'),
 ('99999999-0000-0000-0000-000000000009','user');
