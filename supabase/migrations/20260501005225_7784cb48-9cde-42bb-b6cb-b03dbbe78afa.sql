-- Tabela de alertas inteligentes do usuário
CREATE TABLE IF NOT EXISTS public.user_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'unread',
  related_entity_type TEXT,
  related_entity_id TEXT,
  action_label TEXT,
  action_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL,
  period_key TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  ignored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_alerts_priority_check CHECK (priority IN ('baixa','media','alta','critica')),
  CONSTRAINT user_alerts_status_check CHECK (status IN ('unread','read','resolved','ignored'))
);

-- Deduplicação: mesmo usuário + mesmo dedupe_key + mesmo período = registro único
CREATE UNIQUE INDEX IF NOT EXISTS user_alerts_dedupe_uniq
  ON public.user_alerts (user_id, dedupe_key, period_key);

CREATE INDEX IF NOT EXISTS user_alerts_user_status_idx
  ON public.user_alerts (user_id, status);

CREATE INDEX IF NOT EXISTS user_alerts_user_created_idx
  ON public.user_alerts (user_id, created_at DESC);

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_alerts_select_own"
  ON public.user_alerts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_alerts_insert_own"
  ON public.user_alerts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_alerts_update_own"
  ON public.user_alerts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_alerts_delete_own"
  ON public.user_alerts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS user_alerts_set_updated_at ON public.user_alerts;
CREATE TRIGGER user_alerts_set_updated_at
  BEFORE UPDATE ON public.user_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();