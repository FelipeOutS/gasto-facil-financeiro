UPDATE public.user_plans
SET plano='sem_assinatura', status='sem_assinatura', updated_at=now()
WHERE user_id='44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4';

DELETE FROM public.metas_financeiras
WHERE user_id='44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4' AND nome LIKE 'QA Meta%';