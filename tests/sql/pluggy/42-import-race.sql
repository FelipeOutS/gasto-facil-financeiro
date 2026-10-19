INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,amount_original,date,status,type,classification,classification_reason,is_sandbox)
VALUES('47df50ce-df1e-4c54-8fae-0ffb5105478d','iM','aM','race-income','race-income','Race income',100,100,'2026-05-05','POSTED','CREDIT','receita','entrada',true);
CREATE TABLE public.test_import_race(plan jsonb);
INSERT INTO public.test_import_race VALUES ('[{"op":"insert","table":"receitas","account_id":"aM","transaction_id":"race-income","row":{"valor":100,"data":"2026-05-05","descricao":"Race income","tipo":"outros","id_operacao_banco":"pluggy:aM:race-income"}}]');
GRANT SELECT ON public.test_import_race TO service_role;