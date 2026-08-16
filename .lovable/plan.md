# Plano de Implementação — Meus Bens & Financiamentos V2

Este plano detalha a V2 do módulo de Bens e Financiamentos, focada em patrimônio líquido, evolução de valor e visão financeira consolidada, sem alterar a arquitetura de contabilização da V1.

## 1. Banco de Dados e Migração

Criar tabelas para suportar o histórico de valor do bem e atualizações manuais de saldo devedor, mantendo a integridade de conta via FK composta.

- **Tabela `bens_historico_valor`**:
  - `id`, `user_id`, `bem_id`, `valor_estimado`, `data_referencia`, `observacao`, `created_at`.
  - FK composta `(user_id, bem_id) -> bens(user_id, id)`.
  - RLS estrito por `auth.uid()`.
- **Tabela `bens_historico_saldo`**:
  - `id`, `user_id`, `financiamento_id`, `saldo_devedor`, `data_referencia`, `observacao`, `created_at`.
  - FK composta `(user_id, financiamento_id) -> bens_financiamentos(user_id, id)`.
  - RLS estrito por `auth.uid()`.

## 2. Motor de Cálculo (`src/lib/bens.ts`)

Expandir as métricas mantendo o rigor da V1.

- **Patrimônio Líquido**: `valor_atual - saldo_devedor`.
- **Evolução de Valor**: Comparação entre `valor_compra` e `valor_atual` (variação nominal e percentual).
- **Média de Custos**: Cálculo de média móvel (3, 6, 12 meses) baseada em despesas reais.
- **Composição de Custos**: Agrupamento percentual por categoria (financiamento, impostos, manutenção, etc).
- **Progresso**: Percentual de redução do saldo devedor original vs atual.

## 3. Interface do Usuário (UI/UX)

- **Dashboard Geral (`/bens`)**:
  - Topo com resumo: Valor Total dos Bens, Saldo Devedor Total, Patrimônio Líquido Estimado Total.
  - Indicadores de bens sem valor atualizado.
- **Detalhes do Bem (`/bens/$id`)**:
  - **Novo Card de Patrimônio**: Exibe Valor Atual, Saldo Devedor e Patrimônio Líquido.
  - **Comparativo de Aquisição**: Compra vs Atual.
  - **Ações Rápidas**: "Atualizar Valor" e "Atualizar Saldo" com diálogos dedicados.
  - **Gráficos**: Evolução do Valor Estimado e Evolução do Saldo Devedor (usando `recharts`).
  - **Resumo de Amortizações**: Visualização consolidada por origem (FGTS, Recursos Próprios).
  - **Composição de Gastos**: Barras horizontais de custos.
  - **Timeline Unificada**: Histórico cronológico de todos os eventos (financeiros e informativos).

## 4. Testes e Validação

- **Testes Unitários**:
  - Cálculo de patrimônio com dados parciais.
  - Média de custos em períodos sem dados.
  - Variação nominal/percentual correta.
- **Testes E2E (Playwright)**:
  - Fluxo de atualização de valor e reflexo imediato no patrimônio.
  - Visualização de gráficos em mobile (sem overflow).
  - Validação da timeline cronológica.

## Detalhes Técnicos

- **Tecnologias**: React 19, Tailwind v4, TanStack Start, Lucide Icons, Recharts para os gráficos.
- **Segurança**: Toda a lógica de RLS e FKs compostas será replicada para as novas tabelas, garantindo que um usuário nunca veja dados de outro, mesmo que os UUIDs sejam conhecidos.
- **Consistência**: O `valor_aquisicao` da V1 nunca será usado como fallback automático para `valor_atual`, conforme solicitado, para manter a clareza da estimativa do usuário.
