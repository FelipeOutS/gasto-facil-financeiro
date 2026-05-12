-- Adicionar vínculo opcional de cliente em receitas e contas a receber

ALTER TABLE public.receitas
  ADD COLUMN cliente_id uuid NULL
  REFERENCES public.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receitas_cliente
  ON public.receitas(cliente_id)
  WHERE cliente_id IS NOT NULL;

ALTER TABLE public.contas_a_receber
  ADD COLUMN cliente_id uuid NULL
  REFERENCES public.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contas_a_receber_cliente
  ON public.contas_a_receber(cliente_id)
  WHERE cliente_id IS NOT NULL;

-- Função de validação: garante que o cliente_id pertence ao mesmo user_id da linha
CREATE OR REPLACE FUNCTION public.validate_cliente_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_owner FROM public.clientes WHERE id = NEW.cliente_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Cliente vinculado não existe';
  END IF;

  IF v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Cliente vinculado pertence a outro usuário';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receitas_validate_cliente ON public.receitas;
CREATE TRIGGER trg_receitas_validate_cliente
BEFORE INSERT OR UPDATE OF cliente_id, user_id ON public.receitas
FOR EACH ROW EXECUTE FUNCTION public.validate_cliente_owner();

DROP TRIGGER IF EXISTS trg_contas_a_receber_validate_cliente ON public.contas_a_receber;
CREATE TRIGGER trg_contas_a_receber_validate_cliente
BEFORE INSERT OR UPDATE OF cliente_id, user_id ON public.contas_a_receber
FOR EACH ROW EXECUTE FUNCTION public.validate_cliente_owner();