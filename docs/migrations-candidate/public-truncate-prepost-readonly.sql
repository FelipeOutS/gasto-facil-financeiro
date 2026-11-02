-- Consultas SOMENTE LEITURA para o operador autorizado executar antes e depois.
SELECT r.name AS role_name,count(*) AS tables_with_truncate
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(name)
WHERE n.nspname='public' AND c.relkind IN ('r','p','f')
AND has_table_privilege(r.name,c.oid,'TRUNCATE') GROUP BY r.name;
SELECT pg_get_userbyid(d.defaclrole) AS creator,
 CASE WHEN d.defaclnamespace=0 THEN '<global>' ELSE d.defaclnamespace::regnamespace::text END AS scope,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclrole IN ('postgres'::regrole,'supabase_admin'::regrole)
AND d.defaclobjtype='r' AND d.defaclnamespace IN (0,'public'::regnamespace)
AND a.privilege_type='TRUNCATE' AND a.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid);
-- Snapshot de ACLs para registro de mudança; não exporta linhas das tabelas.
SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','f') ORDER BY c.relname;
