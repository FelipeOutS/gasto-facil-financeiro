CREATE TABLE IF NOT EXISTS public.client_load_errors (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    error_type text not null,
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
    recovery_attempted boolean,
    user_agent text,
    anonymous_id text
);

GRANT INSERT ON public.client_load_errors TO anon, authenticated;
GRANT SELECT ON public.client_load_errors TO service_role;

ALTER TABLE public.client_load_errors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert errors') THEN
        CREATE POLICY "Anyone can insert errors" ON public.client_load_errors FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can view errors') THEN
        CREATE POLICY "Admins can view errors" ON public.client_load_errors FOR SELECT TO service_role USING (true);
    END IF;
END
$$;
