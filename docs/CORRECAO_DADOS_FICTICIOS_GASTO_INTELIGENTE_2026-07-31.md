# Correção Controlada das Receitas Fictícias — Gasto Inteligente

**Data:** 2026-07-31 · **Prompt:** 2 — Correção controlada das receitas fictícias e prevenção de recorrências inválidas
**Estratégia aprovada:** B — **soft delete** (quarentena com marcação, sem exclusão física)
**Escopo:** 12 receitas fictícias de 1 usuário + prevenção estrutural (banco + código) + correção do bug de calendário em recorrências

---

## 1. Resumo executivo

| Item | Antes | Depois |
|---|---|---|
| Linhas em `receitas` (físicas) | 124 | 124 (nenhuma linha apagada) |
| Linhas ativas (`deleted_at IS NULL`) | 124 | 112 |
| Linhas em quarentena | 0 | 12 |
| Soma operacional de `receitas` | R$ 666.667.182.417,00 | **R$ 515.757,00** |
| Soma física (histórico preservado) | R$ 666.667.182.417,00 | R$ 666.667.182.417,00 |
| Teto de valor no banco | inexistente | `receitas_valor_valid_range_check` (R$ 999.999.999,99) |
| Teto de valor no app | inexistente | `src/lib/financial-limits.ts` (cliente + servidor + WhatsApp) |
| Bug de recorrência dia 29/30/31 | presente (`setMonth`) | corrigido (`addMonthsPreservingDay`) |

Nenhum dado foi excluído. A reversão é uma única instrução (seção 8).

---

## 2. Pré-validação executada antes de qualquer escrita

A quarentena rodou dentro de um bloco `DO $$ … $$` com abortos explícitos. Se qualquer condição falhasse, **nada** seria escrito:

- exatamente **12** IDs encontrados (senão `ABORT`);
- **1** único `user_id` (`cafcb221…7050`) e **1** único `recorrencia_id` (`e6629b5a…e11d`);
- **0** registros divergentes do diagnóstico (descrição `5555`, valor `55555555555.00`, tipo `salario`, data entre 2026-05-01 e 2027-04-30);
- **0** registros já em soft delete;
- soma exatamente igual a **666.666.666.660,00**;
- `UPDATE` afetando exatamente **12** linhas (senão `ABORT`).

Também foi verificado que `recorrencias.id = e6629b5a…e11d` **não existe**: o `recorrencia_id` das 12 linhas era um agrupador gerado no cliente (não FK). Portanto **nenhuma recorrência de nenhum usuário foi desativada** — sem as 12 linhas ativas, a série deixa de existir operacionalmente.

---

## 3. Migration aplicada

`supabase/migrations/20260731181756_aca19664-f754-4d77-9803-0dbb560693ae.sql`

**A — estrutura de quarentena em `public.receitas`**

| Coluna | Tipo | Uso |
|---|---|---|
| `deleted_at` | `timestamptz NULL` | preenchido = linha ignorada por todas as consultas operacionais |
| `deleted_reason` | `text NULL` | `confirmed_test_recurring_income` |
| `deleted_source` | `text NULL` | `controlled_cleanup_2026_07_31` |

Índices parciais criados (performance das consultas ativas):
`idx_receitas_user_periodo_ativas`, `idx_receitas_user_data_ativas`, `idx_receitas_recorrencia_ativas`.

**B — quarentena atômica** dos 12 IDs explícitos listados no diagnóstico.

**C — teto de valor**
`receitas_valor_valid_range_check`: `deleted_at IS NOT NULL OR (valor > 0 AND valor <= 999999999.99)`.
Linhas em quarentena ficam isentas para **preservar o histórico sem alterá-lo**.

**Migration complementar (mesma frente)** — contadores de quota do plano `free_ads` passaram a ignorar receitas em quarentena:
`public.assert_free_ads_quota` e o trigger `public.tg_free_ads_quota_receitas` agora contam apenas `deleted_at IS NULL`. Sem isso, os 12 registros ocultos continuariam consumindo a cota mensal do usuário.

---

## 4. Estado do banco após a correção

```
total | ativas | soft | soma_ativa
  124 |    112 |   12 |  515757.00
```

Soma por mês (apenas ativas — nenhum valor implausível restante):

| Período | Soma (R$) | Período | Soma (R$) |
|---|---|---|---|
| 4/2026 | 41.589,00 | 11/2026 | 41.839,00 |
| 5/2026 | 45.839,00 | 12/2026 | 41.839,00 |
| 6/2026 | 48.339,00 | 1/2027 | 41.839,00 |
| 7/2026 | 41.839,00 | 2/2027 | 32.939,00 |
| 8/2026 | 41.839,00 | 3/2027 | 50.739,00 |
| 9/2026 | 41.839,00 | 4/2027 | 3.439,00 |
| 10/2026 | 41.839,00 | | |

Os 12 registros continuam fisicamente presentes, com `deleted_reason = 'confirmed_test_recurring_income'`.

---

## 5. Gastos "Csa" — nenhuma ação

12 gastos com descrição iniciada em `Csa`, total **R$ 48.000,00** (R$ 4.000,00 × 12). O diagnóstico concluiu que são **despesa real recorrente** (perfil de aluguel/moradia), com valor plausível e descrição apenas abreviada. **Decisão: não tocar.** Nenhum gasto foi marcado, alterado ou apagado.

---

## 6. Prevenção no código

| Arquivo | O que passou a existir |
|---|---|
| `src/lib/financial-limits.ts` | Fonte única: `MAX_FINANCIAL_ENTRY_AMOUNT` (999.999.999,99), `MIN_FINANCIAL_ENTRY_AMOUNT`, `validateFinancialAmount`, mensagens amigáveis pt/en (nunca expõem erro do banco) |
| `src/lib/store.ts` | Validação do valor antes de gravar receita (única e recorrente) + carga da store filtrando `deleted_at IS NULL` |
| `src/server/whatsapp-receitas.server.ts` | Mesma validação no servidor antes da RPC/insert + leituras filtrando quarentena |
| `src/lib/recurrence-date.ts` | `addMonthsPreservingDay` — corrige o **BUG-01** (overflow de `setMonth` em dias 29/30/31, que jogava 31/01 para 03/03) |

**Leituras operacionais de `receitas` auditadas e filtradas** (`.is("deleted_at", null)`):
`src/lib/store.ts`, `src/server/whatsapp-receitas.server.ts`, `src/server/whatsapp-consultas.server.ts`, `src/server/whatsapp-consultas-especificas.server.ts`.
As demais superfícies (dashboard, relatórios, orçamento, contador, insights, Gasto AI, exportações) consomem a store já filtrada — verificado por varredura de todas as ocorrências de `from("receitas")` no projeto: as únicas não filtradas são `insert`/`update`/`delete`, onde o filtro não se aplica.

---

## 7. Testes

- `tests/receitas-soft-delete-e-teto-valor.test.ts` — teto de valor (0, negativo, NaN, Infinity, 3 casas decimais, notação científica, 999.999.999,99 aceito, 1.000.000.000,00 e 55.555.555.555,00 rejeitados), contrato de código do filtro de soft delete, agregações ignorando quarentena, restaurabilidade das 12 linhas e isolamento por usuário.
- `tests/recorrencia-mensal-dias-29-30-31.test.ts` — recorrência mensal iniciada em 29/30/31 sem pular mês.
- Mocks compartilhados (`tests/_whatsapp-fake.ts`) e mock local do Block 3 ganharam suporte a `.is(col, val)`.

**Runner integral (`bun scripts/test-whatsapp.mjs`):**

```
Arquivos executados : 126
Aprovados (testes)  : 2279
Falhos    (testes)  : 0
Duração total       : 33.08s
```

Typecheck (`tsgo --noEmit`): **0 erros**. Linter de segurança do banco: nenhum finding novo introduzido por esta frente (os itens listados são pré-existentes e já mapeados no relatório geral).

---

## 8. Reversão

```sql
UPDATE public.receitas
   SET deleted_at = NULL, deleted_reason = NULL, deleted_source = NULL
 WHERE deleted_source = 'controlled_cleanup_2026_07_31';
```

Atenção: a constraint `receitas_valor_valid_range_check` **rejeita** a reversão enquanto o teto estiver ativo, porque os valores são maiores que R$ 999.999.999,99. Para restaurar de fato é preciso remover a constraint antes (`ALTER TABLE public.receitas DROP CONSTRAINT receitas_valor_valid_range_check;`) — o que é intencional: reverter só deve acontecer por decisão explícita do dono.

---

## 9. Pendências conhecidas fora do escopo deste prompt

- CVE `seroval` (dependências `@tanstack/*`) — frente separada.
- `payment_events = 0`: pipeline de billing MP ainda não exercitado ponta a ponta.
- Teto de valor equivalente em `gastos`, `contas_a_pagar` e `contas_a_receber`: **ainda não aplicado** — a mesma função `validateFinancialAmount` já está disponível para reuso.
- Não existe painel administrativo para listar/restaurar registros em quarentena; hoje é operação de banco.
