CREATE ROLE postgres;
CREATE ROLE supabase_admin;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
GRANT USAGE,CREATE ON SCHEMA public TO postgres,supabase_admin;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT,TRUNCATE ON TABLES TO anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT SELECT,TRUNCATE ON TABLES TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE ON TABLES TO anon,authenticated;
SET ROLE postgres;
DO $$ BEGIN
 FOR i IN 1..84 LOOP
  EXECUTE format('CREATE TABLE public.fixture_%s (id integer PRIMARY KEY, value integer NOT NULL)',i);
  EXECUTE format('INSERT INTO public.fixture_%s VALUES (1,10)',i);
 END LOOP;
END $$;
RESET ROLE;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- RLS itself must not be confused with TRUNCATE protection.
ALTER TABLE fixture_1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_owner ON fixture_1 FOR ALL TO authenticated USING(true) WITH CHECK(true);
