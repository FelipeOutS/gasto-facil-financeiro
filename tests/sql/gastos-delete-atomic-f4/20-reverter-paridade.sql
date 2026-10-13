-- Paridade com revertExtratoImportadoSeguro + atomicidade (dados fictícios). Roda como 'authenticated'.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;
-- Injeção de falha controlada por GUC (só para teste).
CREATE FUNCTION public.t_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('gi.falha', true) = TG_TABLE_NAME THEN RAISE EXCEPTION 'falha_injetada_%', TG_TABLE_NAME; END IF;
  RETURN coalesce(OLD, NEW); END $$;
CREATE TRIGGER t_falha BEFORE DELETE ON public.transferencias_internas FOR EACH ROW EXECUTE FUNCTION public.t_falha();
CREATE TRIGGER t_falha BEFORE UPDATE ON public.extratos_importados FOR EACH ROW EXECUTE FUNCTION public.t_falha();

-- Fixtures: A=aaaa..1. Lote P (5 tabelas, 1 gasto + 1 receita + 1 transf. editados >5 s). Lote L (limpo).
INSERT INTO public.extratos_importados VALUES
 ('f0000000-0000-0000-0000-00000000000p'::text::uuid,'aaaaaaaa-0000-0000-0000-000000000001','importado')
ON CONFLICT DO NOTHING;
