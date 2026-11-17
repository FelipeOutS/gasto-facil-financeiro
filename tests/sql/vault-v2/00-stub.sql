-- Stub descartável: papéis, auth.uid() e cópia das tabelas do cofre antigo (nunca rodar em produção).
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.vault_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, ciphertext text);
CREATE TABLE public.vault_settings(user_id uuid PRIMARY KEY, salt text);
CREATE TABLE public.vault_pin_settings(user_id uuid PRIMARY KEY);
INSERT INTO public.vault_entries(user_id, ciphertext) SELECT 'aaaaaaaa-0000-0000-0000-000000000001', 'old'||g FROM generate_series(1,14) g;
INSERT INTO public.vault_settings VALUES ('aaaaaaaa-0000-0000-0000-000000000001','s');
