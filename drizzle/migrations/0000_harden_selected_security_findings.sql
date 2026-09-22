-- 1) Pin search_path on SECURITY DEFINER function
ALTER FUNCTION public.whatsapp_cleanup_csp_reports() SET search_path = 'public', 'pg_temp';

-- 2) Remove "any authenticated user reads everything" policies on tables
--    only read server-side with the service role (which bypasses RLS).
DROP POLICY IF EXISTS "Templates readable by authenticated" ON public.whatsapp_notification_templates;
DROP POLICY IF EXISTS "brand_assets_select_authenticated" ON public.brand_assets;
DROP POLICY IF EXISTS "Indicadores econômicos são visíveis a usuários autenticados" ON public.economic_indicators;

REVOKE SELECT ON public.whatsapp_notification_templates FROM authenticated, anon;
REVOKE SELECT ON public.brand_assets FROM authenticated, anon;
REVOKE SELECT ON public.economic_indicators FROM authenticated, anon;

GRANT ALL ON public.whatsapp_notification_templates TO service_role;
GRANT ALL ON public.brand_assets TO service_role;
GRANT ALL ON public.economic_indicators TO service_role;

-- 3) Storage: stop unbounded listing/reads through the Data API.
--    Both buckets remain public buckets, so public URLs keep working.
DROP POLICY IF EXISTS "Public read access to avatars" ON storage.objects;
DROP POLICY IF EXISTS "mercado_product_images_public_read" ON storage.objects;

CREATE POLICY "avatars_select_own"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'avatars' AND owner_id = (select auth.uid()::text));

CREATE POLICY "mercado_product_images_select_own"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'mercado-product-images' AND owner_id = (select auth.uid()::text));