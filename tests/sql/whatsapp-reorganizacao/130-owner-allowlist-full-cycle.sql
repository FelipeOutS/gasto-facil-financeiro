-- Restrição a uma conta + ciclo completo zerar → restaurar com invariantes.
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;

-- Lista vazia: titular válido continua bloqueado.
SELECT public.assert_true(NOT public.wa_reorganization_authorized('aaaaaaaa-0000-0000-0000-000000000001','5511999999999'),'empty allowlist blocks valid owner');
SELECT public.assert_true(public.wa_reorganization_prepare_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','al-0','{"tables":["gastos","receitas"],"start":null,"end":null}',null,'111111')->>'status'<>'preview','empty allowlist: no preview');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.whatsapp_reorganization_operations(user_id) VALUES ('cccccccc-0000-0000-0000-000000000003');
  RAISE EXCEPTION 'guard missing';
 EXCEPTION WHEN others THEN
  IF SQLERRM NOT LIKE '%reorganization_not_allowlisted%' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: direct insert for non-listed user rejected';
END $$;
SELECT public.assert_true(NOT has_table_privilege('authenticated','public.whatsapp_reorganization_allowlist','SELECT') AND NOT has_table_privilege('authenticated','public.whatsapp_reorganization_allowlist','INSERT'),'allowlist not readable/writable by authenticated');
SELECT public.assert_true(NOT has_function_privilege('authenticated','public.wa_reorganization_authorized(uuid,text)','EXECUTE'),'authorized not callable by authenticated');

INSERT INTO public.whatsapp_reorganization_allowlist(user_id,note) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','fixture owner');
SELECT public.assert_true(public.wa_reorganization_authorized('aaaaaaaa-0000-0000-0000-000000000001','5511999999999'),'listed owner authorized');
SELECT public.assert_true(NOT public.wa_reorganization_authorized('cccccccc-0000-0000-0000-000000000003','5511999999999'),'other user still blocked');

-- Fotografia antes: totais ativos e tabelas que a limpeza não pode tocar.
CREATE TEMP TABLE before_state AS SELECT
 (SELECT coalesce(sum(valor),0) FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL) g,
 (SELECT coalesce(sum(valor),0) FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL) r,
 (SELECT count(*) FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL) ng,
 (SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM faturas_cartao t) faturas,
 (SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM cartoes t) cartoes,
 (SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM bancos t) bancos,
 (SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM gastos t WHERE user_id<>'aaaaaaaa-0000-0000-0000-000000000001') outros;

SELECT public.assert_true(public.wa_reorganization_prepare_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','cycle-1','{"tables":["gastos","receitas"],"start":null,"end":null}',null,'424242')->>'status'='preview','cycle preview');
SELECT public.assert_true((SELECT jsonb_array_length(left_out)>0 FROM whatsapp_reorganization_operations WHERE request_id='cycle-1'),'linked rows reported: cleanup is partial, not total');
SELECT public.assert_true(public.wa_reorganization_confirm_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','000000',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1'))->>'status'<>'applied','wrong code does not apply');
SELECT public.assert_true(public.wa_reorganization_confirm_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','424242',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1'))->>'status'='applied','cycle applied');
SELECT public.assert_true((SELECT count(*)=0 FROM gastos g WHERE g.user_id='aaaaaaaa-0000-0000-0000-000000000001' AND g.deleted_at IS NULL
  AND public.wa_reorganization_left_out_reason('aaaaaaaa-0000-0000-0000-000000000001',jsonb_build_object('table','gastos','row',to_jsonb(g))) IS NULL),'no eligible expense left active');
SELECT public.assert_true((SELECT faturas=(SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM faturas_cartao t)
  AND cartoes=(SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM cartoes t)
  AND bancos=(SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM bancos t)
  AND outros=(SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) FROM gastos t WHERE user_id<>'aaaaaaaa-0000-0000-0000-000000000001') FROM before_state),'invoices, cards, banks and other users untouched');

SELECT public.assert_true(public.wa_reorganization_last_applied('aaaaaaaa-0000-0000-0000-000000000001','5511999999999')=(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1'),'voice restore finds batch');
SELECT public.wa_reorganization_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1'),'434343');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1')||':434343')->>'status'='restored','cycle restored');
SELECT public.assert_true((SELECT g=(SELECT coalesce(sum(valor),0) FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL)
  AND r=(SELECT coalesce(sum(valor),0) FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL)
  AND ng=(SELECT count(*) FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL) FROM before_state),'restore returns exact totals and counts');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='cycle-1')||':434343')->>'status'<>'restored','second restore does not duplicate');
SELECT public.assert_true((SELECT ng=(SELECT count(*) FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL) FROM before_state),'no duplication after replayed restore');

DELETE FROM public.whatsapp_reorganization_allowlist;
UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
SELECT public.assert_true(NOT public.wa_reorganization_authorized('aaaaaaaa-0000-0000-0000-000000000001','5511999999999'),'locked again after test');
