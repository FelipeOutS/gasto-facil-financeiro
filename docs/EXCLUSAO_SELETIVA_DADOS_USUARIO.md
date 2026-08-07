# PRIVACIDADE E DADOS — AUDITORIA DE MODELO DE DADOS

Este documento contém o mapeamento integral do banco de dados para a funcionalidade de Exclusão Seletiva de Dados.

## 1. MATRIZ DE AUDITORIA DE TABELAS

| Categoria UX | Tabela | FK Usuário | Dependências | Estratégia |
|---|---|---|---|---|
| **Gastos** | `gastos` | `user_id` | `metas`, `cartoes` | DELETE |
| **Receitas** | `receitas` | `user_id` | - | DELETE |
| **Contas a Pagar** | `contas_a_pagar` | `user_id` | `gastos` | DELETE |
| **Contas a Receber** | `contas_a_receber` | `user_id` | - | DELETE |
| **Metas** | `metas_financeiras` | `user_id` | `movimentacoes_meta` | DELETE (Cascade) |
| **Orçamento** | `limites` | `user_id` | - | DELETE |
| **Dinheiro Guardado**| `dinheiro_guardado` | `user_id` | `metas` | DELETE |
| **Cartões e Faturas**| `cartoes` | `user_id` | `faturas_cartao`, `gastos`| DELETE / SET NULL |
| **Faturas** | `faturas_cartao` | `user_id` | - | DELETE |
| **Assinaturas** | `recorrencias` | `user_id` | - | DELETE |
| **Investimentos** | `investimentos_ativos` | `user_id` | `rendimentos`, `atualizacoes`| DELETE (Cascade) |
| **Mercado** | `mercado_listas` | `user_id` | `mercado_historico_compras`| DELETE |
| **Importações** | `extratos_importados`| `user_id` | `gastos` | DELETE / DESVINCULAR|

## 2. DADOS PRESERVADOS (NÃO EXCLUÍVEIS NESTE FLUXO)

- `profiles`: Dados básicos de perfil.
- `user_roles`: Permissões e acessos.
- `user_plans`: Assinatura e status de pagamento.
- `payment_checkout_sessions` / `subscription_payments`: Histórico de cobrança.
- `audit_logs`: Registros de segurança.
- `user_onboarding`: Estado do fluxo inicial.

## 3. STORAGE E ARQUIVOS

- `comprovantes/`: Recibos de gastos.
- `extratos/`: Arquivos PDF/CSV importados.
- `avatars/`: Foto de perfil (Preservada).

## 4. DADOS DERIVADOS (LIMPEZA AUTOMÁTICA)

- Insights (`monthly_diagnosis`)
- Health Score
- Cache de dashboard (Invalidação via React Query/Store)
