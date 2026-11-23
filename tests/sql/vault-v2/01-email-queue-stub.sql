-- Disposable stand-in for existing PGMQ enqueue RPC; no real e-mail/provider.
CREATE TABLE public.test_email_queue(id bigint GENERATED ALWAYS AS IDENTITY, payload jsonb NOT NULL);
CREATE FUNCTION public.enqueue_email(queue_name text,payload jsonb) RETURNS bigint
LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN
 IF current_setting('test.fail_queue',true)='true' THEN RAISE EXCEPTION 'queue_unavailable'; END IF;
 INSERT INTO public.test_email_queue(payload) VALUES(payload) RETURNING id INTO n;
 RETURN n;
END $$;
REVOKE ALL ON public.test_email_queue FROM PUBLIC,anon,authenticated;
