# Diagnóstico de Dados Fictícios — Gasto Inteligente
Data: 2026-07-31 · Modo: SOMENTE LEITURA (nenhum dado alterado)

---

## 1. Resumo executivo

- **12 receitas fictícias CONFIRMADAS**, todas com descrição `5555` e valor **R$ 55.555.555.555,00** cada (55,5 bilhões — o relatório anterior citava R$ 5,5 bi; o valor real é **10× maior**).
- Pertencem a **1 único usuário** (`cafcb221…7050`), conta **real, porém recém-criada e sem uso** (criada 05/05/2026 18:50, último login 05/05/2026 18:50, 0 gastos, 0 cartões, 0 contas, 0 mensagens WhatsApp).
- **Origem CONFIRMADA**: formulário web de receita com opção "recorrente" (12 meses) — `addReceita` em `src/lib/store.ts` (linhas 2546–2581). Todas as 12 linhas têm o mesmo `recorrencia_id` e o mesmo `created_at` (2026-05-05 19:49:35.598794+00), assinatura de um único INSERT em lote.
- **Impacto temporal**: afetam **maio/2026 a abril/2027** (1 linha por mês). **NÃO afetam abril/2026** — abril não tem nenhuma linha `5555` (comprovação numérica na seção 6). A afirmação anterior de contaminação de abril está **incorreta**.
- **Não há problema de fuso horário**: `mes`/`ano` são consistentes com `data` em **0 divergências** nas 124 receitas da base; o dashboard filtra por `r.mes`/`r.ano` (`src/routes/app.tsx:190`).
- **Gastos "Csa" (R$ 4.000,00 × 12): NÃO são teste** — evidência forte de despesa real (aluguel/apartamento) com descrição abreviada. Detalhes na seção 8.
- **Não existe nenhum campo de quarentena** (`is_test`, `deleted_at`, `archived_at`…) nas tabelas financeiras. Qualquer estratégia de marcação exige **migration**.
- Estratégia recomendada: **B — soft delete/arquivamento por migration** com filtro nas leituras (detalhe na seção 11).

---

## 2. Registros encontrados (receitas)

Todos os 12 registros, tabela `public.receitas`:

| ID mascarado | User mascarado | Descrição | Valor (R$) | Data financeira | mes/ano | created_at | updated_at | Recorrente |
|---|---|---|---|---|---|---|---|---|
| 3e7dc017…c4ca | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-05-05 | 5/2026 | 2026-05-05 19:49:35.598794+00 | idem | SIM |
| 769f7a24…c9f4 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-06-05 | 6/2026 | idem | idem | SIM |
| de07fb13…7120 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-07-05 | 7/2026 | idem | idem | SIM |
| c76d5356…8640 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-08-05 | 8/2026 | idem | idem | SIM |
| 23491df9…d878 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-09-05 | 9/2026 | idem | idem | SIM |
| c6bf60f0…25c1 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-10-05 | 10/2026 | idem | idem | SIM |
| 93060a44…f2d4 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-11-05 | 11/2026 | idem | idem | SIM |
| 01f07dd8…1c69 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2026-12-05 | 12/2026 | idem | idem | SIM |
| 236aa1e4…7c52 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2027-01-05 | 1/2027 | idem | idem | SIM |
| 7ae8ff22…e5c4 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2027-02-05 | 2/2027 | idem | idem | SIM |
| 53026e84…5247 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2027-03-05 | 3/2027 | idem | idem | SIM |
| bf39361f…1f05 | cafcb221…7050 | 5555 | 55.555.555.555,00 | 2027-04-05 | 4/2027 | idem | idem | SIM |

Campos comuns a todas as 12 linhas:

| Campo | Valor |
|---|---|
| tipo | `salario` |
| recorrencia_id | `e6629b5a…e11d` (mesmo grupo nas 12) |
| categoria | tabela `receitas` não possui `categoria_id` — N/A |
| conta vinculada | N/A (não há coluna de conta em `receitas`) |
| cartão vinculado | N/A (não há coluna de cartão em `receitas`) |
| cliente/empresa | `cliente_id` = NULL (pessoa física, sem vínculo B2B) |
| origem | NULL (campo existe; formulário web não preenche) |
| horario | NULL |
| parcelamento | NÃO (não aplicável a receitas) |
| importação vinculada | NÃO (`import_batch_id` NULL, `id_operacao_banco` NULL) |
| WhatsApp vinculado | NÃO (0 mensagens WhatsApp para este usuário) |
| offline_client_id | NULL (não veio de fila offline) |
| Batch/import ID | NULL |

**Indício objetivo de dado fictício**: descrição composta apenas do dígito repetido `5555`; valor `55555555555,00` = teclado repetindo `5`; valor equivale a ~0,4% do PIB brasileiro; conta sem qualquer outro dado financeiro real; criado 59 minutos após o cadastro do usuário; convive com uma receita "salario" de R$ 250,00 do mesmo usuário criada 30 min antes (teste de valor pequeno seguido de teste de valor grande).

---

## 3. Proprietários

| Item | `cafcb221…7050` (receitas 5555) | `47df50ce…478d` (gastos "Csa") |
|---|---|---|
| Existe em `auth.users` | SIM | SIM |
| Existe em `profiles` | SIM (nome com 4 caracteres) | SIM (nome com 24 caracteres) |
| Existe em `user_roles` | SIM — role `user` | SIM — role `owner` |
| Admin Master | NÃO (enum `app_role` só tem `owner`,`user`; não existe `admin_master`) | NÃO (é `owner`, papel administrativo do produto) |
| Plano ativo | `free_ads` : ativo | `free` : ativo |
| E-mail (mascarado) | `f.***@spotpromo.com.br` | `mi***@medeiroscenografia.com.br` |
| Domínio de teste? | NÃO — domínio corporativo real | NÃO — domínio corporativo real |
| Provider | email | email |
| E-mail confirmado | SIM | SIM |
| Criado em | 2026-05-05 18:50:35+00 | 2026-04-27 21:05:44+00 |
| Último login | 2026-05-05 18:50:49+00 (mesma sessão) | 2026-05-01 01:20:56+00 |
| Gastos | 0 | 18 |
| Receitas | 24 (12 fictícias + 12 `salario` R$ 250) | 12 |
| Cartões | 0 | 0 |
| Contas a pagar | 0 | 13 |
| Metas | 0 | 1 |
| Extratos importados | 0 | 1 |
| Mensagens IA | 0 | 0 |
| WhatsApp vinculado | 0 | 0 |
| Conta de teste? | **NÃO FOI POSSÍVEL CONFIRMAR** como conta de teste; é conta real com **conteúdo de teste** (uso exploratório em sessão única) | **NÃO** — uso real e continuado (extrato importado, 13 contas a pagar, meta) |
| Perfil aparenta pessoa real | SIM (e-mail corporativo, confirmado) | SIM |

Observação: `cafcb221` é o único usuário afetado pelas receitas fictícias. Nenhum outro usuário possui receita com valor ≥ R$ 100.000,00.

---

## 4. Origem dos registros

Busca no código (`rg`) por `5555`, `5555555555`, `Csa`, seeds, fixtures, mocks e migrations com INSERT: **nenhuma ocorrência** em `src/` ou `supabase/`.

| Origem possível | Evidência encontrada | Probabilidade | Conclusão |
|---|---|---|---|
| Interface web / formulário de receita recorrente | `src/lib/store.ts:2546-2581` gera `recorrencia_id` único, 12 iterações mensais, mesmo `created_at`, mesmos `mes/ano` derivados de `data` — padrão idêntico ao observado | ALTA | **CONFIRMADA** |
| Importação de extrato | `import_batch_id` NULL, `id_operacao_banco` NULL, 0 extratos do usuário | — | DESCARTADA |
| Importação de documento / OCR | Sem `origem`, sem anexo | — | DESCARTADA |
| WhatsApp | 0 registros em `whatsapp_messages` e `whatsapp_links` para o usuário; WhatsApp OFF | — | DESCARTADA |
| Seed / fixture / mock | Nenhuma string `5555` no repositório | — | DESCARTADA |
| Migration com INSERT | Nenhuma migration insere em `receitas` | — | DESCARTADA |
| Script manual / SQL manual | Nenhum log administrativo correlato | BAIXA | IMPROVÁVEL |
| Teste automatizado | Suíte não escreve no banco de produção | — | DESCARTADA |
| Ferramenta administrativa | `audit_logs` (77 linhas) não contém entrada para `receitas` nesse horário | — | DESCARTADA |
| API / RPC | Não há RPC de criação de receita | — | DESCARTADA |
| Duplicação | 12 linhas são ocorrências mensais distintas, não cópias da mesma data | — | DESCARTADA |
| Recorrência (motor de recorrências) | `recorrencias` não contém `e6629b5a…e11d`; o `recorrencia_id` de gastos/receitas é apenas um **agrupador gerado no cliente**, não FK — comportamento por design | ALTA | CONFIRMADA como agrupador do formulário |

**Causa raiz técnica**: o formulário de receita **não valida teto de valor**. Não existe limite máximo em `addReceita` nem constraint `CHECK` na coluna `valor`. Um usuário consegue gravar 55 bilhões e propagar em 12 meses.

---

## 5. Logs e vínculos

| Fonte | Resultado |
|---|---|
| `audit_logs` (77 linhas) | Sem `entity_type = receitas`; não cobre CRUD financeiro do usuário final |
| `webhook_logs` (936 linhas) | Apenas Mercado Pago / Meta; sem correlação |
| `extratos_importados` (2) | Nenhum do usuário `cafcb221` |
| `imported_transactions` (751) | Nenhuma correspondência por valor/descrição |
| Tabelas WhatsApp | 0 registros do usuário |
| `recorrencias` (17) | Não contém o `recorrencia_id` das 12 receitas (agrupador client-side) |
| `rate_limit_events` | Sem evento correlato |
| Logs de servidor | Retenção não cobre 05/05/2026 |

> **Dívida técnica DT-01**: não existe trilha de auditoria para operações financeiras do usuário final (`gastos`, `receitas`, `contas_a_pagar`). A origem foi inferida por assinatura de dados + leitura de código, não por log. Recomenda-se trigger de auditoria append-only nas tabelas financeiras.

---

## 6. Impacto por usuário

Usuário `cafcb221…7050`:

| Métrica | Situação atual | Sem os registros suspeitos |
|---|---|---|
| Qtd. de receitas | 24 | 12 |
| Soma total | R$ 666.666.666.663,00 | R$ 3.000,00 |
| Maior receita | R$ 55.555.555.555,00 | R$ 250,00 |
| Média mensal (12 meses) | R$ 55.555.555.805,00 | R$ 250,00 |
| Saldo / resultado exibido | ≈ soma das receitas (0 gastos) | R$ 3.000,00 |
| % contaminado | **99,9999995%** | — |

| Usuário mascarado | Soma atual | Soma sem suspeitos | Diferença | % contaminado |
|---|---|---|---|---|
| cafcb221…7050 | 666.666.666.663,00 | 3.000,00 | 666.666.663.663,00 | 99,99999955% |
| **Base inteira (124 receitas)** | 666.667.182.417,00 | 515.757,00 | 666.666.666.660,00 | 99,99999226% |

Nenhum outro usuário é afetado.

---

## 7. Impacto por mês (base inteira, todos os usuários)

| Mês | Soma atual (R$) | Soma sem suspeitos (R$) | Diferença (R$) |
|---|---|---|---|
| Jan/2026 | 0,00 | 0,00 | 0,00 |
| Fev/2026 | 0,00 | 0,00 | 0,00 |
| Mar/2026 | 0,00 | 0,00 | 0,00 |
| **Abr/2026** | **41.589,00** | **41.589,00** | **0,00** |
| Mai/2026 | 55.555.601.394,00 | 45.839,00 | 55.555.555.555,00 |
| Jun/2026 | 55.555.603.894,00 | 48.339,00 | 55.555.555.555,00 |
| Jul/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Ago/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Set/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Out/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Nov/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Dez/2026 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Jan/2027 | 55.555.597.394,00 | 41.839,00 | 55.555.555.555,00 |
| Fev/2027 | 55.555.588.494,00 | 32.939,00 | 55.555.555.555,00 |
| Mar/2027 | 55.555.606.294,00 | 50.739,00 | 55.555.555.555,00 |
| Abr/2027 | 55.555.558.994,00 | 3.439,00 | 55.555.555.555,00 |

Análise objetiva:

- **Como afetam maio/2026**: a 1ª ocorrência tem `data = 2026-05-05`, `mes = 5`, `ano = 2026`; soma isolada de +R$ 55.555.555.555,00 em maio.
- **Afetam abril/2026?** **NÃO.** Diferença de abril = R$ 0,00. Nenhuma linha `5555` tem `mes = 4 / ano = 2026`.
- **Problema de fuso horário?** **NÃO.** Query de consistência: `0` registros com `mes <> extract(month from data)` ou `ano <> extract(year from data)` entre as 124 receitas.
- **`created_at` confundido com data financeira?** **NÃO.** As telas filtram por `r.mes`/`r.ano` (`src/routes/app.tsx:190`), derivados de `data`. `created_at` é usado apenas em ordenação/auditoria.
- **Campo correto no dashboard?** SIM — `mes`/`ano` derivados de `data` (tipo `date`, sem timezone).
- **Mistura entre `date` e `timestamptz`?** Existe convivência (`data` = `date`; `created_at`/`updated_at` = `timestamptz`), mas não há mistura em filtros de relatório.
- **Registros próximos à virada do mês?** NÃO — todas as ocorrências caem no dia 05.
- **Outro motivo para divergência abril × maio?** SIM: abril/2026 tem apenas 8 receitas legítimas (R$ 41.589,00) e maio ganha 3 novas receitas legítimas (R$ 45.839,00 sem os fictícios). A divergência abril→maio relatada anteriormente é **volume natural de dados**, não contaminação.

---

## 8. Impacto nas telas e relatórios

Origem dos dados: `src/lib/store.ts` carrega `receitas` uma única vez (`supabase.from("receitas").select("*").eq("user_id", userId)`) e todas as telas consomem o store em memória. Portanto o impacto é **transversal para o usuário proprietário** e **nulo para os demais** (isolamento por `user_id` + RLS).

| Tela / serviço | Arquivo | Consulta | Campo de data | Impacto |
|---|---|---|---|---|
| Dashboard (resumo mensal, saldo) | `src/routes/app.tsx` | store (`receitas`) filtrado `mes`/`ano` | `mes`/`ano` | **CRÍTICO** |
| Resumo mensal mobile | `src/components/MobileMonthSummary.tsx` | store | `mes`/`ano` | CRÍTICO |
| Fluxo de caixa | `src/components/FluxoCaixaChart.tsx` | store | `mes`/`ano` | CRÍTICO |
| Previsão do mês | `src/components/MonthForecastCard.tsx` | store | `mes`/`ano` | CRÍTICO |
| Saúde financeira | `src/components/DashboardSaudeFinanceiraCard.tsx` | store | `mes`/`ano` | CRÍTICO |
| Diagnóstico mensal | `src/components/DashboardDiagnosticoMensalCard.tsx`, `src/lib/insights/monthly-diagnosis.ts` | store | `mes`/`ano` | CRÍTICO |
| Dicas do dashboard | `src/components/DashboardDicasBloco.tsx` | store | `mes`/`ano` | ALTO |
| Relatórios | `src/routes/relatorios.tsx` | store | `mes`/`ano` | CRÍTICO |
| Renda / listagem de receitas | `src/routes/renda.index.tsx`, `renda.$id.editar.tsx` | store | `data` | ALTO |
| Orçamento | `src/routes/orcamento.tsx` | store | `mes`/`ano` | ALTO |
| Contador / exportação | `src/routes/contador.tsx` | store | `mes`/`ano` | ALTO |
| Clientes (relatório) | `src/routes/clientes_.relatorio.tsx` | store, `cliente_id` | `data` | BAIXO (cliente_id NULL) |
| Gasto AI / finance-ai | `src/lib/finance-ai.functions.ts` | agregados de receitas | `mes`/`ano` | ALTO (prompts com valores absurdos) |
| Alertas / notificações | `src/lib/alerts/generator.ts`, `use-alerts.tsx` | store | `mes`/`ano` | MÉDIO |
| Admin saúde | `src/routes/admin_.saude.tsx` | agregados globais | `created_at` | **ALTO** (soma global R$ 666,6 bi) |
| WhatsApp consultas | `src/server/whatsapp-consultas*.server.ts` | `receitas` por user | `data` | MÉDIO (WhatsApp OFF hoje) |
| Metas / movimentações | `movimentacoes_meta` | — | — | SEM IMPACTO (usuário sem metas) |
| Empresa Inteligente / faturamento | `user_companies` (0 linhas) | — | — | SEM IMPACTO |
| Cartões / faturas | store | — | — | SEM IMPACTO (0 cartões) |
| App móvel futuro / APIs | consumirão o mesmo store | `mes`/`ano` | ALTO (herdará a contaminação) |
| E-mails | `email_send_log` | — | — | SEM IMPACTO (nenhum envio correlato) |

---

## 9. Gastos "Csa"

12 registros em `public.gastos`, usuário `47df50ce…478d`:

| ID mascarado | Descrição | Valor | Data | created_at | Estabelecimento | Forma pgto | tipo_gasto |
|---|---|---|---|---|---|---|---|
| cd46ad3e…c615 | Csa | 4.000,00 | 2026-04-29 | 2026-04-27 21:10:17.406725+00 | ap | boleto | recorrente |
| d7eee70a…14cb | Csa | 4.000,00 | 2026-05-29 | idem | ap | boleto | recorrente |
| c0a95b75…02f4 | Csa | 4.000,00 | 2026-06-29 | idem | ap | boleto | recorrente |
| 98f2f4bc…aedc | Csa | 4.000,00 | 2026-07-29 | idem | ap | boleto | recorrente |
| 92ec9fe7…166a | Csa | 4.000,00 | 2026-08-29 | idem | ap | boleto | recorrente |
| 5bab1203…c49c | Csa | 4.000,00 | 2026-09-29 | idem | ap | boleto | recorrente |
| e33349b7…6098 | Csa | 4.000,00 | 2026-10-29 | idem | ap | boleto | recorrente |
| 2e6f2f25…6c25 | Csa | 4.000,00 | 2026-11-29 | idem | ap | boleto | recorrente |
| f62e968c…f75b | Csa | 4.000,00 | 2026-12-29 | idem | ap | boleto | recorrente |
| dda9ce96…7f9e | Csa | 4.000,00 | 2027-01-29 | idem | ap | boleto | recorrente |
| 41a43156…c1bc | Csa | 4.000,00 | **2027-03-01** | idem | ap | boleto | recorrente |
| 1b2d4fc5…fe9c | Csa | 4.000,00 | 2027-03-29 | idem | ap | boleto | recorrente |

- Soma: **R$ 48.000,00** (12 × R$ 4.000,00) = 92% dos R$ 52.089,00 de gastos do usuário.
- Origem: **CONFIRMADA** — mesmo fluxo de gasto recorrente 12 meses (`recorrencia_id` único `0221b8bd…f0cf`, `created_at` idêntico).
- Vínculos: sem cartão, sem importação, sem WhatsApp.
- **Indício de teste: NÃO.** Evidências contrárias: valor plausível de aluguel; `estabelecimento = "ap"` (apartamento); `forma_pagamento = boleto`; existe recorrência detectada correspondente em `recorrencias` (`94460f2f`, nome "ap", R$ 4.000, mensal, ativa); o mesmo usuário mantém 13 contas a pagar, 1 extrato importado e 1 meta — perfil de uso real. "Csa" é abreviação/erro de digitação de "Casa".
- **Bug real detectado (BUG-01)**: a ocorrência de fevereiro/2027 caiu em **2027-03-01** em vez de 2027-02-28. Causa: `d.setMonth(d.getMonth() + i)` em JS transborda quando o dia (29) não existe no mês destino (fev/2027 tem 28 dias). Isso **duplica ocorrências em março** e **zera fevereiro** nos relatórios. Vale correção em prompt próprio (não é dado fictício).

---

## 10. Outros dados fictícios / anomalias

Varredura de todas as tabelas financeiras:

| Tabela | Linhas | Valores ≥ 100k | Descrições suspeitas | Avaliação |
|---|---|---|---|---|
| receitas | 124 | 12 | 12 | **12 fictícias confirmadas** (alta confiança) |
| gastos | 124 | 0 | 1 ("Csa") | Legítimo (alta confiança) |
| contas_a_pagar | 19 | 0 | 0 | Limpa |
| contas_a_receber | 2 | — | 0 | Limpa |
| cartoes | 5 | — | — | Limpa |
| faturas_cartao | 1 | — | — | Limpa |
| metas_financeiras | 5 | — | — | Limpa |
| movimentacoes_meta | 0 | — | — | Vazia |
| investimentos_ativos | 0 | — | — | Vazia (módulo sem uso) |
| clientes / fornecedores / user_companies | 0 | — | — | Vazias (módulo Empresa sem uso) |
| transferencias_internas | 0 | — | — | Vazia |
| dinheiro_guardado | 10 | — | — | Limpa |
| recorrencias | 17 | — | — | Limpa (6 com status `excluida`) |
| extratos_importados | 2 | — | — | Limpa |
| imported_transactions | 751 | — | — | Limpa |
| mercado_listas | 1 | — | — | Limpa |
| subscription_payments | 8 | — | — | Limpa |
| payment_events | 0 | — | — | **Vazia** — pipeline atômico de billing nunca exercitado (achado pré-existente) |
| whatsapp_messages | 269 | — | — | Sem correlação com dados fictícios |

Repetições exatas encontradas (todas legítimas): "Necessidade" R$ 1.000 ×12, "Cabelo" R$ 35 ×12, "Plano de aposentadoria privada" R$ 100 ×12 (usuário `9901ec4a`), "Geladeira" R$ 200 ×6 (usuário `3324b9f8`) — padrão de recorrência/parcelamento normal.

Nenhum registro órfão, nenhuma data inválida, nenhum dado de canary misturado a dados reais.

---

## 11. Campos de quarentena disponíveis

Varredura de `information_schema.columns`:

| Campo procurado | Existe em tabelas financeiras? |
|---|---|
| `is_test`, `test_data`, `is_demo`, `hidden_from_reports`, `archived_at`, `deleted_at`, `is_archived`, `environment` | **NÃO existem em nenhuma tabela** |
| `status` | Existe em `contas_a_pagar`, `contas_a_receber`, `recorrencias`, `faturas_cartao`, `user_plans`… — **não existe em `receitas` nem em `gastos`** |
| `origem` | Existe em `receitas` e `gastos` (text livre, NULL nos registros suspeitos) |
| `metadata` | Só em `audit_logs`, `payment_events`, `user_alerts`, `email_send_log`, `suppressed_emails` |
| `created_by` | Só em `whatsapp_meta_templates` |
| `source` | Só em tabelas de catálogo (`clientes`, `fornecedores`, `cnpj_cache`…) |

Conclusões:
- **Não é possível fazer quarentena sem migration** nas tabelas `receitas`/`gastos`.
- O campo `origem` é o único candidato "sem migration", mas é texto livre **não filtrado por nenhuma consulta** de dashboard/relatório — marcá-lo não esconderia nada; exigiria alteração de código de qualquer forma, além de poluir semântica de origem.
- RLS atual isola por `user_id`; nenhuma policy contempla campos de arquivamento — políticas continuariam válidas após adicionar `deleted_at` (leitura permanece do próprio dono).
- Dashboard e relatórios **não respeitam** hoje nenhum campo de ocultação.

---

## 12. Estratégias de correção

| Estratégia | Vantagens | Riscos | Migration | Alteração de código | Reversível | Recomendação |
|---|---|---|---|---|---|---|
| **A — `is_test` boolean** | Preserva registro; auditável; semântica explícita | Cria conceito de "dado de teste" em produção que precisa ser mantido para sempre; toda query nova precisa lembrar do filtro | SIM (`ALTER TABLE receitas ADD is_test boolean default false`) | SIM (filtro no store + agregados admin) | SIM (UPDATE de volta) | Aceitável, mas semântica ruim: o dado é **erro de digitação do usuário**, não teste |
| **B — soft delete (`deleted_at timestamptz`)** | Padrão universal; serve para casos futuros (usuário apaga por engano); preserva histórico; filtro único e central no `store.ts`; restauração trivial | Exige disciplina em toda query futura; +1 índice parcial | SIM (`receitas` e `gastos`, com índice `WHERE deleted_at IS NULL`) | SIM (1 filtro no carregamento do store + agregados admin) | SIM (`deleted_at = NULL`) | **RECOMENDADA** |
| **C — DELETE definitivo** | Simples, zero código, zero migration; base limpa | Perda irreversível sem backup; o registro pertence a um usuário real que pode questionar; não há backup point-in-time verificado | NÃO | NÃO | NÃO | Não recomendada agora |
| **D — Correção de valor** | Mantém a intenção do usuário | **Impossível determinar o valor correto** — descrição `5555` não indica valor pretendido; seria inventar dado financeiro alheio | NÃO | NÃO | Parcial | **Descartada** |

Complemento obrigatório em qualquer estratégia: **constraint/validação de teto de valor** no formulário e no banco (ex.: `CHECK (valor > 0 AND valor <= 1000000000)`), senão o problema se repete.

---

## 13. Recomendação final

| Pergunta | Resposta | Evidência |
|---|---|---|
| Os 12 registros são comprovadamente fictícios? | **SIM** | Descrição `5555`, valor R$ 55.555.555.555,00, conta sem nenhum outro dado real, sessão única |
| A quais usuários pertencem? | 1 usuário: `cafcb221…7050` | Query agregada por `user_id` |
| Os usuários são reais ou de teste? | **PARCIALMENTE** — conta real (e-mail corporativo confirmado) com conteúdo de teste | `auth.users` + `profiles` + ausência de uso |
| Como foram criados? | Formulário web de receita recorrente (12 meses) | `store.ts:2546-2581`, `created_at` idêntico, `recorrencia_id` único |
| Afetam apenas maio ou também abril? | **Apenas de maio/2026 em diante** — abril/2026 diferença R$ 0,00 | Tabela da seção 7 |
| Problema adicional de fuso horário? | **NÃO** | 0 divergências `mes/ano` × `data` |
| Quais telas estão contaminadas? | Dashboard, resumo mensal, fluxo de caixa, previsão, saúde financeira, diagnóstico, relatórios, orçamento, contador, Gasto AI, alertas e o painel Admin Saúde | Seção 8 |
| Existem outros dados fictícios? | **NÃO** nas demais tabelas | Seção 9 |
| Os gastos "Csa" são testes? | **NÃO** | Recorrência real "ap" R$ 4.000 boleto + perfil de uso real |
| Existe campo seguro para quarentena? | **NÃO** | Seção 10 |
| Será necessária migration? | **SIM** | Nenhum campo de arquivamento existe |
| Estratégia mais segura? | **B — soft delete (`deleted_at`)** | Seção 11 |
| Impacto da estratégia recomendada | Receitas do usuário caem de R$ 666.666.666.663,00 para R$ 3.000,00; soma global cai para R$ 515.757,00; nenhum outro usuário é afetado; nenhum dado é perdido | Seção 6 |
| Como reverter? | `UPDATE receitas SET deleted_at = NULL WHERE id IN (12 IDs)` — lista de IDs preservada neste relatório e em tabela de log da migration | Seção 14 |
| Próximo prompt | Prompt 2 — aplicação controlada do soft delete + validação de teto de valor | Seção 15 |

---

## 14. Plano de reversão (para o Prompt 2)

1. Antes da migration, gravar snapshot dos 12 IDs completos em tabela de log (`data_quarantine_log`) com `valor`, `data`, `user_id` e motivo.
2. Migration adiciona `deleted_at timestamptz NULL` em `receitas` (e `gastos`, por simetria) + índice parcial + GRANTs preservados; RLS inalterada.
3. UPDATE restrito por lista explícita de 12 IDs (nunca por `descricao` ou `valor`).
4. Reversão: `UPDATE public.receitas SET deleted_at = NULL WHERE id = ANY(<lista do log>)` — restaura estado idêntico, pois nenhuma outra coluna é tocada.
5. Rollback de schema (se necessário): `ALTER TABLE public.receitas DROP COLUMN deleted_at` (após reverter o filtro no código).

---

## 15. Próximo prompt sugerido

**Prompt 2 — Correção controlada dos dados fictícios**
- Migration: `deleted_at` em `receitas` e `gastos` + índice parcial + `data_quarantine_log`.
- CHECK de teto de valor (`valor > 0 AND valor <= 1.000.000.000`) e validação no formulário.
- Filtro `deleted_at IS NULL` no carregamento do store e nos agregados de Admin Saúde.
- UPDATE por lista explícita dos 12 IDs.
- Testes de regressão + verificação numérica pós-correção.

Itens laterais para prompts próprios (não misturar):
- **BUG-01**: transbordo de dia 29→01 na geração de recorrências (`setMonth`), afeta fev/2027 do usuário `47df50ce`.
- **DT-01**: ausência de trilha de auditoria nas tabelas financeiras.

---

## 16. Confirmações

- Nenhum registro foi alterado — **CONFIRMADO**
- Nenhum registro foi excluído — **CONFIRMADO**
- Nenhuma migration foi executada — **CONFIRMADO**
- Nenhuma tabela foi alterada — **CONFIRMADO**
- Nenhuma função foi alterada — **CONFIRMADO**
- Nenhum arquivo de código foi alterado — **CONFIRMADO**
- Nenhum dado foi colocado em quarentena — **CONFIRMADO**
- Nenhuma versão foi publicada — **CONFIRMADO**
- Nenhum pagamento foi processado — **CONFIRMADO**
- Nenhuma mensagem foi enviada — **CONFIRMADO**
- WhatsApp, dispatcher e crons permaneceram desligados — **CONFIRMADO**
- Único arquivo criado: este relatório — **CONFIRMADO**
