CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_messages_user_created_idx
  ON public.ai_chat_messages (user_id, created_at);

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_chat_messages_select_own
  ON public.ai_chat_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY ai_chat_messages_insert_own
  ON public.ai_chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY ai_chat_messages_delete_own
  ON public.ai_chat_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);