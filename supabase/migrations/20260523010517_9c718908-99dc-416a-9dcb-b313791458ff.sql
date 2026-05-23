
-- Tabela global de PIN do Cofre Pessoal (zero-knowledge)
-- Servidor armazena apenas: salt, iterations e a chave-mestra do cofre cifrada (AES-GCM) por uma chave derivada do PIN via PBKDF2.
-- Nem o PIN nem a chave-mestra ficam no servidor.
CREATE TABLE IF NOT EXISTS public.vault_pin_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  salt text NOT NULL,
  iterations integer NOT NULL DEFAULT 600000,
  wrapped_key text NOT NULL,
  wrap_iv text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_pin_settings ENABLE ROW LEVEL SECURITY;

-- SELECT direto (cliente precisa ler o blob para tentar desembrulhar localmente)
CREATE POLICY "vault_pin_select_own" ON public.vault_pin_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE só via RPCs (revogamos políticas diretas para impedir reset trivial do contador)
-- Sem políticas INSERT/UPDATE/DELETE => bloqueado para usuários autenticados, apenas SECURITY DEFINER passa.

CREATE TRIGGER vault_pin_settings_updated_at
  BEFORE UPDATE ON public.vault_pin_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Define / substitui o PIN (reseta contador de tentativas e desbloqueio)
CREATE OR REPLACE FUNCTION public.vault_pin_set(
  p_salt text,
  p_iterations integer,
  p_wrapped_key text,
  p_wrap_iv text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_iterations < 100000 THEN
    RAISE EXCEPTION 'iterations too low';
  END IF;
  IF length(p_salt) < 16 OR length(p_wrapped_key) < 16 OR length(p_wrap_iv) < 12 THEN
    RAISE EXCEPTION 'invalid pin payload';
  END IF;

  INSERT INTO public.vault_pin_settings (user_id, salt, iterations, wrapped_key, wrap_iv, failed_attempts, locked_until)
  VALUES (uid, p_salt, p_iterations, p_wrapped_key, p_wrap_iv, 0, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    salt = EXCLUDED.salt,
    iterations = EXCLUDED.iterations,
    wrapped_key = EXCLUDED.wrapped_key,
    wrap_iv = EXCLUDED.wrap_iv,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now();
END;
$$;

-- Remove o PIN da conta
CREATE OR REPLACE FUNCTION public.vault_pin_delete()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  DELETE FROM public.vault_pin_settings WHERE user_id = uid;
END;
$$;

-- Registra tentativa: success=true reseta contador; success=false incrementa e, em 5 erros, bloqueia 15 min.
-- Retorna failed_attempts e locked_until atualizados.
CREATE OR REPLACE FUNCTION public.vault_pin_record_attempt(p_success boolean)
RETURNS TABLE(failed_attempts integer, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_attempts integer;
  v_lock timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT s.failed_attempts, s.locked_until INTO v_attempts, v_lock
  FROM public.vault_pin_settings s WHERE s.user_id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pin configured';
  END IF;

  IF v_lock IS NOT NULL AND v_lock > now() THEN
    RETURN QUERY SELECT v_attempts, v_lock;
    RETURN;
  END IF;

  IF p_success THEN
    UPDATE public.vault_pin_settings
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE user_id = uid
     RETURNING public.vault_pin_settings.failed_attempts, public.vault_pin_settings.locked_until
       INTO v_attempts, v_lock;
  ELSE
    v_attempts := COALESCE(v_attempts, 0) + 1;
    IF v_attempts >= 5 THEN
      v_lock := now() + interval '15 minutes';
      v_attempts := 0;
    END IF;
    UPDATE public.vault_pin_settings
       SET failed_attempts = v_attempts, locked_until = v_lock, updated_at = now()
     WHERE user_id = uid
     RETURNING public.vault_pin_settings.failed_attempts, public.vault_pin_settings.locked_until
       INTO v_attempts, v_lock;
  END IF;

  RETURN QUERY SELECT v_attempts, v_lock;
END;
$$;

REVOKE ALL ON FUNCTION public.vault_pin_set(text, integer, text, text) FROM public;
REVOKE ALL ON FUNCTION public.vault_pin_delete() FROM public;
REVOKE ALL ON FUNCTION public.vault_pin_record_attempt(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.vault_pin_set(text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_pin_delete() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_pin_record_attempt(boolean) TO authenticated;
