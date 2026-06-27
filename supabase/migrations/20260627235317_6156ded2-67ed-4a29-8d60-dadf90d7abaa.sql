
-- 1) Timezone no perfil
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN public.profiles.timezone IS
  'IANA timezone do usuário; usado por dispatcher WhatsApp para quiet hours e agendamentos.';

-- 2) Preferências de notificação por categoria
CREATE TABLE IF NOT EXISTS public.whatsapp_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contas_a_pagar boolean NOT NULL DEFAULT true,
  recorrencias   boolean NOT NULL DEFAULT true,
  metas          boolean NOT NULL DEFAULT false,
  orcamento      boolean NOT NULL DEFAULT false,
  ia_insights    boolean NOT NULL DEFAULT false,
  mercado        boolean NOT NULL DEFAULT false,
  avisos_sistema boolean NOT NULL DEFAULT true,
  quiet_hours_start smallint CHECK (quiet_hours_start IS NULL OR (quiet_hours_start BETWEEN 0 AND 23)),
  quiet_hours_end   smallint CHECK (quiet_hours_end   IS NULL OR (quiet_hours_end   BETWEEN 0 AND 23)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_notification_preferences TO authenticated;
GRANT ALL ON public.whatsapp_notification_preferences TO service_role;

ALTER TABLE public.whatsapp_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wa prefs"
  ON public.whatsapp_notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER tg_wa_prefs_updated_at
  BEFORE UPDATE ON public.whatsapp_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Registry de templates
CREATE TABLE IF NOT EXISTS public.whatsapp_notification_templates (
  key text PRIMARY KEY,
  category text NOT NULL CHECK (category IN (
    'contas_a_pagar','recorrencias','metas','orcamento',
    'ia_insights','mercado','avisos_sistema'
  )),
  default_priority text NOT NULL DEFAULT 'media'
    CHECK (default_priority IN ('baixa','media','alta','critica')),
  requires_template_window boolean NOT NULL DEFAULT true,
  meta_template_name text,
  payload_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_notification_templates TO authenticated;
GRANT ALL  ON public.whatsapp_notification_templates TO service_role;

ALTER TABLE public.whatsapp_notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Templates readable by authenticated"
  ON public.whatsapp_notification_templates
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER tg_wa_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Fila / histórico de notificações
CREATE TABLE IF NOT EXISTS public.whatsapp_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  category text NOT NULL,
  entity_type text,
  entity_id uuid,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','cancelled','skipped')),
  priority text NOT NULL DEFAULT 'media'
    CHECK (priority IN ('baixa','media','alta','critica')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version smallint NOT NULL DEFAULT 1,
  dedupe_key text NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  skipped_reason text,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_notifications_user_dedupe_uniq UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_wa_notif_due
  ON public.whatsapp_notifications (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_wa_notif_user_recent
  ON public.whatsapp_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_notif_entity
  ON public.whatsapp_notifications (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

GRANT SELECT ON public.whatsapp_notifications TO authenticated;
GRANT ALL    ON public.whatsapp_notifications TO service_role;

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wa notifications"
  ON public.whatsapp_notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER tg_wa_notif_updated_at
  BEFORE UPDATE ON public.whatsapp_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
