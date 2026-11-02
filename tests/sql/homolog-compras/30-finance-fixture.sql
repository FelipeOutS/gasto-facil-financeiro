-- Fixture FICTÍCIA ponta a ponta: F2 aplicada + leitura financeira read-only.
-- Usuário inventado; nenhum dado real. Tabelas mínimas com as colunas que o loader lê.
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS gasto_fixo boolean, ADD COLUMN IF NOT EXISTS recorrencia_id uuid,
  ADD COLUMN IF NOT EXISTS total_parcelas int, ADD COLUMN IF NOT EXISTS parcela_atual int;
CREATE TABLE public.receitas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, data date NOT NULL,
  valor numeric NOT NULL, descricao text, origem text, tipo text, deleted_at timestamptz);
CREATE TABLE public.recorrencias (id uuid PRIMARY KEY, user_id uuid NOT NULL, valor numeric, status text, frequencia text);
CREATE TABLE public.contas_a_pagar (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, nome text, valor numeric,
  status text, gasto_id uuid, recorrencia_id uuid, data_vencimento date);
GRANT SELECT ON public.receitas, public.recorrencias, public.contas_a_pagar TO service_role;

-- E = usuário fictício; O = outro usuário fictício (não pode vazar).
INSERT INTO public.receitas (user_id, data, valor, descricao) VALUES
 ('eeeeeeee-0000-0000-0000-00000000000e','2026-07-05',5000,'Salário'),
 ('eeeeeeee-0000-0000-0000-00000000000e','2026-08-05',5000,'Salário'),
 ('eeeeeeee-0000-0000-0000-00000000000e','2026-09-05',5000,'Salário'),
 ('eeeeeeee-0000-0000-0000-00000000000e','2026-09-06',3000,'Transferência entre contas'),
 ('eeeeeeee-0000-0000-0000-00000000000e','2026-10-01',9999,'Salário mês atual'),
 ('00000000-0000-0000-0000-0000000000f0','2026-09-05',99999,'Outro usuário');
INSERT INTO public.recorrencias VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','eeeeeeee-0000-0000-0000-00000000000e',50,'ativa','mensal');
INSERT INTO public.gastos (user_id, descricao, valor, data, gasto_fixo, recorrencia_id, total_parcelas, parcela_atual, grupo_parcelamento_id, cartao_id) VALUES
 ('eeeeeeee-0000-0000-0000-00000000000e','Restaurante (cartão)',300,'2026-09-02',false,null,1,1,null,'eeeeeeee-0000-0000-0000-0000000000c1'),
 ('eeeeeeee-0000-0000-0000-00000000000e','Lançado por engano',900,'2026-08-10',false,null,1,1,null,null),
 ('eeeeeeee-0000-0000-0000-00000000000e','TV 10x',200,'2026-09-01',false,null,10,3,'eeeeeeee-0000-0000-0000-0000000000b1',null),
 ('eeeeeeee-0000-0000-0000-00000000000e','TV 10x',200,'2026-10-01',false,null,10,4,'eeeeeeee-0000-0000-0000-0000000000b1',null),
 ('eeeeeeee-0000-0000-0000-00000000000e','Netflix',50,'2026-08-01',false,'eeeeeeee-0000-0000-0000-0000000000a1',1,1,null,null),
 ('00000000-0000-0000-0000-0000000000f0','Outro usuário',77777,'2026-09-01',false,null,1,1,null,null);
INSERT INTO public.contas_a_pagar (user_id, nome, valor, status, data_vencimento, recorrencia_id) VALUES
 ('eeeeeeee-0000-0000-0000-00000000000e','Aluguel',1500,'pendente','2026-10-10',null),
 ('eeeeeeee-0000-0000-0000-00000000000e','Fatura Nubank',2000,'pendente','2026-10-12',null),
 ('eeeeeeee-0000-0000-0000-00000000000e','Netflix',50,'pendente','2026-10-15','eeeeeeee-0000-0000-0000-0000000000a1');

-- Exclusão reversível REAL pela RPC da F2, como o próprio usuário fictício (agosto inteiro → 1 gasto avulso + Netflix).
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-00000000000e', false);
CREATE TEMP TABLE pv AS SELECT public.gastos_preview_exclusao_periodo('2026-08-10','2026-08-11',false) v;
SELECT public.gastos_soft_delete_periodo('2026-08-10','2026-08-11',false,
  (SELECT (v->>'count')::int FROM pv), (SELECT (v->>'sum')::numeric FROM pv), (SELECT v->>'snapshot' FROM pv),
  'eeeeeeee-0000-0000-0000-0000000000d1');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','', false);
