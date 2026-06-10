DO $$
DECLARE fname text;
BEGIN
  FOR fname IN
    SELECT unnest(ARRAY[
      'tg_free_ads_quota_gastos',
      'tg_free_ads_quota_receitas',
      'tg_free_ads_quota_mercado_listas',
      'tg_free_ads_quota_metas',
      'tg_free_ads_quota_cartoes',
      'tg_free_ads_quota_limites'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM anon, authenticated, PUBLIC;', fname);
  END LOOP;
END $$;