---
name: Auditoria de Bancos, Migração e Plano de Cutover
description: Resultado da auditoria técnica sobre a existência de múltiplos bancos e frentes de migração.
---
# Auditoria de Bancos, Migração e Plano de Cutover (Gasto Inteligente)

**Data:** 2026-08-03
**Versão:** 1.0 (Somente Leitura)
**Status:** ✅ AUDITORIA CONCLUÍDA

## 1. Resumo Executivo
A auditoria técnica não encontrou evidências de uma migração de banco de dados entre dois projetos Supabase/Lovable ativos no repositório. Existe apenas **um ambiente oficial** acessível e configurado. A frente de migração é classificada como **NÃO APLICÁVEL** no estágio atual, sendo recomendada a consolidação do ambiente único.

## 2. Projetos e Ambientes Encontrados

| Referência (Mascarada) | Onde Encontrada | Função Provável | Estado | Observação |
| :--- | :--- | :--- | :--- | :--- |
| `vnlx...egak` | `config.toml`, `.env`, `.env.production` | Backend Oficial | **ATIVO** | Único ref em todo o código. |

## 3. Classificação dos Ambientes

| Ambiente | Project Ref (Mascarado) | Banco | Auth | Storage | Secrets | Domínio Associado | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Produção** | `vnlx...egak` | Oficial | Oficial | Oficial | Oficiais | `gastointeligente.com.br` | **ATIVO** |
| **Preview** | `vnlx...egak` | Oficial | Oficial | Oficial | Oficiais | `lovable.app` | **ATIVO** |

## 4. Confirmação Preview e Produção

| Recurso | Preview | Produção | Compartilhado? |
| :--- | :--- | :--- | :--- |
| **Banco** | `vnlx...egak` | `vnlx...egak` | **SIM** |
| **Auth** | `vnlx...egak` | `vnlx...egak` | **SIM** |
| **Storage** | `vnlx...egak` | `vnlx...egak` | **SIM** |
| **Secrets** | Lovable Cloud | Lovable Cloud | **SIM** |
| **Crons** | 1 (Ativo) | 1 (Ativo) | **SIM** |

## 5. Verificação de Migração
*   **Veredito:** **MIGRAÇÃO NÃO INICIADA / NÃO EXISTE.**
*   **Evidências:** 
    *   Não há refs secundários no código.
    *   Não há scripts de dump/restore ou checklist de migração.
    *   Não há variáveis de ambiente `SOURCE_DB` ou `DEST_DB`.
    *   As referências em documentos (PLANO_APLICATIVO_IOS_GASTO_INTELIGENTE.md) são hipotéticas ou preventivas.

## 6. Inventário do Banco Atual (`vnlx...egak`)

### Estrutura (Public)
*   **Tabelas:** 74 (Todas com RLS habilitado).
*   **Funções:** 73 (63 com `SECURITY DEFINER`).
*   **Triggers:** 77.
*   **Policies:** 328.
*   **Índices:** 694.
*   **Enums:** 5.
*   **Cron Jobs:** 1 (pg_cron ativo).
*   **Buckets Storage:** 3 (`metas-covers`, `avatars`, `mercado-product-images`).

### Baseline Financeiro (Preservado)
| Tabela | Contagem Física | Contagem Ativa | Soma Operacional | Observação |
| :--- | :--- | :--- | :--- | :--- |
| **Receitas** | 124 | 112 | R$ 515.757,00 | 12 em soft delete. |
| **Gastos** | 136 | 136 | R$ 82.666,78 | Baseline operacional. |
| **Contas a Pagar** | 19 | 19 | - | - |
| **Contas a Receber** | 2 | 2 | - | - |
| **Faturas** | 1 | 1 | - | - |
| **Metas** | 5 | 5 | - | - |

## 7. RLS, Policies e Grants
*   **RLS:** Habilitado em 100% das tabelas da `public`.
*   **Policies:** Estrutura robusta baseada em `auth.uid()` e `has_role`.
*   **SECURITY DEFINER:** 63 funções utilizam este privilégio, requerendo auditoria constante de `search_path`.
*   **Risco:** **BAIXO** (Configuração atual segue as melhores práticas de isolamento).

## 8. Migrations
*   **Total:** ~140+ arquivos.
*   **Primeira:** `20260424171039` (Core).
*   **Última:** `20260731201014` (Analytics).
*   **Status:** Todas aplicadas no banco oficial.

## 9. Riscos e Recomendações
*   **Risco de Escrita Dupla:** **NULO** (Apenas um banco configurado).
*   **Necessidade de Cutover:** **NÃO.**
*   **Acessos Faltantes:** Nenhum. O banco atual é o destino final.
*   **Próxima Ação:** Encerrar a frente de migração e focar na ativação comercial (WhatsApp Beta e Mercado Pago).

## 10. Impacto em Android/iOS
O backend atual (`vnlx...egak`) está pronto para servir os aplicativos móveis. A ausência de migração simplifica o rollout, evitando problemas de sincronia de UUIDs ou Storage.

---
**Confirmação:** Auditoria realizada em modo 100% leitura. Nenhuma alteração de dados ou schema efetuada.
