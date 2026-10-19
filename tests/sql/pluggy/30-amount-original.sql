-- Valida a migração candidata amount_original sobre a Revisão 4 já aplicada.
DO $$
DECLARE n_before int; n_after int; v numeric;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.pluggy_items(user_id,item_id,connector_id,connector_name,is_sandbox,status)
    VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','amt-item',2,'Pluggy Bank',true,'UPDATED') ON CONFLICT DO NOTHING;
  INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,name,balance,is_sandbox)
    VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','amt-item','amt-acc','CREDIT','Cartão',0,true) ON CONFLICT DO NOTHING;
  RESET ROLE;
END $$;
