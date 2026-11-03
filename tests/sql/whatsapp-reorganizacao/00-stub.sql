\ir ../gastos-soft-delete-f2/00-stub.sql
ALTER TABLE public.gastos ADD COLUMN forma_pagamento text, ADD COLUMN total_parcelas int DEFAULT 1, ADD COLUMN recorrencia_id uuid, ADD COLUMN bem_id uuid, ADD COLUMN import_batch_id uuid;
CREATE TABLE public.receitas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,descricao text NOT NULL,valor numeric NOT NULL,data date NOT NULL,tipo text NOT NULL DEFAULT 'outros',mes int NOT NULL DEFAULT 1,ano int NOT NULL DEFAULT 2026,origem text,recorrencia_id uuid,import_batch_id uuid,deleted_at timestamptz,deleted_source text,deleted_reason text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.contas_a_pagar(id uuid PRIMARY KEY,gasto_id uuid,user_id uuid);
CREATE TABLE public.pluggy_import_entries(id uuid PRIMARY KEY,entry_id uuid);
CREATE TABLE public.whatsapp_links(user_id uuid,telefone text,ativo boolean,opt_in_em timestamptz,revogado_em timestamptz);
CREATE FUNCTION public.has_feature_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='aaaaaaaa-0000-0000-0000-000000000001'::uuid $$;
GRANT ALL ON public.receitas,public.contas_a_pagar,public.pluggy_import_entries,public.whatsapp_links TO service_role;
ALTER TABLE public.gastos ADD COLUMN offline_client_id text;
ALTER TABLE public.receitas ADD COLUMN offline_client_id text;
