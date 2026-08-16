---
name: Meus Bens & Financiamentos — V1
description: Inventário, regras de contabilização única, integridade de conta, histórico de financiamento e arquivamento.
---

# Meus Bens & Financiamentos — V1

## 1. Inventário real da mudança

**5 tabelas novas**
1. `bens`
2. `bens_financiamentos`
3. `bens_pagamentos`
4. `bens_amortizacoes`
5. `bens_custos_aquisicao`

**2 colunas novas**
- `gastos.bem_id`
- `recorrencias.bem_id`

Nenhum motor paralelo de despesa ou recorrência foi criado.

## 2. Integridade de propriedade/conta

Todos os vínculos usam **FK composta com `user_id`**, validada pelo banco mesmo
que o ID seja enviado manualmente:

| Vínculo | Constraint |
| :-- | :-- |
| `gastos.bem_id` | `gastos_bem_fk (user_id, bem_id) → bens(user_id, id)` |
| `recorrencias.bem_id` | `recorrencias_bem_fk (user_id, bem_id) → bens(user_id, id)` |
| `bens_financiamentos.bem_id` | `bens_financiamentos_bem_fk` |
| `bens_pagamentos.bem_id / financiamento_id / gasto_id` | 3 FKs compostas |
| `bens_amortizacoes.bem_id / financiamento_id / gasto_id` | 3 FKs compostas |
| `bens_custos_aquisicao.bem_id / gasto_id` | 2 FKs compostas |

Pré-requisito criado: `UNIQUE (user_id, id)` em `bens`, `bens_financiamentos`,
`gastos` e `recorrencias`. RLS por `auth.uid() = user_id` em todas as tabelas
novas, com GRANTs para `authenticated` e `service_role` (sem `anon`).

Cobertura: `tests/bens-financiamentos-v1.test.ts` executa inserts reais em
transação revertida provando a recusa de gasto da conta A em bem da conta B,
recorrência da conta A em bem da conta B e pagamento vinculado a gasto de
outra conta.

## 3. Entrada sem dupla contabilização

`bens.entrada_total` é a **fonte única** da entrada, com composição em
`entrada_recursos_proprios`, `entrada_fgts` e `entrada_outros`.

`bens_custos_aquisicao` guarda **apenas custos adicionais**: ITBI, registro,
escritura, avaliação, corretagem, documentação, vistoria, transferência,
outros. A entrada nunca é lançada ali, e a UI declara isso explicitamente.

## 4. Contagem única do desembolso

Pagamentos, amortizações e custos guardam **snapshot** do valor do evento.

- Sem `gasto_id`: o desembolso usa o snapshot.
- Com `gasto_id`: o desembolso usa o **valor do gasto** (fonte de caixa). Nunca
  somamos `valor do evento + valor do gasto`.
- `gasto_id` é `UNIQUE` em cada tabela filha: um gasto não pode ser reutilizado
  em dois eventos.

**Gasto editado depois:** o total desembolsado passa a refletir o novo valor do
gasto; o snapshot permanece intacto para auditoria e a tela exibe o aviso
"Gasto vinculado foi editado — o caixa segue o gasto".

**Gasto excluído:** FK `ON DELETE SET NULL` — o evento sobrevive e volta a ser
contabilizado pelo snapshot.

## 5. Histórico de financiamento

`bens_financiamentos` aceita N registros por bem (refinanciamento,
portabilidade). `status ∈ (ativo, liquidado, portado, refinanciado, cancelado)`,
com `motivo_encerramento`, `encerrado_em` e `substituido_por_id`.

Restrição: índice único parcial `uniq_bens_financiamento_ativo (bem_id) WHERE
status = 'ativo'` — no máximo um ativo por bem na V1, sem impedir o histórico.

## 6. Arquivar em vez de excluir

O caminho principal da UI é **Arquivar** (`status='arquivado'` +
`arquivado_em`), preservando pagamentos, amortizações, custos, gastos e
recorrências.

O trigger `trg_bens_prevent_destructive_delete` recusa `DELETE` de bem que
tenha qualquer vínculo, com o erro `bem_com_historico`. Bens sem histórico
ainda podem ser removidos.

## 7. Escopo

V1 entrega cadastro de bens (imóvel/veículo), financiamento com histórico,
parcelas pagas, amortizações extraordinárias, custos adicionais, resumo
financeiro e arquivamento. Patrimônio/venda existem apenas como colunas
(`valor_mercado`, status `vendido`), sem telas próprias.
