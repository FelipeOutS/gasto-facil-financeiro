-- Testes da candidata whatsapp-lote-mes (banco descartável).
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS TRUE THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;

-- Usuário A: 3 simples em 09/2026, 1 parcelado, 1 cartão, 1 pagamento de conta, 1 já excluído antes, 1 de outubro.
-- Usuário B: 1 simples em 09/2026.
INSERT INTO public.gastos (id, user_id, descricao, valor, data, forma_pagamento, cartao_id, grupo_parcelamento_id, total_parcelas, deleted_at) VALUES
 ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Mercado',10,'2026-09-01','pix',NULL,NULL,1,NULL),
 ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Mercado',20,'2026-09-15','pix',NULL,NULL,1,NULL),
 ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Uber',30,'2026-09-30','debito',NULL,NULL,1,NULL),
 ('a0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','TV',100,'2026-09-10','credito',NULL,'f0000000-0000-0000-0000-000000000001',10,NULL),
 ('a0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Loja',50,'2026-09-11','credito','c0000000-0000-0000-0000-000000000001',NULL,1,NULL),
 ('a0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','Luz',80,'2026-09-12','pix',NULL,NULL,1,NULL),
 ('a0000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','Antigo',5,'2026-09-13','pix',NULL,NULL,1,'2026-09-20T00:00:00Z'),
 ('a0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000001','Outubro',7,'2026-10-01','pix',NULL,NULL,1,NULL),
 ('b0000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Mercado',99,'2026-09-01','pix',NULL,NULL,1,NULL);
INSERT INTO public.contas_a_pagar VALUES ('cc000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006');
INSERT INTO public.receitas (id, user_id, descricao, valor, data) VALUES
 ('d0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Salário',3000,'2026-08-05'),
 ('d0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Freela',500,'2026-08-20');

-- Permissão: authenticated não executa.
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'gastos', 2026, 9, ARRAY[gen_random_uuid()], ARRAY[now()]);
  RAISE EXCEPTION 'FALHOU: authenticated executou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated sem EXECUTE';
END $$;
RESET ROLE;
SET ROLE service_role;

CREATE TEMP TABLE snap AS
  SELECT array_agg(id ORDER BY id) ids, array_agg(updated_at ORDER BY id) ver FROM public.gastos
   WHERE id IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003');

-- Conjunto diferente (falta um elegível) → changed, nada gravado.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','gastos',2026,9,
  (SELECT ids[1:2] FROM snap),(SELECT ver[1:2] FROM snap))->>'status') = 'changed', 'conjunto incompleto → changed');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE deleted_at IS NULL AND user_id='aaaaaaaa-0000-0000-0000-000000000001') = 7, 'changed não grava nada');

-- Edição concorrente depois da prévia (updated_at mudou) → changed.
UPDATE public.gastos SET updated_at = now() + interval '1 second' WHERE id='a0000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','gastos',2026,9,
  (SELECT ids FROM snap),(SELECT ver FROM snap))->>'status') = 'changed', 'updated_at diferente → changed');
DROP TABLE snap;
CREATE TEMP TABLE snap AS
  SELECT array_agg(id ORDER BY id) ids, array_agg(updated_at ORDER BY id) ver FROM public.gastos
   WHERE id IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003');

-- Tentativa de incluir bloqueado (cartão) → changed.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003','gastos',2026,9,
  (SELECT ids || 'a0000000-0000-0000-0000-000000000005'::uuid FROM snap),(SELECT ver || now() FROM snap))->>'status') = 'changed', 'bloqueado no conjunto → changed');

-- Sucesso: só os 3 simples.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','gastos',2026,9,
  (SELECT ids FROM snap),(SELECT ver FROM snap))->>'count') = '3', 'exclusão do lote: 3');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE deleted_at IS NULL AND user_id='aaaaaaaa-0000-0000-0000-000000000001') = 4, 'bloqueados e outubro preservados');
SELECT pg_temp.ok((SELECT coalesce(sum(valor),0) FROM public.gastos WHERE deleted_at IS NULL AND user_id='aaaaaaaa-0000-0000-0000-000000000001' AND data BETWEEN '2026-09-01' AND '2026-09-30') = 230, 'total ativo de 09 depois: 230');
SELECT pg_temp.ok((SELECT deleted_at FROM public.gastos WHERE id='b0000000-0000-0000-0000-000000000001') IS NULL, 'outro usuário intacto');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos) = 9, 'nenhum DELETE físico');

-- Replay (mesmo batch) → replay, sem novo efeito.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','gastos',2026,9,
  (SELECT ids FROM snap),(SELECT ver FROM snap))->>'status') = 'replay', 'replay idempotente');
-- Batch de outro usuário → 42501.
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000001','gastos',2026,9,ARRAY[gen_random_uuid()],ARRAY[now()]);
  RAISE EXCEPTION 'FALHOU: lote alheio';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: lote de outro usuário recusado';
END $$;
DO $$ BEGIN
  PERFORM public.wa_lote_mes_restaurar('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000001',3);
  RAISE EXCEPTION 'FALHOU: restaurar lote alheio';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: restaurar lote de outro usuário recusado';
END $$;

-- Restauração: um item restaurado individualmente e excluído de novo (outra operação) não volta.
UPDATE public.gastos SET deleted_at = NULL WHERE id='a0000000-0000-0000-0000-000000000003';
UPDATE public.gastos SET deleted_at = now() + interval '5 seconds' WHERE id='a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.ok((public.wa_lote_mes_restaurar('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001',3)->>'status') = 'changed', 'restaurar com contagem antiga → changed');
SELECT pg_temp.ok((public.wa_lote_mes_restaurar('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001',2)->>'count') = '2', 'restaura só os 2 ainda marcados pelo lote');
SELECT pg_temp.ok((SELECT deleted_at FROM public.gastos WHERE id='a0000000-0000-0000-0000-000000000003') IS NOT NULL, 'excluído por outra operação continua excluído');
SELECT pg_temp.ok((SELECT deleted_at FROM public.gastos WHERE id='a0000000-0000-0000-0000-000000000007') IS NOT NULL, 'excluído antes do lote não é restaurado');
SELECT pg_temp.ok((public.wa_lote_mes_restaurar('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001',2)->>'status') = 'replay', 'restauração repetida idempotente');
-- Revisão final: repetir exclusão de lote já restaurado → already_restored, nada excluído.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','gastos',2026,9,
  (SELECT ids FROM snap),(SELECT ver FROM snap))->>'status') = 'already_restored', 'exclusão repetida após restauração → already_restored');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE id = ANY (ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002']::uuid[]) AND deleted_at IS NULL) = 2, 'nada re-excluído após restauração');
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','gastos',2026,8,
    (SELECT ids FROM snap),(SELECT ver FROM snap));
  RAISE EXCEPTION 'FALHOU: lote reutilizado com mês diferente';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: lote reutilizado com mês diferente recusado';
END $$;
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','receitas',2026,9,
    (SELECT ids FROM snap),(SELECT ver FROM snap));
  RAISE EXCEPTION 'FALHOU: lote reutilizado com tipo diferente';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: lote reutilizado com tipo diferente recusado';
END $$;
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','gastos',2026,9,
    ARRAY['a0000000-0000-0000-0000-000000000001'::uuid],ARRAY[now()]);
  RAISE EXCEPTION 'FALHOU: lote reutilizado com IDs diferentes';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: lote reutilizado com IDs diferentes recusado';
END $$;

-- Receitas (agosto) com deleted_source.
SELECT pg_temp.ok((public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','receitas',2026,8,
  (SELECT array_agg(id ORDER BY id) FROM public.receitas),(SELECT array_agg(updated_at ORDER BY id) FROM public.receitas))->>'count') = '2', 'receitas: 2 excluídas');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE deleted_source='whatsapp_lote_mes') = 2, 'receitas marcadas com origem do lote');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE deleted_at IS NULL AND user_id='aaaaaaaa-0000-0000-0000-000000000001') = 6, 'gastos não afetados pelo lote de receitas');
SELECT pg_temp.ok((public.wa_lote_mes_restaurar('aaaaaaaa-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001',2)->>'count') = '2', 'receitas restauradas');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE deleted_at IS NULL AND deleted_source IS NULL) = 2, 'receitas ativas e limpas');

-- Validações.
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001',gen_random_uuid(),'gastos',2026,13,ARRAY[gen_random_uuid()],ARRAY[now()]);
  RAISE EXCEPTION 'FALHOU: mês 13';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: mês inválido recusado';
END $$;
DO $$ BEGIN
  PERFORM public.wa_lote_mes_excluir('aaaaaaaa-0000-0000-0000-000000000001',gen_random_uuid(),'tudo',2026,9,ARRAY[gen_random_uuid()],ARRAY[now()]);
  RAISE EXCEPTION 'FALHOU: tipo';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: tipo misto recusado';
END $$;
RESET ROLE;
