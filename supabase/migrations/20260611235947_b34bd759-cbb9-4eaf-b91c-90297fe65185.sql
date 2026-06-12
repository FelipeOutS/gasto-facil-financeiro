-- Fase 1E-B2J-B — Cartões básicos para free_ads.
-- Migra policies de INSERT/UPDATE/DELETE em public.cartoes de
-- has_feature_access(..., 'cartoes') -> 'cartoes_basico'.
-- O cap de 1 cartão para free_ads continua sendo enforçado pelo trigger
-- tg_free_ads_quota_cartoes. faturas_cartao permanece intocada (continua
-- exigindo a feature paga 'cartoes').

-- Ownership policies
DROP POLICY IF EXISTS cartoes_insert_own ON public.cartoes;
CREATE POLICY cartoes_insert_own ON public.cartoes
  FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id) AND public.has_feature_access(auth.uid(), 'cartoes_basico'));

DROP POLICY IF EXISTS cartoes_update_own ON public.cartoes;
CREATE POLICY cartoes_update_own ON public.cartoes
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) AND public.has_feature_access(auth.uid(), 'cartoes_basico'))
  WITH CHECK ((auth.uid() = user_id) AND public.has_feature_access(auth.uid(), 'cartoes_basico'));

DROP POLICY IF EXISTS cartoes_delete_own ON public.cartoes;
CREATE POLICY cartoes_delete_own ON public.cartoes
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) AND public.has_feature_access(auth.uid(), 'cartoes_basico'));

-- Connected-accounts policies (mesma feature básica)
DROP POLICY IF EXISTS connected_insert_cartoes ON public.cartoes;
CREATE POLICY connected_insert_cartoes ON public.cartoes
  FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'cartoes_basico'));

DROP POLICY IF EXISTS connected_update_cartoes ON public.cartoes;
CREATE POLICY connected_update_cartoes ON public.cartoes
  FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes_basico'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes_basico'));

DROP POLICY IF EXISTS connected_delete_cartoes ON public.cartoes;
CREATE POLICY connected_delete_cartoes ON public.cartoes
  FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes_basico'));