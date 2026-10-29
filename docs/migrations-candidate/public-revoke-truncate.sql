-- CANDIDATO INDEPENDENTE. Não aplicar ao banco real sem aprovação específica.
-- Executor precisa ser proprietário das tabelas e poder alterar defaults dos dois criadores,
-- ou superusuário autorizado. Não concede novos privilégios e não altera RLS/dados.
-- Defaults globais são aditivos: revogar apenas IN SCHEMA public seria insuficiente.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('postgres','supabase_admin','anon','authenticated')) <> 4 THEN
  RAISE EXCEPTION 'required_roles_missing';
 END IF;
END $$;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;
-- Inherited privilege or table ownership cannot be fixed by a direct REVOKE.
-- Abort transaction instead of reporting a false successful remediation.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(name)
  WHERE n.nspname='public' AND c.relkind IN ('r','p','f')
  AND has_table_privilege(r.name,c.oid,'TRUNCATE')
 ) THEN RAISE EXCEPTION 'truncate_still_effective_check_inheritance_and_ownership'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclrole IN ('postgres'::regrole,'supabase_admin'::regrole)
  AND d.defaclobjtype='r' AND d.defaclnamespace IN (0,'public'::regnamespace)
  AND a.privilege_type='TRUNCATE'
  AND a.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid)
 ) THEN RAISE EXCEPTION 'unsafe_truncate_defaults_remain'; END IF;
END $$;
COMMIT;
-- Reaplicação segura. Não usar GRANT ALL como rollback: isso reabriria o incidente.
-- SELECT/INSERT/UPDATE/DELETE e grants de service_role não são alterados.
-- DDL futuro que use GRANT ALL explicitamente pode reintroduzir TRUNCATE; manter verificação pós-DDL.
