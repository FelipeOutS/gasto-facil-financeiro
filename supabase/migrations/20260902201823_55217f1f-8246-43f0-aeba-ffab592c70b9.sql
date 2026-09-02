CREATE OR REPLACE FUNCTION public.can_use_whatsapp(_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.whatsapp_beta_access%ROWTYPE;
  now_ts timestamptz := now();
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Admin Master sempre passa.
  IF public.is_full_access(_user_id) THEN
    RETURN true;
  END IF;

  SELECT * INTO r
  FROM public.whatsapp_beta_access
  WHERE user_id = _user_id;

  IF FOUND THEN
    -- Revogação/desativação explícita é bloqueio (lista de exclusão).
    IF r.revoked_at IS NOT NULL OR NOT r.ativo THEN
      RETURN false;
    END IF;
    -- Cortesia válida: passa independente de plano.
    IF r.expires_at IS NULL OR r.expires_at > now_ts THEN
      RETURN true;
    END IF;
  END IF;

  -- Beta gate removido: plano pago com o recurso incluído já libera.
  RETURN public.has_feature_access(_user_id, 'whatsapp');
END;
$function$;