# Opção A — Exclusão reversível de gastos (Fase 1: auditoria e plano)

Status: auditoria apenas. Nenhum arquivo do projeto, banco, dado, segredo, flag, Meta ou publicação foi alterado.

## 1. Diagnóstico confirmado (leituras desta sessão)

- `public.gastos` (32 colunas): não tem `deleted_at` nem marca equivalente. Relacionamentos: `user_id`→auth.users (CASCADE), `categoria_id`/`fornecedor_id`/`bem_id` (SET NULL). Apontam para gastos, com SET NULL: `bens_pagamentos`, `bens_amortizacoes`, `bens_custos_aquisicao`. Parcelas: só `grupo_parcelamento_id`, sem FK. Recorrência: `recorrencia_id`. Importação: `import_batch_id`.
- Políticas atuais: `gastos_*_own` (SELECT/INSERT/UPDATE/DELETE) e `connected_*_gastos` (contas compartilhadas também podem apagar). Triggers: `free_ads_quota_gastos`, `trg_gastos_updated_at`.
- Funções do banco que citam gastos: `create_installment_purchase`, `import_extrato_atomic`, `whatsapp_baixa_conta_atomic`, `whatsapp_undo_recent_action` (apaga físico), `whatsapp_edit_recent_action`, `execute_data_deletion_atomic` (apaga físico, LGPD), `bens_prevent_destructive_delete`, `assert_free_ads_quota`, `has_feature_access`, `has_basic_feature_access`. O corpo exato delas não foi revisado: NÃO VERIFICADO.
- Views: nenhuma view lê gastos (`contas_a_pagar_shared`, `user_integrations_safe`).

## 2. Matriz de impacto (código)

| Área | Arquivo | Uso atual | Mudança necessária |
|---|---|---|---|
| Carga principal do site (dashboard, orçamento, relatórios, metas, cartões) | `src/lib/store.ts` (18 acessos; insert, delete, select) | lê todos os gastos do usuário; os cálculos (`src/lib/orcamento.ts` etc.) usam o estado carregado | filtrar `deleted_at is null` na carga e nos recarregamentos; o delete manual continua físico ou vira soft (decisão G4) |
| Contas a pagar → gasto | `src/lib/contas.functions.ts` (6; delete nas linhas 226, 261, 304) | rollback físico do gasto criado e desfazer pagamento | manter físico só no rollback de criação; desfazer pagamento → soft ou físico (G4) |
| Faturas | `src/server/cartao-fatura.server.ts` (4) | soma da fatura | filtrar |
| WhatsApp consultas | `whatsapp-consultas*.server.ts`, `whatsapp-postlaunch`, `finance-ai.server.ts`, `whatsapp-research`, `upsell-eligibility` | somas e listas | filtrar |
| WhatsApp gravação | `whatsapp.server.ts:2127`, `whatsapp-comprovantes:895`, `whatsapp-pix-intents:473`, `whatsapp-pagar-pessoa-flow:583`, `whatsapp-parcelamento`, `whatsapp-fatura-escolha` | insert e leitura | inserts sem mudança; leituras filtradas |
| Desfazer do WhatsApp | `src/lib/whatsapp.functions.ts:286`, `src/routes/whatsapp.tsx:714,1524`, RPC `whatsapp_undo_recent_action` | apaga físico | manter físico (desfaz um lançamento recém-criado) ou migrar para soft (G4) |
| Exclusão LGPD | `src/lib/privacy.functions.ts` + `execute_data_deletion_atomic` | apaga físico | manter físico e incluir os gastos já marcados |
| Importação de extrato | `import_extrato_atomic`, `store.ts` | insere e reverte por lote | reverter lote também precisa filtrar ou incluir os marcados (NÃO VERIFICADO) |
| Cota free_ads | trigger `tg_free_ads_quota_gastos`, `assert_free_ads_quota` | conta gastos | decidir se um gasto marcado libera cota (recomendo não liberar) |
| Bens | `bens_prevent_destructive_delete`, `src/lib/bens.ts` | protege vínculos | o soft-delete preserva o vínculo, o que é melhor que hoje |
| Offline/sync | `store.ts` (`offline_client_id`) | reenvio de pendências | um gasto marcado não pode ser recriado nem ressincronizado |

Risco reconhecido: qualquer leitor esquecido continuará exibindo e somando gastos excluídos. A mitigação está na seção 5.

## 3. Design da migration (proposta, NÃO aplicar)

```text
ALTER TABLE public.gastos
  ADD COLUMN deleted_at timestamptz NULL,
  ADD COLUMN deleted_by uuid NULL,          -- auth user id (sem PII)
  ADD COLUMN deletion_batch_id uuid NULL,   -- lote da exclusão por período
  ADD COLUMN deletion_source text NULL      -- 'whatsapp_periodo' | 'site' (sem texto livre)
    CHECK (deletion_source IN ('whatsapp_periodo','site'));
CREATE INDEX gastos_user_data_ativos ON public.gastos (user_id, data) WHERE deleted_at IS NULL;
CREATE INDEX gastos_deletion_batch ON public.gastos (deletion_batch_id) WHERE deletion_batch_id IS NOT NULL;
```

- `deleted_by` guarda só o user_id, o que basta: contas compartilhadas mostram quem agiu sem guardar e-mail. Fica de fora um `deletion_reason` em texto livre, para não guardar dado pessoal.
- RLS: as políticas atuais seguem. Uma nova política impede UPDATE de `deleted_*` direto pelo cliente; marcar e restaurar só via RPC `SECURITY DEFINER`.
- RPCs:
  - `gastos_soft_delete_periodo(p_user, p_ini, p_fim_excl, p_snapshot_hash, p_expected_count, p_expected_sum, p_batch_id)`: numa transação, trava as linhas (`FOR UPDATE`), recalcula contagem, soma e hash; se divergir, aborta sem marcar nada. Se `p_batch_id` já foi aplicado, devolve o mesmo resultado (idempotente).
  - `gastos_restaurar_lote(p_user, p_batch_id)`: limpa `deleted_*` só daquele lote e só do usuário.
  - Auditoria: em `audit_logs`, só contagem, soma, período e batch_id.
- Exclusão LGPD continua física e separada; passa a incluir os gastos marcados.
- Parcelas (recomendação): bloquear o período se ele cortar um grupo de parcelas ao meio. A prévia avisa e oferece "excluir a série completa", listada explicitamente. Nunca excluir parcela solta.

## 4. Fluxo WhatsApp (proposto)

```text
"excluir gastos de setembro de 2026" | "de 01/09/2026 a 30/09/2026"
  -> período explícito (ano obrigatório; sem ano -> pergunta), fuso do perfil, [início local, dia seguinte)
  -> limite: até 366 dias e até N itens (ex.: 500)
  -> prévia read-only: quantidade, soma, categorias, origens, parcelas e faturas afetadas; 0 -> encerra
  -> etapa 1: [Continuar] [Cancelar] (botão assinado, preso à sessão)
  -> etapa 2: repete o impacto; [Excluir N gastos] assinado com HMAC (domínio próprio)
     sobre user, telefone, período, contagem, soma, hash dos ids/updated_at, batch_id; validade de 10 min
  -> RPC revalida o snapshot; divergência -> aborta e pede nova prévia
  -> resposta: "N gastos excluídos. Para restaurar: 'restaurar exclusão' (até 30 dias)"
```

- A sessão fica persistida em `whatsapp_messages` (mecanismo atual), com tipo próprio.
- Pedidos de exclusão não interrompem gasto, comprovante, receita, cartão ou agenda pendentes (mesma regra de precedência usada na agenda).
- "sim" solto nunca vale como confirmação final. Não conflita com "quanto gastei em setembro" (consulta), "cancelar lembrete", receitas, contas ou cartões.
- Restauração: "restaurar exclusão" lista os lotes dos últimos 30 dias, pede confirmação assinada e chama `gastos_restaurar_lote`.

## 5. Rollout em fases

| Fase | Conteúdo | Critério de pronto | Tamanho |
|---|---|---|---|
| F2 | migration aditiva + RPCs + testes SQL num ambiente de teste com dados fictícios | restauração exata comprovada; LGPD intacta | médio |
| F3 | todos os leitores filtram (seção 2) + checagem automática no repositório que falha se aparecer `from("gastos")` sem filtro e sem marcação explícita | nenhum leitor de produção sem filtro | grande |
| F4 | fluxo WhatsApp com flag desligada; modo só-prévia primeiro | testes verdes; prévia validada | médio |
| F5 | liga a flag só para o proprietário, depois para os planos pagos | teste real de excluir e restaurar no dono | pequeno |

- Backup/restore comprovado antes da F2.
- Rollback: remover as colunas reexporia os gastos marcados. O caminho de desativação é desligar a flag (para de marcar) e corrigir para frente. Nunca remover colunas com linhas marcadas sem antes restaurar ou fazer o apagamento definitivo autorizado.

## 6. Plano de testes (futuro)

- **Datas:** mês/ano, intervalo, virada de ano, fuso/DST, ano omitido.
- **Parcelas e faturas:** grupo cortado ao meio bloqueado; série completa.
- **Somas:** bens, metas, orçamento, relatórios, faturas excluem os marcados.
- **Isolamento e permissões:** user_id, RLS, conta compartilhada.
- **Concorrência:** gasto novo ou editado durante a confirmação → aborta; clique duplo e reentrega do webhook → idempotente.
- **Botões:** token forjado, expirado ou de outro número.
- **Restauração:** exata, por lote.
- **Proteções:** importação/CSV/recibos; o desfazer atual continua funcionando; LGPD hard-delete preservado; cota free_ads.
- **Baseline:** WhatsApp 151 arquivos / 2.664 testes / 0 falhas (última execução, não rodada agora) + Agenda + typecheck.

## 7. Decisões para aprovar antes da F2

1. Parcelas: bloquear corte parcial e oferecer série completa (recomendado).
2. Janela de restauração: 30 dias; depois, os gastos continuam marcados, sem apagamento automático (recomendado; apagar exige pedido LGPD).
3. Quem pode excluir por período: só o dono da conta; compartilhados não (recomendado).
4. Abrangência: todos os gastos ativos do período, inclusive importados, com a origem exibida na prévia.
5. O desfazer imediato atual (lançamento recém-criado) e a exclusão manual do site: continuam físicos nesta etapa (recomendado, menor risco) ou passam a soft.
6. Gasto marcado não libera cota free_ads (recomendado).

## 8. Tarefa independente — botões antigos após "Ajustar"

Risco confirmado no código atual: depois de ajustar o mesmo gasto, o "Confirmar" da primeira mensagem continua válido e grava os valores corrigidos sem reexibir aquele resumo. Proposta: incluir uma versão da sessão (contador ou hash dos campos) no botão assinado e recusar versão diferente. É pequena e fica separada deste pacote.

## 9. Roadmap preservado

Opção A F1 (agora) → F2–F5 só com nova autorização → cadastro conversacional de cartões → Assistente de Compras (SerpApi BR, 10/usuário/mês, 200 global, renda de 3 meses, alerta de parcela >30% da folga, guardado intocável) → templates Meta, cron e ativação de lembretes por último. Áudio em produção ainda sem teste real.

Lacunas: corpo das funções do banco listadas (NÃO VERIFICADO); leitores dentro de `store.ts` a detalhar linha a linha na F3.

Consumo de créditos: não consigo confirmar.
