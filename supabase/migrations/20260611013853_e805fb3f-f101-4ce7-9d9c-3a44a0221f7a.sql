DO $$
DECLARE
  uid uuid := '44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4';
  err text;
BEGIN
  -- Limpa metas pré-existentes do QA (devem ser 0).
  DELETE FROM public.metas_financeiras WHERE user_id = uid;

  -- 1ª meta deve passar.
  INSERT INTO public.metas_financeiras
    (user_id, nome, valor_objetivo, valor_atual, color_hex)
    VALUES (uid, 'QA Meta 1', 1000, 0, '#34d399');
  RAISE NOTICE 'Meta 1 inserida OK';

  -- 2ª meta deve passar.
  INSERT INTO public.metas_financeiras
    (user_id, nome, valor_objetivo, valor_atual, color_hex)
    VALUES (uid, 'QA Meta 2', 2000, 0, '#60a5fa');
  RAISE NOTICE 'Meta 2 inserida OK';

  -- 3ª meta deve falhar com free_ads_quota_exceeded:metas
  BEGIN
    INSERT INTO public.metas_financeiras
      (user_id, nome, valor_objetivo, valor_atual, color_hex)
      VALUES (uid, 'QA Meta 3', 3000, 0, '#a78bfa');
    RAISE EXCEPTION 'FALHA QA: 3ª meta foi aceita indevidamente';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    RAISE NOTICE 'OK: 3ª meta bloqueada (%).', err;
  END;

  -- Limpeza das metas de QA.
  DELETE FROM public.metas_financeiras WHERE user_id = uid AND nome LIKE 'QA Meta%';
  RAISE NOTICE 'Metas de QA removidas.';
END $$;