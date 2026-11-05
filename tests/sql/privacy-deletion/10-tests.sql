\set ON_ERROR_STOP 0
-- Dados fictícios: A = dono, B = terceiro.
INSERT INTO extratos_importados VALUES ('e0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001'),('e0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO pluggy_import_entries VALUES ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','gastos',null);
INSERT INTO imported_transactions SELECT gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001' FROM generate_series(1,751);
INSERT INTO imported_transactions SELECT gen_random_uuid(),'bbbbbbbb-0000-0000-0000-000000000002' FROM generate_series(1,5);
INSERT INTO mercado_listas VALUES ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),('c0000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002');
CREATE TABLE snap AS SELECT 'it' t, count(*) n FROM imported_transactions UNION ALL SELECT 'ext', count(*) FROM extratos_importados UNION ALL SELECT 'ml', count(*) FROM mercado_listas UNION ALL SELECT 'audit', count(*) FROM audit_logs;
CREATE FUNCTION same() RETURNS boolean LANGUAGE sql AS $$ SELECT NOT EXISTS (SELECT t,n FROM snap EXCEPT SELECT 'it',count(*) FROM imported_transactions UNION ALL SELECT 'ext',count(*) FROM extratos_importados UNION ALL SELECT 'ml',count(*) FROM mercado_listas UNION ALL SELECT 'audit',count(*) FROM audit_logs) $$;
