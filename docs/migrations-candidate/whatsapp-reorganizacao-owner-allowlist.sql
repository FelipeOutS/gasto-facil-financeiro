-- CANDIDATO (não aplicado). Restringe a reorganização em massa a contas
-- explicitamente listadas. Lista nasce VAZIA: ninguém fica liberado até um
-- INSERT autorizado separadamente (dado, não migração). release_enabled continua FALSE.
-- Depende de whatsapp-reorganizacao.sql e whatsapp-reorganizacao-partial-scope.sql.

CREATE TABLE IF NOT EXISTS public.whatsapp_reorganization_allowlist (
  user_id uuid PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  note text
);
GRANT SELECT ON public.whatsapp_reorganization_allowlist TO service_role;
ALTER TABLE public.whatsapp_reorganization_allowlist ENABLE ROW LEVEL SECURITY;
-- Sem políticas: authenticated/anon não leem nem escrevem.

CREATE OR REPLACE FUNCTION public.wa_reorganization_authorized(p_user uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT release_enabled FROM public.whatsapp_reorganization_policy WHERE id),false)
 AND EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user)
 AND coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) BETWEEN 10 AND 15
 AND EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo
   AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL
   AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_authorized(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_authorized(uuid,text) TO service_role;

-- Defesa em profundidade: nenhum lote novo para conta fora da lista, mesmo
-- por writer legado (wa_reorganization_prepare v1) ou chamada direta.
CREATE OR REPLACE FUNCTION public.tg_wa_reorganization_allowlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=NEW.user_id) THEN
  RAISE EXCEPTION 'reorganization_not_allowlisted';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_wa_reorganization_allowlist() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS wa_reorganization_allowlist_guard ON public.whatsapp_reorganization_operations;
CREATE TRIGGER wa_reorganization_allowlist_guard BEFORE INSERT ON public.whatsapp_reorganization_operations
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_allowlist();
