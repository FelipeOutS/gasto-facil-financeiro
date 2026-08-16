-- Adiciona suporte a metadados de importação na tabela de financiamentos
ALTER TABLE public.bens_financiamentos 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Tabela para rastrear imports de documentos de financiamento
CREATE TABLE public.bens_documentos_processados (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    bem_id uuid NOT NULL,
    financiamento_id uuid,
    tipo_documento text,
    nome_arquivo text,
    tamanho_arquivo integer,
    data_importacao timestamptz DEFAULT now(),
    dados_extraidos jsonb NOT NULL,
    alteracoes_confirmadas jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'pendente',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT bens_doc_bem_fk FOREIGN KEY (user_id, bem_id) REFERENCES public.bens(user_id, id) ON DELETE CASCADE,
    CONSTRAINT bens_doc_fin_fk FOREIGN KEY (user_id, financiamento_id) REFERENCES public.bens_financiamentos(user_id, id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_documentos_processados TO authenticated;
GRANT ALL ON public.bens_documentos_processados TO service_role;

ALTER TABLE public.bens_documentos_processados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own financing documents"
ON public.bens_documentos_processados
FOR ALL
TO authenticated
USING (auth.uid() = user_id);

COMMENT ON TABLE public.bens_documentos_processados IS 'Rastreia o histórico de documentos processados para atualização de bens/financiamentos.';
