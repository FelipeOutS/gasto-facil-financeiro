-- whatsapp_links: telefone -> user
CREATE TABLE public.whatsapp_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  telefone text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  ultimo_uso timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_links_user ON public.whatsapp_links(user_id);
CREATE INDEX idx_whatsapp_links_telefone ON public.whatsapp_links(telefone);

ALTER TABLE public.whatsapp_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_links_select_own" ON public.whatsapp_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_links_insert_own" ON public.whatsapp_links
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_links_update_own" ON public.whatsapp_links
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_links_delete_own" ON public.whatsapp_links
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_wa_links_updated_at
  BEFORE UPDATE ON public.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- whatsapp_messages: histórico/log de mensagens recebidas
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  external_id text,
  telefone text NOT NULL,
  texto text NOT NULL,
  recebida_em timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'recebida',
  gasto_id uuid,
  confianca numeric,
  parsed jsonb,
  resposta_sugerida text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_whatsapp_messages_external_id
  ON public.whatsapp_messages(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_whatsapp_messages_user ON public.whatsapp_messages(user_id);
CREATE INDEX idx_whatsapp_messages_telefone ON public.whatsapp_messages(telefone);
CREATE INDEX idx_whatsapp_messages_recebida_em
  ON public.whatsapp_messages(recebida_em DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_msgs_select_own" ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_msgs_insert_own" ON public.whatsapp_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_msgs_update_own" ON public.whatsapp_messages
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_msgs_delete_own" ON public.whatsapp_messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_wa_msgs_updated_at
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();