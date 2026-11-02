-- CANDIDATO — NÃO APLICADO. Exige aprovação separada.
-- Objetivo: permitir que conexões REAIS (is_sandbox=false) sejam guardadas
-- apenas no staging pluggy_*, e somente para os dois titulares autorizados.
-- Não altera importação/vínculo: pluggy_import_apply, pluggy_link_card e
-- pluggy_validate_relationship continuam exigindo Sandbox, e
-- pluggy_assert_financial_release continua rejeitando qualquer gravação.
-- Sem BEGIN/COMMIT: a ferramenta de migração aplica tudo numa única transação.


ALTER TABLE public.pluggy_items DROP CONSTRAINT pluggy_items_sandbox_only;
ALTER TABLE public.pluggy_items ADD CONSTRAINT pluggy_items_sandbox_or_allowlisted
  CHECK (is_sandbox OR user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid));

ALTER TABLE public.pluggy_accounts DROP CONSTRAINT pluggy_accounts_sandbox_only;
ALTER TABLE public.pluggy_accounts ADD CONSTRAINT pluggy_accounts_sandbox_or_allowlisted
  CHECK (is_sandbox OR user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid));

ALTER TABLE public.pluggy_transactions DROP CONSTRAINT pluggy_tx_sandbox_only;
ALTER TABLE public.pluggy_transactions ADD CONSTRAINT pluggy_tx_sandbox_or_allowlisted
  CHECK (is_sandbox OR user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid));

