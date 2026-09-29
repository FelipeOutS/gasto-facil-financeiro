-- Fase 1: impedir novos PINs legados sem apagar linhas antigas.
-- SELECT e as RPCs de tentativa/remoção continuam para compatibilidade.
-- A rotação da senha mestra usa SECURITY DEFINER e continua removendo a linha.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.vault_pin_set(text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vault_pin_settings
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS vault_pin_insert_own ON public.vault_pin_settings;
DROP POLICY IF EXISTS vault_pin_update_own ON public.vault_pin_settings;
DROP POLICY IF EXISTS vault_pin_delete_own ON public.vault_pin_settings;

COMMIT;

-- Reversão manual, somente se a fase 1 precisar ser desfeita:
-- GRANT EXECUTE ON FUNCTION public.vault_pin_set(text, integer, text, text) TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON TABLE public.vault_pin_settings TO authenticated;
-- CREATE POLICY vault_pin_insert_own ON public.vault_pin_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY vault_pin_update_own ON public.vault_pin_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY vault_pin_delete_own ON public.vault_pin_settings FOR DELETE USING (auth.uid() = user_id);
