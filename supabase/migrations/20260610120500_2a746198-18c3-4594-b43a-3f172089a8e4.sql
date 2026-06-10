-- 1) Public read policy on avatars storage bucket (bucket is already public)
DROP POLICY IF EXISTS "Public read access to avatars" ON storage.objects;
CREATE POLICY "Public read access to avatars"
ON storage.objects
FOR SELECT
USING (bucket_id = 'avatars');

-- 2) Allow profile owners to delete their own profile row
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
ON public.profiles
FOR DELETE
TO authenticated
USING (auth.uid() = id);