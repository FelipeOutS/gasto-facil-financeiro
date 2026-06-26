-- WA-M1: memória de categoria por estabelecimento, isolada por usuário.
-- Gravada APENAS server-side após gasto confirmado com sucesso. Cliente
-- não pode ler/escrever diretamente nesta fase.
CREATE TABLE public.whatsapp_merchant_category_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_key text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  confirmed_count integer NOT NULL DEFAULT 0,
  manual_confirmed_count integer NOT NULL DEFAULT 0,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_merchant_category_memories_unique
    UNIQUE (user_id, merchant_key, category_id),
  CONSTRAINT whatsapp_merchant_category_memories_key_len
    CHECK (char_length(merchant_key) BETWEEN 1 AND 200)
);

CREATE INDEX whatsapp_merchant_category_memories_user_key_idx
  ON public.whatsapp_merchant_category_memories (user_id, merchant_key);

-- Grants: service_role escreve via supabaseAdmin; authenticated pode SELECT
-- apenas registros próprios (recurso ainda não exposto na UI, mas seguro).
GRANT SELECT ON public.whatsapp_merchant_category_memories TO authenticated;
GRANT ALL ON public.whatsapp_merchant_category_memories TO service_role;

ALTER TABLE public.whatsapp_merchant_category_memories ENABLE ROW LEVEL SECURITY;

-- Usuário só vê o que é dele. Sem INSERT/UPDATE/DELETE para authenticated:
-- as gravações ocorrem apenas pelo fluxo server-side (service_role).
CREATE POLICY "users can read own merchant memories"
  ON public.whatsapp_merchant_category_memories
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger updated_at
CREATE TRIGGER whatsapp_merchant_category_memories_set_updated_at
  BEFORE UPDATE ON public.whatsapp_merchant_category_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();