
-- =====================================================================
-- Helpers de permissão por conta conectada
-- =====================================================================

CREATE OR REPLACE FUNCTION public.account_access_level(_owner uuid)
RETURNS public.connected_account_access
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT access_level
  FROM public.connected_accounts
  WHERE owner_user_id = _owner
    AND viewer_user_id = auth.uid()
    AND status = 'accepted'
  ORDER BY accepted_at DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_view_account(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = _owner
      OR public.account_access_level(_owner) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.can_create_in_account(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = _owner
      OR public.account_access_level(_owner) IN ('view_create','admin')
$$;

CREATE OR REPLACE FUNCTION public.can_admin_account(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = _owner
      OR public.account_access_level(_owner) = 'admin'
$$;

-- =====================================================================
-- Aplica as 4 políticas (select/insert/update/delete) por conta conectada
-- nas tabelas de dados financeiros. Mantemos a política existente de dono
-- e adicionamos as de conta conectada SEM removê-las.
-- =====================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'gastos','receitas','cartoes','bancos','categorias',
    'contas_a_pagar','contas_a_receber','dinheiro_guardado',
    'metas_financeiras','movimentacoes_meta','faturas_cartao',
    'recorrencias','transferencias_internas','limites',
    'aprendizado_categoria','user_alerts',
    'investimentos_ativos','investimentos_movimentacoes',
    'investimentos_rendimentos','investimentos_atualizacoes',
    'investimentos_importacoes','extratos_importados',
    'whatsapp_links','whatsapp_messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'connected_select_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'connected_insert_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'connected_update_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'connected_delete_'||t, t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_account(user_id))',
      'connected_select_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_create_in_account(user_id))',
      'connected_insert_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_admin_account(user_id)) WITH CHECK (public.can_admin_account(user_id))',
      'connected_update_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_account(user_id))',
      'connected_delete_'||t, t
    );
  END LOOP;
END $$;
