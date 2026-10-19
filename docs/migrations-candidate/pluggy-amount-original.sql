-- CANDIDATA — NÃO APLICADA. Aditiva: guarda o valor da transação exatamente
-- como a Pluggy enviou (com sinal). Não altera, apaga nem recria linhas.
-- Registros antigos ficam com NULL (sinal desconhecido) até a próxima
-- sincronização, que preenche o campo pela mesma chave (user_id, account_id,
-- transaction_id) sem tocar em categoria_manual nem review_status.
ALTER TABLE public.pluggy_transactions
  ADD COLUMN IF NOT EXISTS amount_original numeric;

COMMENT ON COLUMN public.pluggy_transactions.amount_original IS
  'Valor original da Pluggy, com sinal e precisão recebidos. NULL = registro anterior a esta coluna, ainda não ressincronizado.';
COMMENT ON COLUMN public.pluggy_transactions.amount IS
  'Valor absoluto (compatibilidade). O sinal original está em amount_original.';

-- Permissões: a coluna herda os privilégios de tabela já definidos na Revisão 4
-- (authenticated: SELECT filtrado por RLS; service_role: escrita; anon e
-- sandbox_exec: nada). Reforço explícito, sem conceder nada novo:
REVOKE ALL ON public.pluggy_transactions FROM PUBLIC, anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON public.pluggy_transactions FROM sandbox_exec';
  END IF;
END $$;
