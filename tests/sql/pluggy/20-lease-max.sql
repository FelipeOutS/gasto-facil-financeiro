CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
SET ROLE service_role;
SELECT public.pluggy_webhook_enqueue('L1','item/updated','iM','{}');
UPDATE public.pluggy_webhook_events SET max_attempts=2 WHERE event_id='L1';
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..4 LOOP
    PERFORM public.pluggy_webhook_claim(50, 60);
    UPDATE public.pluggy_webhook_events SET locked_until = now() - interval '1 second' WHERE event_id='L1' AND status='processando';
  END LOOP; END $$;
SELECT pg_temp.ok(attempts=2 AND status='esgotado' AND error='reserva_expirada_limite', 'reserva expirada respeita max_attempts e vira esgotado') FROM public.pluggy_webhook_events WHERE event_id='L1';
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_webhook_claim(50,60) c WHERE c.id=(SELECT id FROM public.pluggy_webhook_events WHERE event_id='L1'))=0, 'esgotado não é reservado de novo');
SELECT pg_temp.ok((SELECT status FROM public.pluggy_webhook_enqueue('L1','item/updated','iM','{}'))='esgotado', 'reentrega não reativa esgotado');
