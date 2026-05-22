
-- Vault settings (one per user)
CREATE TABLE public.vault_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  salt text NOT NULL,
  verifier text NOT NULL,
  verifier_iv text NOT NULL,
  iterations integer NOT NULL DEFAULT 250000,
  hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_settings_select_own" ON public.vault_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "vault_settings_insert_own" ON public.vault_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vault_settings_update_own" ON public.vault_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "vault_settings_delete_own" ON public.vault_settings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER vault_settings_updated_at
  BEFORE UPDATE ON public.vault_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Vault entries
CREATE TABLE public.vault_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'outros',
  site text,
  favorite boolean NOT NULL DEFAULT false,
  password_strength text NOT NULL DEFAULT 'unknown',
  password_updated_at timestamptz,
  username_cipher text,
  password_cipher text,
  notes_cipher text,
  cipher_iv text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_entries_select_own" ON public.vault_entries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "vault_entries_insert_own" ON public.vault_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vault_entries_update_own" ON public.vault_entries
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "vault_entries_delete_own" ON public.vault_entries
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_vault_entries_user ON public.vault_entries(user_id);
CREATE INDEX idx_vault_entries_user_category ON public.vault_entries(user_id, category);

CREATE TRIGGER vault_entries_updated_at
  BEFORE UPDATE ON public.vault_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
