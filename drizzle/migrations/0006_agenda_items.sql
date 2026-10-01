-- GI Agenda e Lembretes: fonte única para site e WhatsApp. Aditiva.
CREATE TABLE IF NOT EXISTS public.agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'lembrete' CHECK (kind IN ('lembrete','compromisso')),
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 1000),
  starts_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','concluido','cancelado')),
  recurrence_freq text CHECK (recurrence_freq IN ('diaria','semanal','mensal','anual')),
  recurrence_interval smallint NOT NULL DEFAULT 1 CHECK (recurrence_interval BETWEEN 1 AND 365),
  recurrence_until date,
  aviso_minutos_antes integer NOT NULL DEFAULT 0 CHECK (aviso_minutos_antes BETWEEN 0 AND 43200),
  source_type text CHECK (source_type IN ('conta_a_pagar','cartao','recorrencia')),
  source_id uuid,
  aviso_dias_antes smallint CHECK (aviso_dias_antes BETWEEN 0 AND 60),
  aviso_hora_local smallint NOT NULL DEFAULT 9 CHECK (aviso_hora_local BETWEEN 0 AND 23),
  origem text NOT NULL DEFAULT 'site' CHECK (origem IN ('site','whatsapp')),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_items_source_pair CHECK ((source_type IS NULL) = (source_id IS NULL)),
  CONSTRAINT agenda_items_when CHECK (source_type IS NOT NULL OR starts_at IS NOT NULL)
);

COMMENT ON COLUMN public.agenda_items.starts_at IS 'UTC. Para itens financeiros pode ser NULL: a data vem da entidade de origem no momento da leitura/aviso.';

CREATE INDEX IF NOT EXISTS idx_agenda_user_starts ON public.agenda_items (user_id, starts_at) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS idx_agenda_user_status ON public.agenda_items (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_source ON public.agenda_items (source_type, source_id) WHERE source_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_items TO authenticated;
GRANT ALL ON public.agenda_items TO service_role;

ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_select_own" ON public.agenda_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "agenda_insert_own" ON public.agenda_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agenda_update_own" ON public.agenda_items FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agenda_delete_own" ON public.agenda_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Vínculo financeiro precisa pertencer ao MESMO usuário (vale para site e WhatsApp/service role).
CREATE OR REPLACE FUNCTION public.agenda_validate_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean := true;
BEGIN
  IF NEW.source_type IS NOT NULL THEN
    IF NEW.source_type = 'conta_a_pagar' THEN
      SELECT EXISTS (SELECT 1 FROM public.contas_a_pagar c WHERE c.id = NEW.source_id AND c.user_id = NEW.user_id) INTO ok;
    ELSIF NEW.source_type = 'cartao' THEN
      SELECT EXISTS (SELECT 1 FROM public.cartoes c WHERE c.id = NEW.source_id AND c.user_id = NEW.user_id) INTO ok;
    ELSIF NEW.source_type = 'recorrencia' THEN
      SELECT EXISTS (SELECT 1 FROM public.recorrencias r WHERE r.id = NEW.source_id AND r.user_id = NEW.user_id) INTO ok;
    END IF;
    IF NOT ok THEN
      RAISE EXCEPTION 'agenda_source_not_owned' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'agenda_owner_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'concluido' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  IF NEW.status = 'cancelado' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_agenda_validate_source
  BEFORE INSERT OR UPDATE ON public.agenda_items
  FOR EACH ROW EXECUTE FUNCTION public.agenda_validate_source();

CREATE TRIGGER tg_agenda_updated_at
  BEFORE UPDATE ON public.agenda_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Preferência "receber lembretes da agenda pelo WhatsApp" (reutiliza tabela existente).
ALTER TABLE public.whatsapp_notification_preferences ADD COLUMN IF NOT EXISTS agenda boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agenda_items') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agenda_items';
  END IF;
END;
$$;