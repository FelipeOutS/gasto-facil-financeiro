-- Complementar (14/10/2026): lançamentos manuais, cartão/parcelas, leitor sem
-- permissão de edição e compatibilidade da versão publicada (d1cda91b9). Dados fictícios.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set V '''eeeeeeee-0000-0000-0000-000000000005'''
\set X '''b7000000-0000-0000-0000-000000000001'''
\set Y '''b7000000-0000-0000-0000-000000000002'''
-- Leitor (só SELECT) do lote X de A.
CREATE POLICY viewer_sel ON public.extratos_importados FOR SELECT TO authenticated USING (auth.uid() = 'eeeeeeee-0000-0000-0000-000000000005');
CREATE POLICY viewer_sel ON public.gastos FOR SELECT TO authenticated USING (auth.uid() = 'eeeeeeee-0000-0000-0000-000000000005');
INSERT INTO public.extratos_importados VALUES (:X, :A, 'importado'), (:Y, :A, 'importado');
INSERT INTO public.gastos (id, user_id, valor, data, import_batch_id, cartao_id, grupo_parcelamento_id, origem) VALUES
 ('b7100000-0000-0000-0000-000000000001', :A, 10, '2026-09-01', :X, NULL, NULL, 'extrato'),
 ('b7100000-0000-0000-0000-000000000002', :A, 99, '2026-09-01', NULL, NULL, NULL, 'manual'),
 ('b7100000-0000-0000-0000-000000000003', :A, 50, '2026-09-01', NULL, 'b7900000-0000-0000-0000-000000000001', 'b7800000-0000-0000-0000-000000000001', 'cartao'),
 ('b7100000-0000-0000-0000-000000000004', :A, 50, '2026-10-01', NULL, 'b7900000-0000-0000-0000-000000000001', 'b7800000-0000-0000-0000-000000000001', 'cartao'),
 ('b7100000-0000-0000-0000-000000000005', :A, 7, '2026-09-01', :Y, NULL, NULL, 'extrato');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('b7000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: leitor reverteu'; EXCEPTION WHEN sqlstate 'P0002' OR insufficient_privilege THEN RAISE NOTICE 'PASSOU: leitor sem edição não reverte'; END $$;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE import_batch_id = 'b7000000-0000-0000-0000-000000000001') = 1, 'leitor: nada apagado');
SELECT pg_temp.ok((public.reverter_extrato_atomic('b7000000-0000-0000-0000-000000000001')->>'status') = 'revertido', 'lote X revertido');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.gastos WHERE id = 'b7100000-0000-0000-0000-000000000002'), 'lançamento manual intacto');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE grupo_parcelamento_id = 'b7800000-0000-0000-0000-000000000001') = 2, 'parcelas de cartão intactas');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.gastos WHERE id = 'b7100000-0000-0000-0000-000000000005'), 'outro lote intacto');
-- Compatibilidade d1cda91b9: o app antigo não chama a RPC; seu DELETE sequencial segue funcionando.
DELETE FROM public.gastos WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND import_batch_id = 'b7000000-0000-0000-0000-000000000002' AND id IN ('b7100000-0000-0000-0000-000000000005');
UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now() WHERE id = 'b7000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT status FROM public.extratos_importados WHERE id = 'b7000000-0000-0000-0000-000000000002') = 'revertido', 'fluxo da versão publicada continua compatível');
RESET ROLE;
