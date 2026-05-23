
-- Webhook logs
CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text,
  external_id text,
  user_id uuid,
  related_email text,
  status text NOT NULL,
  http_status integer,
  request_headers jsonb,
  request_body jsonb,
  response_body jsonb,
  error_message text,
  processing_time_ms integer,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_logs_provider ON public.webhook_logs(provider);
CREATE INDEX idx_webhook_logs_event_type ON public.webhook_logs(event_type);
CREATE INDEX idx_webhook_logs_external_id ON public.webhook_logs(external_id);
CREATE INDEX idx_webhook_logs_user_id ON public.webhook_logs(user_id);
CREATE INDEX idx_webhook_logs_status ON public.webhook_logs(status);
CREATE INDEX idx_webhook_logs_created_at ON public.webhook_logs(created_at DESC);
CREATE INDEX idx_webhook_logs_idempotency_key ON public.webhook_logs(idempotency_key);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_logs_admin_select"
  ON public.webhook_logs FOR SELECT
  USING (
    public.is_full_access(auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies → only service_role (which bypasses RLS) can write.

-- Audit logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text NOT NULL,
  target_user_id uuid,
  target_email text,
  entity_type text,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor_user_id ON public.audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_target_user_id ON public.audit_logs(target_user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON public.audit_logs(entity_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_admin_select"
  ON public.audit_logs FOR SELECT
  USING (
    public.is_full_access(auth.uid())
  );
