REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;