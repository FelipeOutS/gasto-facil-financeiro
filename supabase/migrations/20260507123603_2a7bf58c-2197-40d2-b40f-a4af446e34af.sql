-- Corrigir mês de referência (invoice_month) dos gastos listados pelo usuário.
-- Tudo vai para Abril/2026, exceto "Padaria perto da vila prudente" que deve ficar como Maio/2026.

-- 1) Para os gastos listados, marcar invoice_month = '2026-04'
UPDATE public.gastos
SET invoice_month = '2026-04', updated_at = now()
WHERE ano = 2026
  AND (
    descricao ILIKE 'Claro%' OR descricao ILIKE 'Video game%Michael%' OR
    descricao ILIKE 'Conta de água%' OR descricao ILIKE 'Aguá%' OR descricao ILIKE 'Água%' OR
    descricao ILIKE 'Aluguel%' OR descricao ILIKE 'Conta de Luz%' OR descricao ILIKE 'Energia%' OR
    descricao ILIKE 'Spotify%' OR descricao ILIKE 'OXXO%' OR descricao ILIKE 'PIURETA BOA ESPERANCA%' OR
    descricao ILIKE 'BOBS CENTRAL PLAZA%' OR descricao ILIKE 'H NUNES LANCHONETE%' OR
    descricao ILIKE 'TotalPass%' OR descricao ILIKE 'MERCEARIA 2 EM 1%' OR
    descricao ILIKE 'Meli+%' OR descricao ILIKE 'COURSERA.ORG%' OR descricao ILIKE 'COURERSA.ORG%' OR
    descricao ILIKE 'COBASI%' OR descricao ILIKE 'sacolaocostabarro%' OR
    descricao ILIKE 'JM EMPREENDIMENTOS%' OR descricao ILIKE 'MOOCA SHOPPING%' OR
    descricao ILIKE 'RAIA2975%' OR descricao ILIKE 'HOSP VET SAO PEDRO%' OR
    descricao ILIKE 'OpenAI ChatGPT%' OR descricao ILIKE 'CantinhoDaFeh%' OR
    descricao ILIKE 'COMERCIO DE VARIEDADES%' OR descricao ILIKE 'DROGARIA SAO PAULO%' OR
    descricao ILIKE '37336437 ANTONIO OREST%' OR descricao ILIKE 'KEETABR%LUCAS DOS PASSOS%' OR
    descricao ILIKE 'Apple%' OR descricao ILIKE 'MP*MELIMAIS%' OR
    descricao ILIKE 'JIKALBK LANCHES%' OR descricao ILIKE 'Bacio di Latte%' OR
    descricao ILIKE 'BAR E RESTAURANTE SO Z%' OR descricao ILIKE 'KZEMOS BRASIL EVENTOS%' OR
    descricao ILIKE 'GIULIANA MARKET%' OR descricao ILIKE 'OPTICA UNIVERSE%'
  )
  AND (invoice_month IS NULL OR invoice_month <> '2026-04');

-- 2) Garantir que "Padaria perto da vila prudente" fique como Maio/2026
UPDATE public.gastos
SET invoice_month = '2026-05', updated_at = now()
WHERE ano = 2026
  AND (descricao ILIKE '%padaria%vila%prudente%' OR estabelecimento ILIKE '%padaria%vila%prudente%');