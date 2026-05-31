CREATE TABLE public.community_market_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_name text NOT NULL,
  normalized_product_name text NULL,
  category text NULL,
  price numeric NOT NULL CHECK (price >= 0),
  unit text NULL,
  market_name text NOT NULL,
  market_id uuid NULL,
  source text NOT NULL DEFAULT 'flyer' CHECK (source IN ('flyer','store','receipt','manual')),
  seen_at date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date NULL,
  city text NULL,
  neighborhood text NULL,
  notes text NULL,
  confidence numeric NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','reported','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cmp_user ON public.community_market_prices(user_id);
CREATE INDEX idx_cmp_status_seen ON public.community_market_prices(status, seen_at DESC);
CREATE INDEX idx_cmp_market ON public.community_market_prices(market_name);
CREATE INDEX idx_cmp_normalized ON public.community_market_prices(normalized_product_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_market_prices TO authenticated;
GRANT ALL ON public.community_market_prices TO service_role;

ALTER TABLE public.community_market_prices ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado vê preços ativos; dono e admin veem tudo seu.
CREATE POLICY "cmp_select_active_or_own"
ON public.community_market_prices
FOR SELECT
TO authenticated
USING (
  status = 'active'
  OR user_id = auth.uid()
  OR public.is_full_access(auth.uid())
);

-- Inserção: somente para si mesmo.
CREATE POLICY "cmp_insert_own"
ON public.community_market_prices
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Update: dono ou admin.
CREATE POLICY "cmp_update_own_or_admin"
ON public.community_market_prices
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.is_full_access(auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_full_access(auth.uid()));

-- Delete: dono ou admin.
CREATE POLICY "cmp_delete_own_or_admin"
ON public.community_market_prices
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.is_full_access(auth.uid()));

CREATE TRIGGER trg_cmp_updated_at
BEFORE UPDATE ON public.community_market_prices
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();