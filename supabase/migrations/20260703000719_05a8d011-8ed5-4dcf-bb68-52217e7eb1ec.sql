-- WA-PIX-3.26 — Rollback do favorecido espúrio "Marcos" criado pelo bug de
-- validação de chave Pix. Guardas estritos: só remove o registro exato
-- (id + user_id + nome + chave inválida + tipo desconhecida). João Silva
-- e demais favorecidos válidos permanecem intactos.
DELETE FROM public.fornecedores
 WHERE id = '99479fce-911c-4f63-9fa1-ad4d2c1338ba'
   AND user_id = '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
   AND nome = 'Marcos'
   AND pix_key = '12345'
   AND pix_key_type = 'desconhecida';