CREATE TABLE public.whatsapp_csp_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now() NOT NULL,
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

-- RLS e Permissões
ALTER TABLE public.whatsapp_csp_reports ENABLE ROW LEVEL SECURITY;

-- Zero policy para anon e authenticated (acesso somente via service_role ou owner)
-- Como é para auditoria, não queremos expor dados de violação.

GRANT INSERT ON public.whatsapp_csp_reports TO authenticated, service_role;
GRANT SELECT ON public.whatsapp_csp_reports TO service_role;

-- Função para limpeza automática (retenção 7 dias)
CREATE OR REPLACE FUNCTION public.whatsapp_cleanup_csp_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.whatsapp_csp_reports
    WHERE created_at < now() - interval '7 days';
END;
$$;
