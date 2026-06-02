
-- 1) Bucket público para imagens de produto editáveis pelo Admin Master
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mercado-product-images',
  'mercado-product-images',
  true,
  3145728, -- 3 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) Policies em storage.objects restritas a este bucket
DROP POLICY IF EXISTS "mercado_product_images_public_read" ON storage.objects;
CREATE POLICY "mercado_product_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'mercado-product-images');

DROP POLICY IF EXISTS "mercado_product_images_admin_insert" ON storage.objects;
CREATE POLICY "mercado_product_images_admin_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'mercado-product-images'
  AND public.is_full_access(auth.uid())
);

DROP POLICY IF EXISTS "mercado_product_images_admin_update" ON storage.objects;
CREATE POLICY "mercado_product_images_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'mercado-product-images'
  AND public.is_full_access(auth.uid())
)
WITH CHECK (
  bucket_id = 'mercado-product-images'
  AND public.is_full_access(auth.uid())
);

DROP POLICY IF EXISTS "mercado_product_images_admin_delete" ON storage.objects;
CREATE POLICY "mercado_product_images_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'mercado-product-images'
  AND public.is_full_access(auth.uid())
);

-- 3) Permitir 'admin_upload' como image_source válido em community_market_prices
ALTER TABLE public.community_market_prices
  DROP CONSTRAINT IF EXISTS community_market_prices_image_source_check;

ALTER TABLE public.community_market_prices
  ADD CONSTRAINT community_market_prices_image_source_check
  CHECK (
    image_source IS NULL
    OR image_source = ANY (ARRAY[
      'open_food_facts'::text,
      'joanin'::text,
      'manual'::text,
      'brand_logo'::text,
      'none'::text,
      'admin_upload'::text
    ])
  );
