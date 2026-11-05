-- Tabelas fictícias dos blocos vinculados (antes do candidato full-reset).
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS id_operacao_banco text;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS id_operacao_banco text;
ALTER TABLE public.faturas_cartao ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.contas_a_pagar ADD COLUMN IF NOT EXISTS valor numeric, ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS recorrente boolean, ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS public.contas_a_receber(id uuid PRIMARY KEY,user_id uuid NOT NULL,titulo text,valor_total numeric,status text,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.transferencias_internas(id uuid PRIMARY KEY,user_id uuid NOT NULL,descricao text,valor numeric,data date,id_operacao_banco text,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.recorrencias(id uuid PRIMARY KEY,user_id uuid NOT NULL,nome text,valor numeric,status text,proxima_cobranca date,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.bens_pagamentos(id uuid PRIMARY KEY,user_id uuid,gasto_id uuid);
GRANT ALL ON public.contas_a_receber,public.transferencias_internas,public.recorrencias,public.bens_pagamentos TO service_role;
-- Espelha as chaves únicas reais (constraint de fatura e índice parcial de detecção).
ALTER TABLE public.faturas_cartao ADD CONSTRAINT faturas_cartao_unique UNIQUE (user_id,cartao_id,mes,ano);
ALTER TABLE public.recorrencias ADD COLUMN IF NOT EXISTS detection_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_recorrencias_detection_key ON public.recorrencias(user_id,detection_key) WHERE detection_key IS NOT NULL;
