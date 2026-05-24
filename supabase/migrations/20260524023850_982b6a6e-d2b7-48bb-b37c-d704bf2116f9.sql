ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS offline_client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS gastos_user_offline_client_id_uniq
  ON public.gastos (user_id, offline_client_id)
  WHERE offline_client_id IS NOT NULL;