-- Tabela de lotes de importação de extratos bancários
CREATE TABLE public.extratos_importados (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome_arquivo TEXT,
  banco TEXT,
  tipo_origem TEXT NOT NULL DEFAULT 'pdf', -- pdf | csv | imagem
  data_importacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  periodo_inicio DATE,
  periodo_fim DATE,
  qtd_movimentacoes INTEGER NOT NULL DEFAULT 0,
  qtd_duplicadas_ignoradas INTEGER NOT NULL DEFAULT 0,
  total_receitas NUMERIC NOT NULL DEFAULT 0,
  total_despesas NUMERIC NOT NULL DEFAULT 0,
  total_guardado NUMERIC NOT NULL DEFAULT 0,
  total_transferencias NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'importado', -- importado | parcial | revertido | erro
  observacao TEXT,
  reverted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.extratos_importados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extratos_importados_select_own" ON public.extratos_importados
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "extratos_importados_insert_own" ON public.extratos_importados
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "extratos_importados_update_own" ON public.extratos_importados
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "extratos_importados_delete_own" ON public.extratos_importados
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at_extratos_importados
  BEFORE UPDATE ON public.extratos_importados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Adiciona import_batch_id às tabelas que recebem itens importados
ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS id_operacao_banco TEXT;

ALTER TABLE public.receitas
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS id_operacao_banco TEXT;

ALTER TABLE public.transferencias_internas
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS id_operacao_banco TEXT;

ALTER TABLE public.dinheiro_guardado
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE public.movimentacoes_meta
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_gastos_import_batch ON public.gastos(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receitas_import_batch ON public.receitas(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transf_import_batch ON public.transferencias_internas(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guardado_import_batch ON public.dinheiro_guardado(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_meta_import_batch ON public.movimentacoes_meta(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extratos_user ON public.extratos_importados(user_id, data_importacao DESC);