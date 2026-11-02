-- TEST-ONLY: runner uses a fresh local socket database without network.
-- Never included in the deployment candidate or deliverable SQL.
CREATE OR REPLACE FUNCTION public.pluggy_assert_financial_release()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN RETURN; END $$;