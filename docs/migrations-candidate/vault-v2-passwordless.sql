-- CANDIDATO (não aplicado). Cofre v2 sem senha mestra. Somente tabelas novas;
-- vault_entries / vault_settings / vault_pin_settings NÃO são tocadas.
CREATE TABLE public.vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Cofre principal',
  kind text NOT NULL DEFAULT 'passkey' CHECK (kind IN ('passkey')),
  auto_lock_minutes int NOT NULL DEFAULT 5 CHECK (auto_lock_minutes BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vault_keyslots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('passkey_prf','recovery','passkey_prf_pin')),
  credential_id text,
  prf_salt text,
  device_label text,
  envelope jsonb NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vault_v2_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vault_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  event text NOT NULL,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vaults, public.vault_keyslots, public.vault_v2_entries TO authenticated;
GRANT DELETE ON public.vault_v2_entries TO authenticated;
GRANT SELECT, INSERT ON public.vault_security_events TO authenticated;
GRANT ALL ON public.vaults, public.vault_keyslots, public.vault_v2_entries, public.vault_security_events TO service_role;
ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_keyslots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_v2_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_security_events ENABLE ROW LEVEL SECURITY;
-- Só o dono; papel admin não concede leitura.
CREATE POLICY own_vaults ON public.vaults FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY own_slots ON public.vault_keyslots FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.vaults v WHERE v.id = vault_id AND v.user_id = auth.uid()));
CREATE POLICY own_entries ON public.vault_v2_entries FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.vaults v WHERE v.id = vault_id AND v.user_id = auth.uid()));
CREATE POLICY own_events_r ON public.vault_security_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_events_w ON public.vault_security_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.vaults v WHERE v.id = vault_id AND v.user_id = auth.uid()));
