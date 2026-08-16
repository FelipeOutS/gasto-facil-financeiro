DELETE FROM public.gastos WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1' AND origem='extrato_csv';
DELETE FROM public.receitas WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1' AND origem='extrato_csv';
DELETE FROM public.extratos_importados WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1' AND nome_arquivo='extrato.csv';