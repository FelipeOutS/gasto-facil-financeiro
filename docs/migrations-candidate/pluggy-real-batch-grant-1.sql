-- CANDIDATA — NÃO EXECUTADA. Autorização do 1º lote real (exige aprovação separada por hash).
-- Lote fixo: adc45cd8-a694-460e-9c69-d348132764f8 — 3 rendimentos Mercado Pago (conector 606), total R$ 0,03, validade 24h a partir da execução.
-- Fora: Pix R$ 35 e R$ 150, cartão, transferências e demais movimentações.
INSERT INTO public.pluggy_real_batch_grants (batch_id, user_id, item_count, total, expires_at)
VALUES ('adc45cd8-a694-460e-9c69-d348132764f8'::uuid, '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, 3, 0.03, now() + interval '24 hours');
INSERT INTO public.pluggy_real_batch_grant_items (batch_id, user_id, account_id, transaction_id, entry_table, valor, data, categoria_id, tipo) VALUES
  ('adc45cd8-a694-460e-9c69-d348132764f8'::uuid, '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '2ebbbdd2-f2bf-4eec-8179-08d5f9eaa66b', '684afd15-cec6-43ad-8831-655304d3c45d', 'receitas', 0.01, '2026-10-13', NULL, 'outros'),
  ('adc45cd8-a694-460e-9c69-d348132764f8'::uuid, '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '2ebbbdd2-f2bf-4eec-8179-08d5f9eaa66b', '844dc673-5b09-48f5-9e31-348f97c602e5', 'receitas', 0.01, '2026-10-14', NULL, 'outros'),
  ('adc45cd8-a694-460e-9c69-d348132764f8'::uuid, '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '2ebbbdd2-f2bf-4eec-8179-08d5f9eaa66b', '323eaf7f-4624-4cab-ab21-d7afd92077df', 'receitas', 0.01, '2026-10-15', NULL, 'outros');
