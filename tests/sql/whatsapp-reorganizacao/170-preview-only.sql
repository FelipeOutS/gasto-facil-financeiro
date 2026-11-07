-- Trava "somente prévia": prévia funciona; código correto e chamada direta não gravam nada.
\set U '''aaaaaaaa-0000-0000-0000-000000000001'''
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;
INSERT INTO public.whatsapp_reorganization_allowlist(user_id) VALUES (:U) ON CONFLICT DO NOTHING;
SELECT public.assert_true(public.wa_reorganization_preview_only(),'preview-only: on by default');
CREATE TEMP TABLE po_before AS SELECT
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id=:U) g,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE user_id=:U) r,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t WHERE user_id=:U) f,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t WHERE user_id=:U) cp,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t WHERE user_id=:U) rc;
SELECT public.wa_full_reset_prepare(:U,'5511999999999','po-1','313131') AS pv \gset
SELECT public.assert_true((:'pv'::jsonb)->>'status'='preview' AND ((:'pv'::jsonb)->>'expenses')::int>0,'preview-only: "exclua tudo" preview lists entries');
SET ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','313131',NULL); RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reorganization_preview_only' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: preview-only: direct RPC call with correct code refused';
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN UPDATE whatsapp_reorganization_full_operations SET status='applied' WHERE request_id='po-1'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reorganization_preview_only' THEN RAISE; END IF; END;
 BEGIN PERFORM set_config('gi.reorganization_mutation','on',true);
  UPDATE gastos SET descricao=descricao||'' WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reorganization_preview_only' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: preview-only: forced status change and privileged row writes refused';
END $$;
SELECT public.assert_true((SELECT status='preview' FROM whatsapp_reorganization_full_operations WHERE request_id='po-1'),'preview-only: operation stays preview');
SELECT public.assert_true((SELECT g FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id=:U)
 AND (SELECT r FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE user_id=:U)
 AND (SELECT f FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t WHERE user_id=:U)
 AND (SELECT cp FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t WHERE user_id=:U)
 AND (SELECT rc FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t WHERE user_id=:U),'preview-only: no financial row changed');
-- Período ("meses anteriores") também bloqueado.
SELECT public.wa_reorganization_prepare(:U,'5511999999999','po-2','{"tables":["gastos","receitas"],"start":null,"end":"2030-02-01"}',NULL,'323232') AS pv2 \gset
DO $$ BEGIN
 BEGIN PERFORM public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','323232',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='po-2')); RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reorganization_preview_only' AND SQLERRM<>'should fail' THEN RAISE; END IF;
  IF SQLERRM='should fail' THEN RAISE EXCEPTION 'period confirm was not refused'; END IF; END;
 RAISE NOTICE 'PASS: preview-only: period cleanup confirm refused';
END $$;
SELECT public.assert_true((SELECT g FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id=:U),'preview-only: period attempt changed nothing');
-- Normal site/WhatsApp entries keep working while the lock is on.
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES ('e0000000-0000-0000-0000-0000000000a9',:U,'Normal',3,'2030-02-10','pix');
DELETE FROM gastos WHERE id='e0000000-0000-0000-0000-0000000000a9';
DO $$ BEGIN RAISE NOTICE 'PASS: preview-only: ordinary entries unaffected'; END $$;
-- Only explicit policy change unlocks (proves the lock is the cause).
UPDATE public.whatsapp_reorganization_policy SET preview_only=false;
SELECT public.wa_full_reset_prepare(:U,'5511999999999','po-3','343434');
SELECT public.assert_true(public.wa_full_reset_confirm(:U,'5511999999999','343434',NULL)->>'status'='applied','preview-only: off → confirm works');
SELECT public.wa_full_reset_restore_prepare(:U,'5511999999999',(SELECT id FROM whatsapp_reorganization_full_operations WHERE request_id='po-3'),'353535');
UPDATE public.whatsapp_reorganization_policy SET preview_only=true;
SELECT public.assert_true((SELECT status FROM whatsapp_reorganization_full_operations WHERE request_id='po-3')='applied','preview-only: back on');
DO $$ BEGIN
 BEGIN PERFORM public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_full_operations WHERE request_id='po-3'),'353535'); RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reorganization_preview_only' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: preview-only: restore also refused while locked';
END $$;
UPDATE public.whatsapp_reorganization_policy SET preview_only=false;
SELECT public.assert_true(public.wa_full_reset_restore_confirm(:U,'5511999999999',(SELECT id FROM whatsapp_reorganization_full_operations WHERE request_id='po-3'),'353535')->>'status'='restored','preview-only: cleanup restored after unlock');
SELECT public.assert_true((SELECT g FROM po_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id=:U),'preview-only: data identical at end');
UPDATE public.whatsapp_reorganization_policy SET preview_only=true, release_enabled=false;
DELETE FROM public.whatsapp_reorganization_allowlist;
