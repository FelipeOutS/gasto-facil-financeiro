update public.gastos set bem_id = null where bem_id in (select id from public.bens where nome like '%Teste E2E');
update public.recorrencias set bem_id = null where bem_id in (select id from public.bens where nome like '%Teste E2E');
delete from public.bens_pagamentos where bem_id in (select id from public.bens where nome like '%Teste E2E');
delete from public.bens_amortizacoes where bem_id in (select id from public.bens where nome like '%Teste E2E');
delete from public.bens_custos_aquisicao where bem_id in (select id from public.bens where nome like '%Teste E2E');
delete from public.bens_financiamentos where bem_id in (select id from public.bens where nome like '%Teste E2E');
delete from public.bens where nome like '%Teste E2E';