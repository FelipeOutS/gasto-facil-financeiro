-- Create private storage bucket for goal cover images
INSERT INTO storage.buckets (id, name, public)
VALUES ('metas-covers', 'metas-covers', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: each user can manage only files inside a folder named after their user id
CREATE POLICY "metas_covers_select_own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'metas-covers'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "metas_covers_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'metas-covers'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "metas_covers_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'metas-covers'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "metas_covers_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'metas-covers'
  AND auth.uid()::text = (storage.foldername(name))[1]
);