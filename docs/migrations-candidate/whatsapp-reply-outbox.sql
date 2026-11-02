-- CANDIDATO INATIVO. PostgreSQL >=14. NÃO aplicar sem aprovação.
-- Dependências: whatsapp_messages, whatsapp_links, has_feature_access(uuid,text).
-- Se a tabela de revisão antiga já existir, aborta: comparar schema antes de adaptar.
-- Payload AES-256-GCM; não guardar telefone/texto em claro.
BEGIN;
CREATE TABLE public.whatsapp_reply_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 inbound_external_id text NOT NULL,
 telefone_hash text NOT NULL CHECK(telefone_hash ~ '^[a-f0-9]{32}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 65536),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN
 ('pending','sending','accepted','delivered','read','rejected','ambiguous','expired','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 claim_token uuid,lease_until timestamptz,provider_message_id text UNIQUE,
 window_expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,inbound_external_id)
);
ALTER TABLE public.whatsapp_reply_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reply_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_reply_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.whatsapp_reply_outbox TO service_role;
CREATE POLICY reply_service ON public.whatsapp_reply_outbox TO service_role USING(true) WITH CHECK(true);
CREATE INDEX reply_pending_idx ON public.whatsapp_reply_outbox(state,created_at);
CREATE FUNCTION public.wa_reply_enqueue(p_user uuid,p_external text,p_phone_hash text,p_cipher text,p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
 IF p_expires<=now() OR p_expires>now()+interval '24 hours' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.user_id=p_user AND m.external_id=p_external
 AND left(encode(sha256(convert_to(regexp_replace(m.telefone,'\D','','g'),'UTF8')),'hex'),32)=p_phone_hash)
 THEN RETURN NULL; END IF;
 INSERT INTO public.whatsapp_reply_outbox(user_id,inbound_external_id,telefone_hash,payload_ciphertext,window_expires_at)
 VALUES(p_user,p_external,p_phone_hash,p_cipher,p_expires)
 ON CONFLICT(user_id,inbound_external_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.whatsapp_reply_outbox
 WHERE user_id=p_user AND inbound_external_id=p_external AND telefone_hash=p_phone_hash; END IF;
 RETURN v_id;
END $$;
CREATE FUNCTION public.wa_reply_claim(p_id uuid,p_user uuid,p_phone text)
RETURNS SETOF public.whatsapp_reply_outbox LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.whatsapp_reply_outbox%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.whatsapp_reply_outbox WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF r.state='sending' AND r.lease_until<=now() THEN
 UPDATE public.whatsapp_reply_outbox SET state='ambiguous',updated_at=now() WHERE id=r.id; RETURN; END IF;
 IF r.state<>'pending' OR r.attempts>=3 THEN RETURN; END IF;
 IF r.window_expires_at<=now() THEN
 UPDATE public.whatsapp_reply_outbox SET state='expired',updated_at=now() WHERE id=r.id; RETURN; END IF;
 IF r.telefone_hash<>left(encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex'),32)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user
 AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')
 AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL)
 OR NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) THEN
 UPDATE public.whatsapp_reply_outbox SET state='cancelled',updated_at=now() WHERE id=r.id; RETURN; END IF;
 RETURN QUERY UPDATE public.whatsapp_reply_outbox SET state='sending',attempts=attempts+1,
 claim_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now()
 WHERE id=r.id RETURNING *;
END $$;
CREATE FUNCTION public.wa_reply_finish(p_id uuid,p_token uuid,p_state text,p_provider text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_state NOT IN ('accepted','ambiguous','rejected','cancelled') THEN RETURN false; END IF;
 IF p_state='accepted' AND nullif(p_provider,'') IS NULL THEN p_state:='ambiguous'; END IF;
 UPDATE public.whatsapp_reply_outbox SET state=p_state,provider_message_id=nullif(p_provider,''),
 lease_until=NULL,updated_at=now() WHERE id=p_id AND claim_token=p_token AND state='sending';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.wa_reply_reconcile(p_id uuid,p_provider text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.whatsapp_reply_outbox%ROWTYPE; next_state text;
BEGIN
 IF p_status NOT IN ('sent','delivered','read','failed') OR nullif(p_provider,'') IS NULL THEN RETURN false; END IF;
 SELECT * INTO r FROM public.whatsapp_reply_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.attempts=0 OR r.state IN ('pending','cancelled','expired') THEN RETURN false; END IF;
 IF r.provider_message_id IS NOT NULL AND r.provider_message_id<>p_provider THEN RETURN false; END IF;
 next_state:=CASE p_status WHEN 'sent' THEN 'accepted' WHEN 'failed' THEN 'rejected' ELSE p_status END;
 IF r.state='read' OR (r.state='delivered' AND next_state<>'read') THEN next_state:=r.state; END IF;
 UPDATE public.whatsapp_reply_outbox SET state=next_state,provider_message_id=p_provider,
 lease_until=NULL,updated_at=now() WHERE id=r.id;
 RETURN true;
END $$;
-- Recuperação manual só de rejeição sem aceite. Nunca reenvia ambiguous/accepted.
CREATE FUNCTION public.wa_reply_retry_rejected(p_id uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.whatsapp_reply_outbox SET state='pending',claim_token=NULL,lease_until=NULL,updated_at=now()
 WHERE id=p_id AND user_id=p_user AND state='rejected' AND provider_message_id IS NULL
 AND attempts<3 AND window_expires_at>now() AND updated_at<now()-interval '5 minutes';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.wa_reply_enqueue(uuid,text,text,text,timestamptz),
public.wa_reply_claim(uuid,uuid,text),public.wa_reply_finish(uuid,uuid,text,text),
public.wa_reply_reconcile(uuid,text,text),public.wa_reply_retry_rejected(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reply_enqueue(uuid,text,text,text,timestamptz),
public.wa_reply_claim(uuid,uuid,text),public.wa_reply_finish(uuid,uuid,text,text),
public.wa_reply_reconcile(uuid,text,text),public.wa_reply_retry_rejected(uuid,uuid) TO service_role;
-- Immutable operational transitions: no phone, reply text, ciphertext or token.
CREATE TABLE public.whatsapp_reply_outbox_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reply_id uuid NOT NULL REFERENCES public.whatsapp_reply_outbox(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL,state text NOT NULL,attempts integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_reply_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reply_outbox_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_reply_outbox_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.whatsapp_reply_outbox_events TO service_role;
GRANT USAGE ON SEQUENCE public.whatsapp_reply_outbox_events_id_seq TO service_role;
CREATE POLICY reply_events_service ON public.whatsapp_reply_outbox_events TO service_role USING(true) WITH CHECK(true);
CREATE FUNCTION public.wa_reply_audit_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.attempts IS DISTINCT FROM OLD.attempts THEN
  INSERT INTO public.whatsapp_reply_outbox_events(reply_id,user_id,state,attempts) VALUES (NEW.id,NEW.user_id,NEW.state,NEW.attempts);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wa_reply_audit_transition() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reply_audit_transition() TO service_role;
CREATE TRIGGER wa_reply_audit AFTER INSERT OR UPDATE ON public.whatsapp_reply_outbox
FOR EACH ROW EXECUTE FUNCTION public.wa_reply_audit_transition();
-- Maintenance is owner-scoped and never sends or recreates financial effects.
CREATE FUNCTION public.wa_reply_quarantine_expired(p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 UPDATE public.whatsapp_reply_outbox SET state='ambiguous',lease_until=NULL,updated_at=now()
 WHERE user_id=p_user AND state='sending' AND lease_until<=now();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.wa_reply_quarantine_expired(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reply_quarantine_expired(uuid) TO service_role;
COMMIT;
-- Rollback: desligar WHATSAPP_REPLY_OUTBOX_ENABLED e preservar histórico/callbacks.
-- Nunca descartar a tabela nem recolocar estados ambíguos na fila automaticamente.
