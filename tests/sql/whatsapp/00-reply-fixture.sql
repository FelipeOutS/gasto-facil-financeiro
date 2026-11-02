CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE whatsapp_messages(user_id uuid,external_id text,telefone text);
CREATE TABLE whatsapp_links(user_id uuid,telefone text,ativo boolean,opt_in_em timestamptz,revogado_em timestamptz);
CREATE TABLE fixture_entitlements(user_id uuid PRIMARY KEY,allowed boolean);
CREATE FUNCTION has_feature_access(u uuid,f text) RETURNS boolean LANGUAGE sql AS
$$ SELECT coalesce((SELECT allowed FROM fixture_entitlements WHERE user_id=u),false) $$;
INSERT INTO fixture_entitlements VALUES ('11111111-1111-4111-8111-111111111111',true);
INSERT INTO whatsapp_links VALUES ('11111111-1111-4111-8111-111111111111','5511900000000',true,now(),NULL);
INSERT INTO whatsapp_messages VALUES ('11111111-1111-4111-8111-111111111111','fixture-message','5511900000000');
GRANT SELECT ON whatsapp_messages,whatsapp_links,fixture_entitlements TO service_role;
