-- Preserva todas as tabelas já publicadas; pode ser executada novamente.
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['gastos', 'receitas'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = target
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
    END IF;
  END LOOP;
END;
$$;
