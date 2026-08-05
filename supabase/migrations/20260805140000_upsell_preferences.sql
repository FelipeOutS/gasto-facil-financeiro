-- Tabela de preferências de comunicação de upgrade
CREATE TABLE public.user_communication_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    last_banner_at timestamptz,
    last_modal_at timestamptz,
    snooze_until timestamptz,
    dismiss_count integer DEFAULT 0,
    last_trigger text,
    converted_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (user_id)
);

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.user_communication_preferences TO authenticated;
GRANT ALL ON public.user_communication_preferences TO service_role;

-- RLS
ALTER TABLE public.user_communication_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own communication preferences"
ON public.user_communication_preferences
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Configuração administrativa do Upsell
CREATE TABLE public.upsell_runtime_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text UNIQUE NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamptz DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.upsell_runtime_config TO authenticated;
GRANT ALL ON public.upsell_runtime_config TO service_role;

ALTER TABLE public.upsell_runtime_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage upsell config"
ON public.upsell_runtime_config
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Users can read upsell config"
ON public.upsell_runtime_config
FOR SELECT
TO authenticated
USING (true);

-- Seed de configurações padrão
INSERT INTO public.upsell_runtime_config (key, value) VALUES
('enabled', 'true'::jsonb),
('banner_interval_days', '7'::jsonb),
('modal_interval_days', '21'::jsonb),
('dismiss_snooze_days', '14'::jsonb),
('max_dismiss_snooze_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
