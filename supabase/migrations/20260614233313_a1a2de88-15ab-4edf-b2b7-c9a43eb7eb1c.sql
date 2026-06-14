REVOKE ALL PRIVILEGES ON TABLE public.user_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, user_id, provider, provider_user_id, expires_at, status, last_sync_at, last_error, scope, created_at, updated_at) ON TABLE public.user_integrations TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.user_integrations TO service_role;

REVOKE SELECT ON TABLE public.community_market_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, product_name, normalized_product_name, category, price, unit, market_name, market_id, source, seen_at, valid_until, city, neighborhood, notes, confidence, status, created_at, updated_at, image_url, image_source, image_confidence, brand, barcode) ON TABLE public.community_market_prices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.community_market_prices TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.community_market_prices TO service_role;