CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid, action text,target_user_id uuid,entity_type text,entity_id text,metadata jsonb);
ALTER TABLE gastos ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN import_batch_id uuid, ADD COLUMN bem_id uuid;
ALTER TABLE receitas ADD COLUMN deleted_source text, ADD COLUMN deleted_reason text, ADD COLUMN import_batch_id uuid;
GRANT USAGE ON SCHEMA auth TO service_role,authenticated,anon;
GRANT SELECT,UPDATE ON gastos,receitas,contas_a_pagar,recorrencias TO service_role;
