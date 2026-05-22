
-- brand_assets: global cache of company/domain logos
CREATE TABLE public.brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  company_name text,
  normalized_name text,
  logo_url text,
  primary_color text,
  secondary_color text,
  source text NOT NULL DEFAULT 'logo.dev',
  status text NOT NULL DEFAULT 'found' CHECK (status IN ('found','not_found','manual')),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_assets_domain ON public.brand_assets(domain);
CREATE INDEX idx_brand_assets_normalized_name ON public.brand_assets(normalized_name);

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_assets_select_authenticated"
ON public.brand_assets FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "brand_assets_service_role_all"
ON public.brand_assets FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER brand_assets_set_updated_at
BEFORE UPDATE ON public.brand_assets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- merchant_brand_aliases: maps free-form merchant names to a domain
CREATE TABLE public.merchant_brand_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_name text NOT NULL,
  normalized_merchant_name text NOT NULL,
  domain text NOT NULL,
  confidence numeric,
  source text NOT NULL DEFAULT 'automatic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_aliases_norm ON public.merchant_brand_aliases(normalized_merchant_name);
CREATE INDEX idx_aliases_user ON public.merchant_brand_aliases(user_id);
CREATE UNIQUE INDEX idx_aliases_unique_user_norm
  ON public.merchant_brand_aliases(coalesce(user_id::text,'GLOBAL'), normalized_merchant_name);

ALTER TABLE public.merchant_brand_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aliases_select_own_or_global"
ON public.merchant_brand_aliases FOR SELECT
TO authenticated
USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "aliases_insert_own"
ON public.merchant_brand_aliases FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "aliases_update_own"
ON public.merchant_brand_aliases FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "aliases_delete_own"
ON public.merchant_brand_aliases FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "aliases_service_role_all"
ON public.merchant_brand_aliases FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER aliases_set_updated_at
BEFORE UPDATE ON public.merchant_brand_aliases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
