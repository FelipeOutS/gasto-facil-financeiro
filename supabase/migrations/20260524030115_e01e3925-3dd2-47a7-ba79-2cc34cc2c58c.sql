ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS offline_client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS receitas_user_offline_client_id_uniq
  ON public.receitas (user_id, offline_client_id)
  WHERE offline_client_id IS NOT NULL;