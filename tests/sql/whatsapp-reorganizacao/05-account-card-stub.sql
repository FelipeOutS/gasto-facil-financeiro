CREATE TABLE public.bancos(id uuid PRIMARY KEY,user_id uuid NOT NULL,nome text NOT NULL);
CREATE TABLE public.cartoes(id uuid PRIMARY KEY,user_id uuid NOT NULL,dia_fechamento int,dia_vencimento int,limite_total numeric);
ALTER TABLE public.faturas_cartao ADD COLUMN cartao_id uuid, ADD COLUMN mes int, ADD COLUMN ano int, ADD COLUMN status text, ADD COLUMN data_pagamento date;
ALTER TABLE public.gastos ADD COLUMN fatura_competencia text, ADD COLUMN confirmado boolean DEFAULT true;
GRANT ALL ON public.bancos,public.cartoes TO service_role;