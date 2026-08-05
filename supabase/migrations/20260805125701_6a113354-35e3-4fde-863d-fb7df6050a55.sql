-- === 1. Persistência mínima de atividade (sem dados financeiros) ===
ALTER TABLE public.user_communication_preferences
  ADD COLUMN IF NOT EXISTS distinct_use_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_date date,
  ADD COLUMN IF NOT EXISTS paid_feature_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_shown_at timestamptz;

-- === 2. RLS de upsell_runtime_config: exclusiva do owner ===
DROP POLICY IF EXISTS "Users can read upsell config" ON public.upsell_runtime_config;
DROP POLICY IF EXISTS "Admins can manage upsell config" ON public.upsell_runtime_config;

REVOKE ALL ON public.upsell_runtime_config FROM authenticated;
REVOKE ALL ON public.upsell_runtime_config FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.upsell_runtime_config TO authenticated;
GRANT ALL ON public.upsell_runtime_config TO service_role;

CREATE POLICY "Owner only can read upsell config"
ON public.upsell_runtime_config
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owner only can insert upsell config"
ON public.upsell_runtime_config
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owner only can update upsell config"
ON public.upsell_runtime_config
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'owner'))
WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owner only can delete upsell config"
ON public.upsell_runtime_config
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

-- === 3. converted_at só pelo servidor ===
CREATE OR REPLACE FUNCTION public.tg_upsell_prefs_guard_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.converted_at := NULL;
  ELSE
    NEW.converted_at := OLD.converted_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_upsell_prefs_guard ON public.user_communication_preferences;
CREATE TRIGGER tr_upsell_prefs_guard
BEFORE INSERT OR UPDATE ON public.user_communication_preferences
FOR EACH ROW EXECUTE FUNCTION public.tg_upsell_prefs_guard_server_fields();

-- === 4. Policies explícitas por operação (auditáveis) ===
DROP POLICY IF EXISTS "Users can manage their own communication preferences" ON public.user_communication_preferences;

CREATE POLICY "Users can read own communication preferences"
ON public.user_communication_preferences
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own communication preferences"
ON public.user_communication_preferences
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own communication preferences"
ON public.user_communication_preferences
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);