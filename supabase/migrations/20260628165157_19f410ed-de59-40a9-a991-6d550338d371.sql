
-- WA-R1-Fix: criação atômica de receita recorrente (1 receita hoje + 1 recorrência ativa)
-- Substitui o padrão antigo de pré-projetar 12 receitas como já recebidas.
CREATE OR REPLACE FUNCTION public.create_recurring_income(
  p_user_id uuid,
  p_descricao text,
  p_valor numeric,
  p_data date,
  p_tipo text,
  p_frequencia text,
  p_dia_mes integer DEFAULT NULL,
  p_dia_semana integer DEFAULT NULL,
  p_observacao text DEFAULT NULL,
  p_origem text DEFAULT 'whatsapp'
)
RETURNS TABLE(receita_id uuid, recorrencia_id uuid, proxima_cobranca date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec_id uuid;
  v_receita_id uuid;
  v_prox date;
  v_freq text := lower(coalesce(p_frequencia, 'mensal'));
  v_today date := p_data;
  v_year int;
  v_month int;
  v_day int;
  v_candidate date;
  v_last_day int;
  v_dow int;
  v_diff int;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatório'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'data obrigatória'; END IF;
  IF v_freq NOT IN ('mensal','semanal','quinzenal') THEN
    RAISE EXCEPTION 'frequencia inválida (mensal|semanal|quinzenal)';
  END IF;

  -- Calcular próxima cobrança estritamente futura
  IF v_freq = 'mensal' THEN
    IF p_dia_mes IS NULL OR p_dia_mes < 1 OR p_dia_mes > 31 THEN
      RAISE EXCEPTION 'dia_mes inválido (1..31)';
    END IF;
    v_year := extract(year from v_today)::int;
    v_month := extract(month from v_today)::int;
    v_last_day := extract(day from (date_trunc('month', make_date(v_year, v_month, 1)) + interval '1 month - 1 day'))::int;
    v_day := least(p_dia_mes, v_last_day);
    v_candidate := make_date(v_year, v_month, v_day);
    IF v_candidate <= v_today THEN
      v_candidate := (date_trunc('month', v_candidate) + interval '1 month')::date;
      v_year := extract(year from v_candidate)::int;
      v_month := extract(month from v_candidate)::int;
      v_last_day := extract(day from (date_trunc('month', make_date(v_year, v_month, 1)) + interval '1 month - 1 day'))::int;
      v_candidate := make_date(v_year, v_month, least(p_dia_mes, v_last_day));
    END IF;
    v_prox := v_candidate;
  ELSIF v_freq = 'semanal' THEN
    IF p_dia_semana IS NULL OR p_dia_semana < 0 OR p_dia_semana > 6 THEN
      RAISE EXCEPTION 'dia_semana inválido (0..6)';
    END IF;
    v_dow := extract(dow from v_today)::int;
    v_diff := ((p_dia_semana - v_dow + 7) % 7);
    IF v_diff = 0 THEN v_diff := 7; END IF;
    v_prox := v_today + v_diff;
  ELSE -- quinzenal
    v_prox := v_today + 15;
  END IF;

  -- 1) Criar a recorrência primeiro (atômico — qualquer falha aborta tudo)
  INSERT INTO public.recorrencias (
    user_id, nome, valor, frequencia, proxima_cobranca,
    status, tipo_recorrencia, origem, observacao
  ) VALUES (
    p_user_id,
    coalesce(nullif(trim(p_descricao), ''), 'Renda'),
    p_valor,
    v_freq,
    v_prox,
    'ativa',
    'recorrencia_fixa',
    coalesce(p_origem, 'whatsapp'),
    p_observacao
  )
  RETURNING id INTO v_rec_id;

  IF v_rec_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar recorrência';
  END IF;

  -- 2) Criar a receita atual referenciando a recorrência recém-criada
  INSERT INTO public.receitas (
    user_id, descricao, valor, data, tipo,
    recorrente, recorrencia_id, mes, ano, origem
  ) VALUES (
    p_user_id,
    coalesce(nullif(trim(p_descricao), ''), 'Renda'),
    p_valor,
    p_data,
    coalesce(p_tipo, 'outros'),
    true,
    v_rec_id,
    extract(month from p_data)::int,
    extract(year from p_data)::int,
    coalesce(p_origem, 'whatsapp')
  )
  RETURNING id INTO v_receita_id;

  IF v_receita_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar receita';
  END IF;

  RETURN QUERY SELECT v_receita_id, v_rec_id, v_prox;
END;
$$;

REVOKE ALL ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) TO service_role;

-- Limpeza segura: remover as 12 receitas sintéticas do smoke test WA-T1 3.7d
-- Critérios estritos: IDs específicos + user_id do Admin Master + recorrencia_id fantasma + origem whatsapp.
DELETE FROM public.receitas
WHERE id = ANY (ARRAY[
  '66774352-6d8c-4e80-a1da-7cf84f5cc373','083486d8-1ac7-45b2-8b27-bd4f716e19a8',
  '348096bb-f4e0-44bb-a411-04819dcb64f2','7d8acbf7-c587-4ce6-8585-de181a609524',
  '80137491-37a6-446b-b1b5-f0148f63df41','afd8f5da-4bce-4233-bb5e-9740f6f45bc2',
  '42694f06-592b-4013-aaa9-10ca05f8c025','fbc3973f-79ae-40a0-8d08-9133ea3672cf',
  '442ff693-7097-4fcb-b211-88f0b359cf66','712ac98a-e82a-4e27-9897-58ce499827ec',
  'ada8897d-974e-49fd-a1ec-494660b81efe','3cb7c8d7-cd9a-4687-8532-e5291f3d8672'
]::uuid[])
  AND user_id = '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
  AND recorrencia_id = '147db3c8-497e-426c-97d2-8731b76c4d4d'
  AND origem = 'whatsapp'
  AND descricao = 'Salário';
