-- Tabela para salvar cenários de simulação do usuário
CREATE TABLE public.bens_simulacoes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    bem_id uuid REFERENCES public.bens(id) ON DELETE CASCADE NOT NULL,
    financiamento_id uuid REFERENCES public.bens_financiamentos(id) ON DELETE CASCADE NOT NULL,
    nome text NOT NULL,
    valor_amortizacao_extra numeric(15,2) DEFAULT 0,
    tipo_reducao text CHECK (tipo_reducao IN ('prazo', 'parcela')),
    origem_recurso text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_simulacoes TO authenticated;
GRANT ALL ON public.bens_simulacoes TO service_role;

ALTER TABLE public.bens_simulacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários podem gerenciar suas próprias simulações"
ON public.bens_simulacoes
FOR ALL
TO authenticated
USING (auth.uid() = user_id);
