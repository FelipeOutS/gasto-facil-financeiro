# Auditoria — leitura financeira do Assistente de Compras

Status: AUDITORIA APENAS / NÃO PUBLICADO / ZERO DADOS REAIS ACESSADOS OU ALTERADOS / NENHUMA CHAMADA SERPAPI / F2 NÃO APLICADA. Créditos: não consigo confirmar.

Método: leitura estática de `src/server/shopping/finance-snapshot.ts`, `whatsapp-shopping.server.ts` (`loadFinanceReadOnly`), `capacidade-compra.ts`, `src/lib/recorrencias.ts`, tipos gerados e migrations. Nenhum teste executado nesta etapa; nenhuma consulta ao banco.

## Veredito: NO-GO para ativação real

Dois motivos:
1. Bloqueio técnico: o banco real não tem `gastos.deleted_at`. Hoje a leitura de gastos falharia sempre. Isso é seguro (falha fechada, sem folga mostrada), mas a função não funciona.
2. Bloqueio de regra: contas fixas já pagas no mês somem do cálculo. Isso aumenta a folga, e o assistente pode dizer que a compra cabe quando não cabe.

## Fontes confirmadas (pelo código e pelos tipos)

| Dado | Tabela/colunas | Filtro atual | Observação |
|---|---|---|---|
| Renda | `receitas` (data, valor, descricao, origem, tipo, deleted_at existe) | user_id, 3 meses completos, `< 1º dia do mês atual` | Fuso São Paulo via `hojeSaoPaulo`; meses completos OK |
| Gastos | `gastos` (data, valor, gasto_fixo, recorrencia_id, total/parcela_atual, grupo_parcelamento_id, cartao_id, fatura_competencia) | user_id, `deleted_at null`, `data>=início OR total_parcelas>1` | `.or()` fica dentro do `eq(user_id)` (E lógico) — escopo correto |
| Assinaturas | `recorrencias` (valor, status ativa/pausada/cancelada/suspeita/aguardando, frequencia) | só user_id; código usa `ativa` + `mensal` | |
| Contas | `contas_a_pagar` (nome, valor, status pago/pendente/atrasado, gasto_id, recorrencia_id, data_vencimento) | vencimento >= mês atual; usa só o mês atual | |
| Faturas | `faturas_cartao` | não lida (correto: evita dupla contagem) | |
| Guardado/limite | `dinheiro_guardado`, `cartoes.limite` | não lidos | Confirmado: nunca somados |

Leituras usam o cliente administrativo com `userId` do servidor (vínculo verificado antes). Limite 2.000 linhas: ao atingir, falha fechada (sem análise parcial). Sem paginação.

## Tabela de evidências

| # | Arquivo/função | Regra | Classificação | Prioridade |
|---|---|---|---|---|
| 1 | `loadFinanceReadOnly` | gastos com `deleted_at` | FALHA COMPROVADA (schema real) — fecha com segurança, função inutilizável | P0 bloqueio |
| 2 | `buildFinanceSnapshot` contas | conta `pago` do mês ignorada E `gasto_fixo` excluído da média → aluguel/escola já pagos somem | FALHA COMPROVADA pelo código (folga inflada) | P0 |
| 3 | idem | `gasto_fixo` sem conta/recorrência nunca entra | FALHA COMPROVADA pelo código | P0 (mesma correção do #2) |
| 4 | contas | contas `atrasado`/`pendente` de meses anteriores ignoradas | FALHA COMPROVADA pelo código (omissão) | P1 |
| 5 | `estimarCapacidadeCompra` | mês com renda zero é tratado como "sem dado" → média só dos meses com renda (ex.: 5.000/0/0 vira média 5.000) | FALHA COMPROVADA pelo código; mitigado pelo aviso "baixa confiança" | P1 |
| 6 | variáveis | média sempre ÷3, mesmo se usuário começou há 1 mês → subestima gastos | FALHA COMPROVADA pelo código | P1 |
| 7 | contas | fatura identificada só pela palavra "fatura" no nome; "Nubank"/"cartão" duplicam com gastos de cartão | RISCO | P1 |
| 8 | recorrências | só `mensal`; anual/semanal ignoradas; gasto da assinatura sem `recorrencia_id` entra também na média → dupla contagem | RISCO | P1 |
| 9 | parcelas | séries criadas parcela a parcela vs. todas de uma vez; parcela isolada sem grupo usa id próprio | RISCO / NÃO VERIFICADO em dados reais | P2 |
| 10 | parcelas | compra parcelada no cartão: parcela conta como compromisso e não na média — correto; faturas futuras não projetadas além da parcela | RISCO | P2 |
| 11 | renda | regex de não-renda pode excluir salário com "transferência" na descrição, ou aceitar Pix entre contas sem essas palavras | RISCO | P2 |
| 12 | mensagem | parcelamento é simulação sem juros; texto de "sem juros/condição da loja" | NÃO VERIFICADO no texto final | P2 |
| 13 | falha | erro de leitura → `finance_unavailable`; resposta ao usuário sem folga | NÃO VERIFICADO o texto exibido | P2 |
| 14 | 30% | parcela > 30% da folga → "Pode apertar seu orçamento"; guardado/limite fora | CONFIRMADO no código | OK |

## Menor correção proposta (NÃO implementar sem autorização)

- P0 #2/#3: compromissos fixos do mês = maior entre (contas do mês atual, pagas ou não, sem fatura) e (média de `gasto_fixo` dos 3 meses), sem somar os dois quando a conta tem `gasto_id`. Só código puro + testes.
- P1 #5/#6: contar mês sem renda como zero quando houver qualquer movimento no mês; dividir variáveis pelos meses com atividade; se menos de 2 meses ativos → "dados insuficientes", sem folga.
- P1 #4: incluir contas em atraso como compromisso.
- P1 #7/#8: tratar conta ligada a `cartao`/banco emissor como fatura; incluir recorrências não mensais convertidas para mês; não somar na média gasto cujo valor+nome bate com recorrência ativa (ou, mais simples, avisar).
- P0 #1: não resolver aplicando F2 em produção. Opção curta: o leitor do Assistente usa uma consulta sem `deleted_at` somente enquanto F2 não existir? Não — isso reexibiria excluídos no futuro. Recomendo manter falha fechada até F2 aprovada; o Assistente só é ativado junto com F2.

## Matriz de casos fictícios (para testes futuros)

| Caso | Entrada | Esperado |
|---|---|---|
| R1 | renda 5k/5k/5k | média 5k, confiança ok |
| R2 | 5k/0/0 com gastos nos 3 meses | média 1,67k ou "insuficiente", nunca 5k |
| R3 | sem receitas | insuficiente, sem folga |
| R4 | receita no mês atual | ignorada |
| R5 | receita "Resgate", "Estorno", "Transferência entre contas" | ignoradas |
| R6 | receita 23:30 do dia 31 (fuso) | mês de São Paulo |
| C1 | aluguel conta paga no mês + gasto_fixo ligado | contado 1 vez |
| C2 | aluguel só como gasto_fixo mensal | contado 1 vez |
| C3 | conta atrasada do mês anterior | contada |
| C4 | conta "Nubank" que é fatura | não duplica gastos de cartão |
| C5 | conta com recorrencia_id ativa | contada só pela recorrência |
| S1 | Netflix recorrência + gasto sem link | contado 1 vez |
| S2 | recorrência anual 1.200 | 100/mês |
| S3 | recorrência pausada/cancelada | ignorada |
| P1 | 10x criadas de uma vez, 4ª atual | 1 parcela |
| P2 | série terminada | ignorada |
| P3 | parcela isolada sem grupo | 1 parcela |
| P4 | duas compras parceladas iguais | 2 parcelas |
| G1 | gasto soft-excluído | ignorado |
| G2 | usuário novo com 1 mês de gastos | sem subestimar ÷3 |
| L1 | 2.000 linhas | falha fechada, sem folga |
| L2 | erro em qualquer leitura | falha fechada |
| X1 | dados de outro usuário no mock | nunca aparecem |
| D1 | guardado 50k, limite 20k | não mudam a folga |
| T1 | parcela = 31% da folga | "Pode apertar seu orçamento" |

## O que dá para testar

- Totalmente com dados sintéticos (mocks/PostgreSQL local): todo o cálculo, matriz acima, falhas fechadas, 30%, isolamento por usuário no código.
- Requer ambiente Lovable SEPARADO com banco próprio e consentimento específico: comportamento com schema completo real (ownership, RLS, colunas, F2), padrões reais de cadastro (nomes de fatura, parcelas, Pix), desempenho com muitas linhas. Não criar agora (gera custo).

## Plano curto (sem aplicar F2 em produção)

1. Autorizar correção P0 #2/#3 e P1 #4/#5/#6 em código puro + matriz de testes (mocks).
2. Manter `WHATSAPP_SHOPPING_ENABLED` desligada e leitor com falha fechada.
3. Ativação real só no mesmo pacote em que F2 for aprovada e aplicada, após teste em ambiente separado.
4. P1 #7/#8 e P2 podem entrar depois como avisos ("posso estar contando sua fatura duas vezes").

## Checklist

- [x] Fontes de renda/gastos/contas/assinaturas mapeadas
- [x] Guardado e limite fora do cálculo
- [x] Escopo por usuário e falha fechada confirmados no código
- [ ] P0 fixos pagos corrigido (aguarda autorização)
- [ ] P1 renda zero/meses ativos/atrasadas (aguarda autorização)
- [ ] F2 aplicada (aguarda autorização própria)
- [ ] Teste em ambiente separado (aguarda consentimento)
