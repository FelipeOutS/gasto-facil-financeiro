-- CANDIDATA. Aplicar somente após autorização. Não toca tabelas do Cofre antigo.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.enqueue_email(text,jsonb)') IS NULL THEN RAISE EXCEPTION 'email_queue_required'; END IF;
END $$;
ALTER TABLE public.vaults ADD COLUMN access_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.vault_keyslots DROP CONSTRAINT vault_keyslots_kind_check;
ALTER TABLE public.vault_keyslots ADD CONSTRAINT vault_keyslots_kind_check CHECK(kind IN ('passkey_prf','recovery','passkey_prf_pin','password'));
CREATE UNIQUE INDEX vault_v2_one_password ON public.vault_keyslots(vault_id) WHERE kind='password' AND revoked_at IS NULL;
-- Existing direct keyslot grants remain for passkeys. Password counters/envelopes
-- can only be changed while running as the owner of the security-definer RPCs.
CREATE FUNCTION public.vault_v2_guard_password_slot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_name name;
BEGIN
 IF NEW.kind='password' OR (TG_OP='UPDATE' AND OLD.kind='password') THEN
   SELECT pg_get_userbyid(proowner) INTO owner_name FROM pg_proc WHERE oid='public.vault_v2_password_replace(uuid,uuid,jsonb,uuid)'::regprocedure;
   IF current_user<>owner_name THEN RAISE EXCEPTION 'password_rpc_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TABLE public.vault_v2_email_challenges (
 user_id uuid PRIMARY KEY, vault_id uuid NOT NULL REFERENCES public.vaults(id),
 nonce uuid NOT NULL, code_hash text NOT NULL, email text NOT NULL,
 expires_at timestamptz NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(),
 attempts int NOT NULL DEFAULT 0, verified_at timestamptz, consumed_at timestamptz,
 notification_id uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE public.vault_v2_email_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vault_v2_email_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vault_v2_email_challenges TO service_role;

CREATE FUNCTION public.vault_v2_email_begin(p_user uuid,p_vault uuid,p_nonce uuid,p_hash text,p_email text,p_delivery jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.vaults WHERE id=p_vault AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.vault_v2_email_challenges WHERE user_id=p_user AND sent_at>now()-interval '10 minutes') THEN RETURN false; END IF;
 INSERT INTO public.vault_v2_email_challenges(user_id,vault_id,nonce,code_hash,email,expires_at)
 VALUES(p_user,p_vault,p_nonce,p_hash,p_email,now()+interval '10 minutes')
 ON CONFLICT(user_id) DO UPDATE SET vault_id=p_vault,nonce=p_nonce,code_hash=p_hash,email=p_email,
 expires_at=now()+interval '10 minutes',sent_at=now(),attempts=0,verified_at=NULL,consumed_at=NULL,notification_id=gen_random_uuid();
 IF p_delivery IS NOT NULL THEN
  IF p_delivery->>'to' IS DISTINCT FROM p_email OR p_delivery->>'message_id' IS DISTINCT FROM p_nonce::text OR p_delivery->>'label' IS DISTINCT FROM 'vault-recovery-code' THEN RAISE EXCEPTION 'invalid_delivery'; END IF;
  PERFORM public.enqueue_email('transactional_emails',p_delivery||jsonb_build_object('queued_at',now(),'expires_at',now()+interval '10 minutes'));
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.vault_v2_email_verify(p_user uuid,p_nonce uuid,p_hash text,p_email text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.vault_v2_email_challenges;
BEGIN
 SELECT * INTO c FROM public.vault_v2_email_challenges WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR c.nonce<>p_nonce OR c.email<>p_email OR c.expires_at<=now() OR c.attempts>=5 OR c.verified_at IS NOT NULL OR c.consumed_at IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.vault_v2_email_challenges SET attempts=attempts+1 WHERE user_id=p_user;
 IF c.code_hash<>p_hash THEN RETURN false; END IF;
 UPDATE public.vault_v2_email_challenges SET verified_at=now(),code_hash='' WHERE user_id=p_user;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.vault_v2_email_begin(uuid,uuid,uuid,text,text,jsonb),public.vault_v2_email_verify(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vault_v2_email_begin(uuid,uuid,uuid,text,text,jsonb),public.vault_v2_email_verify(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.vault_v2_password_attempt(p_vault uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.vault_keyslots;
BEGIN
 SELECT * INTO s FROM public.vault_keyslots WHERE vault_id=p_vault AND user_id=auth.uid() AND kind='password' AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF s.locked_until>now() THEN RETURN NULL; END IF;
 IF s.locked_until IS NULL OR s.locked_until<=now() THEN
   IF s.failed_attempts>=5 THEN s.failed_attempts:=0; END IF;
 END IF;
 UPDATE public.vault_keyslots SET failed_attempts=s.failed_attempts+1,
 locked_until=CASE WHEN s.failed_attempts+1>=5 THEN now()+interval '1 minute' ELSE NULL END WHERE id=s.id;
 RETURN to_jsonb(s);
END $$;
CREATE FUNCTION public.vault_v2_password_replace(p_vault uuid,p_expected uuid,p_envelope jsonb,p_grant uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_id uuid; uid uuid:=auth.uid(); challenge public.vault_v2_email_challenges;
BEGIN
 PERFORM 1 FROM public.vaults WHERE id=p_vault AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT id INTO old_id FROM public.vault_keyslots WHERE vault_id=p_vault AND user_id=uid AND kind='password' AND revoked_at IS NULL;
 IF old_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'vault_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vault_keyslots WHERE vault_id=p_vault AND user_id=uid AND kind='recovery' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'manter_recuperacao'; END IF;
 IF p_grant IS NOT NULL THEN
   UPDATE public.vault_v2_email_challenges SET consumed_at=now() WHERE user_id=uid AND vault_id=p_vault AND nonce=p_grant AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at>now() RETURNING * INTO challenge;
   IF NOT FOUND THEN RAISE EXCEPTION 'recovery_expired'; END IF;
 END IF;
 IF p_envelope IS NOT NULL AND (p_envelope->>'kind' IS DISTINCT FROM 'password' OR p_envelope->>'kdf' IS DISTINCT FROM 'PBKDF2-SHA256' OR p_envelope->>'iterations' IS DISTINCT FROM '600000' OR length(p_envelope->>'ct') IS DISTINCT FROM 64 OR length(p_envelope->>'salt') IS DISTINCT FROM 44 OR length(p_envelope->>'iv') IS DISTINCT FROM 16 OR p_envelope->>'context' IS DISTINCT FROM ('["gi-vault-v2-password","'||uid||'","'||p_vault||'"]')) THEN RAISE EXCEPTION 'invalid_envelope'; END IF;
 UPDATE public.vault_keyslots SET revoked_at=now(),envelope='{"revoked":true}' WHERE id=old_id;
 IF p_envelope IS NOT NULL THEN
 INSERT INTO public.vault_keyslots(vault_id,user_id,kind,envelope,device_label) VALUES(p_vault,uid,'password',p_envelope,'Senha do Cofre');
 END IF;
 INSERT INTO public.vault_security_events(vault_id,user_id,event) VALUES(p_vault,uid,CASE WHEN p_grant IS NOT NULL THEN 'password_email_recovered' WHEN p_envelope IS NULL THEN 'password_disabled' ELSE 'password_changed' END);
 UPDATE public.vaults SET access_version=access_version+1 WHERE id=p_vault AND user_id=uid;
 IF p_grant IS NOT NULL THEN
  PERFORM public.enqueue_email('transactional_emails',jsonb_build_object(
   'message_id',challenge.notification_id,'to',challenge.email,
   'from','Gasto Inteligente <no-reply@notify.gastointeligente.com.br>',
   'sender_domain','notify.gastointeligente.com.br','subject','Senha do Cofre alterada',
   'text','A senha do Cofre novo foi alterada após confirmação por e-mail e desbloqueio criptográfico. Se não foi você, proteja sua conta e revise os aparelhos autorizados.',
   'purpose','transactional','label','vault-password-changed',
   'idempotency_key','vault:'||p_grant::text||':changed','queued_at',now()));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.vault_v2_password_attempt(uuid),public.vault_v2_password_replace(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vault_v2_password_attempt(uuid),public.vault_v2_password_replace(uuid,uuid,jsonb,uuid) TO authenticated;
CREATE TRIGGER vault_v2_password_guard BEFORE INSERT OR UPDATE ON public.vault_keyslots FOR EACH ROW EXECUTE FUNCTION public.vault_v2_guard_password_slot();
COMMIT;
