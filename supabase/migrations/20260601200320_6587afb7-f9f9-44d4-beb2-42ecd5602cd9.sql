-- Add optional image and identification fields to community_market_prices
ALTER TABLE public.community_market_prices
  ADD COLUMN IF NOT EXISTS image_url text NULL,
  ADD COLUMN IF NOT EXISTS image_source text NULL,
  ADD COLUMN IF NOT EXISTS image_confidence numeric NULL,
  ADD COLUMN IF NOT EXISTS brand text NULL,
  ADD COLUMN IF NOT EXISTS barcode text NULL;

-- Constrain allowed image sources (nullable allowed)
ALTER TABLE public.community_market_prices
  DROP CONSTRAINT IF EXISTS community_market_prices_image_source_check;

ALTER TABLE public.community_market_prices
  ADD CONSTRAINT community_market_prices_image_source_check
  CHECK (
    image_source IS NULL
    OR image_source = ANY (ARRAY['open_food_facts'::text, 'joanin'::text, 'manual'::text, 'brand_logo'::text, 'none'::text])
  );

-- Constrain image_url length and require http(s) when present
ALTER TABLE public.community_market_prices
  DROP CONSTRAINT IF EXISTS community_market_prices_image_url_check;

ALTER TABLE public.community_market_prices
  ADD CONSTRAINT community_market_prices_image_url_check
  CHECK (
    image_url IS NULL
    OR (length(image_url) <= 2048 AND image_url ~ '^https?://')
  );

-- Constrain barcode length/format softly (digits allowed up to 32)
ALTER TABLE public.community_market_prices
  DROP CONSTRAINT IF EXISTS community_market_prices_barcode_check;

ALTER TABLE public.community_market_prices
  ADD CONSTRAINT community_market_prices_barcode_check
  CHECK (
    barcode IS NULL OR (length(barcode) <= 32 AND barcode ~ '^[0-9A-Za-z._-]+$')
  );

-- Helpful index for barcode lookups when reusing images across lists/carts
CREATE INDEX IF NOT EXISTS idx_cmp_barcode ON public.community_market_prices (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cmp_brand ON public.community_market_prices (brand) WHERE brand IS NOT NULL;