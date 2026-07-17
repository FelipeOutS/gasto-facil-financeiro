DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'whatsapp_consume_inbound_quota_atomic',
        'whatsapp_consume_financial_action_quota_atomic',
        'whatsapp_reserve_outbound_quota_atomic',
        'whatsapp_commit_outbound_quota_atomic',
        'whatsapp_release_outbound_quota_atomic',
        'whatsapp_get_usage_snapshot',
        'whatsapp_user_in_rollout',
        'tg_whatsapp_runtime_config_audit'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;