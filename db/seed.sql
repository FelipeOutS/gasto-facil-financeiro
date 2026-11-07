-- Dados exclusivamente fictícios para homologação isolada do fluxo simples do WhatsApp.
-- Nenhum dado pessoal ou financeiro real. Login de teste: homologacao@example.com / Teste-Homolog-2026
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new)
VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'homologacao@example.com', extensions.crypt('Teste-Homolog-2026', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}', '{"nome":"Conta Teste Homologação"}', '', '', '', '');

INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
VALUES (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001', 'email', 'a0000000-0000-4000-8000-000000000001',
  '{"sub":"a0000000-0000-4000-8000-000000000001","email":"homologacao@example.com"}', now(), now());

INSERT INTO public.profiles (id, nome) VALUES ('a0000000-0000-4000-8000-000000000001', 'Conta Teste Homologação')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_plans (user_id, plano, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000000001', 'pessoal_premium', 'ativo', now(), now() + interval '365 days')
ON CONFLICT (user_id) DO UPDATE SET plano = EXCLUDED.plano, status = EXCLUDED.status,
  current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end;

-- Telefone fictício (faixa não atribuída), vínculo verificado e consentimento registrado.
INSERT INTO public.whatsapp_links (user_id, telefone, ativo, opt_in_em, opt_in_version, verification_state, verified_at)
VALUES ('a0000000-0000-4000-8000-000000000001', '5511900000001', true, now(), 'homologacao-teste', 'verified', now());

INSERT INTO public.gastos (id, user_id, descricao, valor, data, forma_pagamento, mes, ano, tipo_gasto, total_parcelas, origem)
VALUES ('b0000000-0000-4000-8000-000000000150', 'a0000000-0000-4000-8000-000000000001', 'Mercado (teste)', 150.00,
  DATE '2026-10-20', 'pix', 10, 2026, 'unico', 1, 'web');
