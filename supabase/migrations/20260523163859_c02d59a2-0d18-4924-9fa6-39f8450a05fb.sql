-- =====================================================
-- Sprint 1, Etapa 4 — Hardening de segurança
-- =====================================================

-- 1) search_path fixo para as 4 funções de fila de email
ALTER FUNCTION public.enqueue_email(text, jsonb)              SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint)              SET search_path = public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb)  SET search_path = public, pg_temp;

-- 2) Revogar EXECUTE de anon em TODAS as funções SECURITY DEFINER do schema public
-- (não há fluxo legítimo onde anon precise chamar essas funções)
REVOKE EXECUTE ON FUNCTION public.account_access_level(uuid)                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_admin_account(uuid)                     FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_create_in_account(uuid)                 FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_account(uuid)                      FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_owner_if_first()                      FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_plan(uuid)                          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_email()                        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_full_access(uuid)                        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid)                              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_pin_delete()                          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_pin_record_attempt(boolean)           FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_pin_set(text, integer, text, text)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)      FROM anon, PUBLIC;

-- 3) Revogar EXECUTE também de authenticated para funções trigger-only / server-only.
-- Triggers continuam funcionando: eles não dependem de privilégio EXECUTE explícito.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                           FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_plan()                      FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role()                      FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_plan_from_payment()               FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_cliente_owner()                    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.connected_accounts_prevent_invitee_escalation() FROM authenticated;

-- Filas de email: chamadas via createClient(service_role) nos handlers /lovable/email/*
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer)    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)      FROM authenticated;

-- Garantir service_role para as funções server-only de email
GRANT  EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.delete_email(text, bigint)                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)      TO service_role;

-- 4) Bucket avatars: remover policy ampla de SELECT.
-- O bucket continua público (`buckets.public = true`), então as URLs de avatar
-- continuam servidas pelo CDN público. A remoção apenas impede listar/varrer
-- todos os arquivos via API REST.
DROP POLICY IF EXISTS avatars_select_public ON storage.objects;
