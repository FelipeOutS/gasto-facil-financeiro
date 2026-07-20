
CREATE TABLE public.whatsapp_meta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_key text NOT NULL REFERENCES public.whatsapp_notification_templates(key) ON DELETE RESTRICT,
  internal_key text NOT NULL,
  meta_name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  version integer NOT NULL,
  body text NOT NULL,
  footer text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  placeholder_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  examples jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  provider_template_id text,
  rejection_reason text,
  quality_score text,
  active boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT wa_meta_templates_version_positive CHECK (version > 0),
  CONSTRAINT wa_meta_templates_language_ck CHECK (char_length(language) BETWEEN 2 AND 10),
  CONSTRAINT wa_meta_templates_category_ck CHECK (category IN ('UTILITY','AUTHENTICATION','MARKETING')),
  CONSTRAINT wa_meta_templates_status_ck CHECK (status IN ('draft','submitted','pending','approved','rejected','paused','disabled','unknown')),
  CONSTRAINT wa_meta_templates_active_requires_approved CHECK (active = false OR status = 'approved'),
  CONSTRAINT wa_meta_templates_provider_id_when_not_draft CHECK (
    status IN ('draft','unknown') OR provider_template_id IS NOT NULL
  ),
  CONSTRAINT wa_meta_templates_meta_name_fmt CHECK (
    meta_name ~ '^[a-z][a-z0-9_]+$' AND char_length(meta_name) BETWEEN 3 AND 512
  ),
  CONSTRAINT wa_meta_templates_body_nonempty CHECK (char_length(body) > 0),
  CONSTRAINT wa_meta_templates_unique_internal UNIQUE (internal_key, version),
  CONSTRAINT wa_meta_templates_unique_meta UNIQUE (meta_name, language)
);

CREATE INDEX wa_meta_templates_notification_key_idx ON public.whatsapp_meta_templates (notification_key);
CREATE INDEX wa_meta_templates_status_active_idx ON public.whatsapp_meta_templates (status, active);

REVOKE ALL ON public.whatsapp_meta_templates FROM PUBLIC;
REVOKE ALL ON public.whatsapp_meta_templates FROM anon;
REVOKE ALL ON public.whatsapp_meta_templates FROM authenticated;
GRANT ALL ON public.whatsapp_meta_templates TO service_role;

ALTER TABLE public.whatsapp_meta_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_meta_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages meta templates"
  ON public.whatsapp_meta_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.wa_meta_templates_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wa_meta_templates_touch
  BEFORE UPDATE ON public.whatsapp_meta_templates
  FOR EACH ROW EXECUTE FUNCTION public.wa_meta_templates_touch_updated_at();

INSERT INTO public.whatsapp_meta_templates
  (notification_key, internal_key, meta_name, language, category, version, body, footer, placeholder_schema, examples)
VALUES
  (
    'gi_conta_vencendo_hoje', 'gi_conta_vencendo_hoje', 'gi_conta_vencendo_hoje_v1', 'pt_BR', 'UTILITY', 1,
    E'Olá! Você tem uma conta com vencimento hoje ({{1}}): {{2}}.\n\nAbra o app Gasto Inteligente para revisar ou dar baixa.\n\nPara parar de receber mensagens, responda PARAR.',
    'Gasto Inteligente • Lembrete automático',
    '{"1":{"type":"date","format":"dd/mm/yyyy","required":true},"2":{"type":"label","min":1,"max":40,"required":true,"sanitize":true}}'::jsonb,
    '{"1":"20/07/2026","2":"Conta cadastrada"}'::jsonb
  ),
  (
    'gi_conta_vencendo_amanha', 'gi_conta_vencendo_amanha', 'gi_conta_vencendo_amanha_v1', 'pt_BR', 'UTILITY', 1,
    E'Olá! Você tem uma conta com vencimento amanhã ({{1}}): {{2}}.\n\nAbra o app Gasto Inteligente para revisar ou programar o pagamento.\n\nPara parar de receber mensagens, responda PARAR.',
    'Gasto Inteligente • Lembrete automático',
    '{"1":{"type":"date","format":"dd/mm/yyyy","required":true},"2":{"type":"label","min":1,"max":40,"required":true,"sanitize":true}}'::jsonb,
    '{"1":"21/07/2026","2":"Conta cadastrada"}'::jsonb
  ),
  (
    'gi_conta_atrasada', 'gi_conta_atrasada', 'gi_conta_atrasada_v1', 'pt_BR', 'UTILITY', 1,
    E'Olá! Identificamos uma conta em atraso desde {{1}}: {{2}}.\n\nAbra o app Gasto Inteligente para regularizar ou registrar o pagamento.\n\nPara parar de receber mensagens, responda PARAR.',
    'Gasto Inteligente • Lembrete automático',
    '{"1":{"type":"date","format":"dd/mm/yyyy","required":true},"2":{"type":"label","min":1,"max":40,"required":true,"sanitize":true}}'::jsonb,
    '{"1":"15/07/2026","2":"Conta cadastrada"}'::jsonb
  );
