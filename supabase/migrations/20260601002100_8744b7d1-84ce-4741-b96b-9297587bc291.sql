ALTER TABLE public.community_market_prices
  DROP CONSTRAINT IF EXISTS community_market_prices_source_check;
ALTER TABLE public.community_market_prices
  ADD CONSTRAINT community_market_prices_source_check
  CHECK (source = ANY (ARRAY['flyer'::text, 'store'::text, 'receipt'::text, 'manual'::text, 'online'::text]));