-- Migration: Provisionamento automático free_ads
-- 1. Trigger de criação automática de plano no cadastro (profiles)
CREATE OR REPLACE FUNCTION public.handle_new_user_provisioning()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_plans (user_id, plano, status, current_period_start)
    VALUES (NEW.id, 'free_ads', 'ativo', now())
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_new_user_provisioning ON public.profiles;
CREATE TRIGGER tr_new_user_provisioning
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_provisioning();

-- 2. Backfill idempotente para usuários sem plano ou em planos legados
INSERT INTO public.user_plans (user_id, plano, status, current_period_start)
SELECT id, 'free_ads', 'ativo', now()
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_plans)
ON CONFLICT (user_id) DO NOTHING;

-- Usuários em planos legados (free/sem_assinatura)
UPDATE public.user_plans
SET plano = 'free_ads',
    status = 'ativo',
    current_period_start = COALESCE(current_period_start, now()),
    updated_at = now()
WHERE plano IN ('free', 'sem_assinatura');
