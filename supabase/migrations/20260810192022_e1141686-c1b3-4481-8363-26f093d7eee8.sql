CREATE TABLE public.client_load_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  error_type text NOT NULL,
  error_name text,
  error_message text,
  stack_trace text,
  resource_url text,
  current_route text,
  navigator_online boolean,
  js_build_id text,
  html_build_id text,
  server_build_id text,
  deployment_id text,
  sw_state text,
  sw_controller_url text,
  cache_names text,
  recovery_attempted boolean,
  lineno integer,
  colno integer,
  user_agent text,
  anonymous_id text
);

GRANT ALL ON public.client_load_errors TO service_role;
ALTER TABLE public.client_load_errors ENABLE ROW LEVEL SECURITY;

CREATE INDEX client_load_errors_created_at_idx ON public.client_load_errors (created_at DESC);
CREATE INDEX client_load_errors_error_type_idx ON public.client_load_errors (error_type);
CREATE INDEX client_load_errors_builds_idx ON public.client_load_errors (js_build_id, server_build_id);

CREATE TABLE public.csp_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  document_uri text,
  referrer text,
  violated_directive text,
  effective_directive text,
  original_policy text,
  disposition text,
  blocked_uri text,
  line_number integer,
  column_number integer,
  source_file text,
  status_code integer,
  script_sample text,
  user_agent text
);

GRANT ALL ON public.csp_reports TO service_role;
ALTER TABLE public.csp_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX csp_reports_created_at_idx ON public.csp_reports (created_at DESC);
CREATE INDEX csp_reports_effective_directive_idx ON public.csp_reports (effective_directive);