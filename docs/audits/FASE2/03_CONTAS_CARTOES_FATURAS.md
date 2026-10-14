# FASE 2 — Pacote 3: Contas, cartões e faturas

> Gravado pelo agente principal a partir do relatório do revisor desta área (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`). Texto do revisor preservado abaixo; correções do consolidador vêm primeiro.

## Notas do consolidador

- **F-01 (P0) REFUTADO.** `gastos.deleted_at` existe no banco real: foi criada pelo hotfix `drizzle/migrations/0007_hotfix_gastos_deleted_at_column.sql` e conferida no catálogo em 13/10 (ver `docs/release-candidates/PREFLIGHT_F2_UNDO_F4_2026-10-13.md` §2). O revisor procurou só em `supabase/migrations`. As consultas de fatura funcionam. Fica apenas a observação de que migrações estão em duas pastas.
- **F-04 resolvido** pelo pacote 2: `extrairValor` lê "1.950" corretamente, como 1950.

---

# Auditoria PACOTE 3 — Contas / Cartões / Faturas (WhatsApp)
**Escopo:** `src/server/{whatsapp-contas-criar,whatsapp-contas-pagar,whatsapp-contas,whatsapp-contas-lembretes,whatsapp-faturas,whatsapp-cartao-cadastro,whatsapp-limites,cartao-fatura,contas-vencimento}.server.ts` · HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707` · Read-only, sem rede/banco.

## 1. Cobertura por arquivo

| Arquivo | Linhas (wc -l) | Intervalos lidos | % | Status |
|---|---|---|---|---|
| whatsapp-contas-criar.server.ts | 1306 | 1-500, 500-1088, 1088-1306 | 100% | INTEGRAL |
| whatsapp-contas-pagar.server.ts | 955 | 1-500, 500-955 | 100% | INTEGRAL |
| whatsapp-contas.server.ts | 629 | 1-500, 500-629 | 100% | INTEGRAL |
| whatsapp-contas-lembretes.server.ts | 525 | 1-525 (full) | 100% | INTEGRAL |
| whatsapp-faturas.server.ts | 1362 | 1-500, 500-1102, 1100-1362 | 100% | INTEGRAL |
| whatsapp-cartao-cadastro.server.ts | 549 | 1-549, 497-549 | 100% | INTEGRAL |
| whatsapp-limites.server.ts | 439 | 1-439 (full) | 100% | INTEGRAL |
| cartao-fatura.server.ts | 802 | 1-500, 500-802 | 100% | INTEGRAL |
| contas-vencimento.server.ts | 217 | 1-217 (full) | 100% | INTEGRAL |

**Apoio auxiliar lido (não parte do escopo central, usado para checar as RPCs chamadas):** `supabase/migrations/20260712164128_*.sql` (whatsapp_baixa_conta_atomic hardened), `supabase/migrations/20261004120000_whatsapp_trust_foundation.sql:330-437` (whatsapp_advance_card_session/whatsapp_close_card_sessions), `docs/migrations-candidate/gastos-delete-atomic-f4.sql` (full), `docs/migrations-candidate/gastos-soft-delete-f2.sql:1-40`, `docs/audits/anexo-2-*.md` e `anexo-4-*.md` (full), `tests/contas-estorno-soft-delete.test.ts` (full, para entender `src/lib/contas-estorno.ts`, fora do pacote). `criarCartaoViaWhatsApp` (`cartao-cadastro.server.ts`) e `cartao-validacao.ts` **NÃO** fazem parte da lista pedida — citados apenas via anexo-2 (NÃO VERIFICADO nesta rodada, PARCIAL por design do escopo).

---

## 2. Inventário funcional por arquivo

### 2.1 `contas-vencimento.server.ts` (217 linhas) — base de leitura
- `todayISOInAppTz/tomorrowISOInAppTz/weekRangeInAppTz/upcomingRangeInAppTz/monthRangeInAppTz` (36-95): cálculos de janela em `America/Sao_Paulo`, sem acesso a banco.
- `getVencimentosPorPeriodo` (115-137), `getVencimentosComStatusAnterior` (144-159): sempre `.eq("user_id", userId)` + `.eq("status","pendente")`, sem `.is("deleted_at", null)` — **correto**, pois `contas_a_pagar` não tem soft-delete (não há tal coluna na tabela, confirmado por ausência de referência em todo o pacote).
- `findVencimentoByTerm` (184-210): 3 níveis de match (exato → palavra inteira → substring), **sem filtro de nome no SQL** — carrega TODAS as contas pendentes do usuário e filtra em memória; `.slice(0,12)`. Dono: `.eq("user_id", userId)` explícito. Sem teste de unidade dedicado localizado para este arquivo isoladamente (coberto indiretamente pelos testes de `whatsapp-contas-pagar` e `whatsapp-contas`).

### 2.2 `whatsapp-contas.server.ts` (629 linhas) — WA-C1, consulta (read-only)
- `detectDueIntent` (159-277): múltiplos guards negativos (valor monetário, fatura/cartão, gasto/receita/saldo) antes de aceitar léxico de "conta a pagar". Bloqueia corretamente `"Gastei R$ 35 na luz"` por conter valor.
- `handleDueIntent` (344-629): despacha para `today/tomorrow/week/month/upcoming/overdue/term`; todas chamam helpers de `contas-vencimento.server.ts` com `userId`. Paginação (`paginate`, 307-337) com `PAGE_SIZE=5`, grava `nextSession` mínimo (`{kind,mode,page,referenceMonth}` — sem IDs/valores).
- `handleDuePagination` (576-629): reconsulta do zero por `state.mode` — nunca reusa lista em memória, elimina risco de servir dado desatualizado entre páginas.
- Idempotência: N/A (somente leitura). Efeitos colaterais: nenhum. Testes: `tests/whatsapp-contas.test.ts`, `whatsapp-contas-vencimento-dia-n.test.ts`.

### 2.3 `whatsapp-contas-criar.server.ts` (1306 linhas) — WA-C2, criação
- `detectPayableAccountIntent`(276-313)/`detectFrequencia`(316-328)/`extrairDataVencimento`(375-451)/`resolveNextOccurrence`(461-493): parsing determinístico, "dia N" sem mês nunca gera data passada nem inválida (avança até 14 meses).
- `parsePayableAccountMessage` (575-614): remove tokens de data antes de chamar `extrairValor` (evita "dia 5" virar valor); `recorrente` fica `null` quando ambíguo → força pergunta explícita (nunca assume).
- `avancarFluxo` (1005-1098): máquina de estados nome→valor→vencimento→recorrência→categoria→confirmação. Categoria automática via `sugerirCategoriaKey` + fallback `"outros"` (1070-1085) — nunca bloqueia o fluxo por falta de categoria.
- `persistir` (1102-1306): **claim atômico de idempotência** via `gravarSessao(..., "conta_persistindo", ...)` com `external_id` como chave (1140-1158); quota financeira (`assertFinancialActionQuotaForWhatsApp`, `actionType:"bill_create_text"`) **depois** do claim e **antes** do insert (1162-1182); expande recorrência com `randomUUID()` por `recorrencia_id` compartilhado entre todas as ocorrências (1188-1223); **readback obrigatório** comparando `got.length !== rows.length` (1241-1258) antes de confirmar sucesso ao usuário.
- Dono/RLS: todo insert carrega `user_id: userId` do parâmetro de função (não lido do texto); `supabaseAdmin` (service_role) sem filtro adicional de leitura na gravação (insert não precisa, mas o readback seguinte usa `.eq("user_id", userId)` — correto).
- Fail-closed: sem `external_id` → bloqueia com "Não consegui salvar agora" (1122-1136), nunca insere sem idempotência.
- Testes: `tests/whatsapp-contas-criar.test.ts`.

### 2.4 `whatsapp-contas-pagar.server.ts` (955 linhas) — WA-C3, baixa (irreversível)
- `detectMarkAsPaidIntent` (177-237) + `hasMonetaryValue` (153-163): bloqueia qualquer frase com valor monetário (evita confundir baixa com gasto consumado) — inclusive formato `1.950` (milhar) via `/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/` (linha 157), **então aqui o parser de milhar está correto**, ao contrário do bug G-P0-1 descrito no anexo-2 para `whatsappParser.ts` (fora deste pacote).
- `buscarContaPorId` (445-470): sempre `.eq("user_id", userId).eq("id", contaId).eq("status","pendente")` — não pode confirmar baixa em conta de outro usuário nem já paga.
- `processarBaixaConta` (473-756): single-match → prévia direta (ou confirmação extra se `isFutureISO`); múltiplos matches → lista numerada (1-5) para escolha; qualquer estado aceita reescrita de data antes da confirmação.
- `persistirBaixa` (775-955): fail-closed sem `external_id` (791-798); quota financeira (`actionType:"bill_payment"`, `discriminator: session.contaId`) antes da RPC; chama **RPC atômica** `whatsapp_baixa_conta_atomic` (p_user_id, p_conta_id, p_data_pagamento, p_origem) — na mesma transação cria o gasto + marca `pago` + grava `gasto_id` (confirmado em `20260712164128_*.sql:9-103`); trata explicitamente `not_found/not_pending/inconsistent/noop/paid`; **readback obrigatório** comparando `readback.gasto_id !== gastoIdRet` (913-925); cancela lembretes (`cancelarLembretesDaConta`, best-effort, não bloqueia a baixa).
- RPC hardening: `SECURITY DEFINER` com guarda interna `auth.role() <> 'service_role'` → exceção (migração 20260712164128:27-30), `REVOKE ALL ... TO service_role` apenas — **authenticated/anon não conseguem chamar diretamente mesmo com RLS mal configurado**, defesa em profundidade correta.
- **Não existe nenhum fluxo de estorno/desfazer baixa via WhatsApp neste pacote** (ver achado F-02).
- Testes: `tests/whatsapp-contas-pagar.test.ts`, `whatsapp-contas-pagar-data.test.ts`, `whatsapp-contas-pagar-preserve-name.test.ts`.

### 2.5 `whatsapp-contas-lembretes.server.ts` (525 linhas) — WA-C9, lembretes (dry-run)
- `gerarLembretesContasUsuario` (182-287): gate `canCreateNotificationForUser` **fail-closed** antes de qualquer leitura (195-203, `catch` também retorna `[]`); dedupeKey determinístico `payable_due:{contaId}:{due}:{type}` — índice único `(user_id, dedupe_key)` no banco evita duplicata entre execuções concorrentes do gerador.
- `revalidateContaForDispatch` (326-365): rechecagem final antes do envio — compara `status`, `data_vencimento` e `valor_centavos` esperados vs. atuais; qualquer divergência vira `payable_changed`/`payable_paid`/`payable_cancelled` (nunca envia dado desatualizado).
- `findRecentSentLembreteForUser` (400-476): fallback pós-restart, janela de 24h, `.eq("user_id", userId)` em toda consulta, `distinct.size > 1` → `ambiguous` (nunca escolhe arbitrariamente entre duas contas).
- `renderLembreteConta` (502-523): nunca grava o texto renderizado — texto só existe no momento do envio.
- Testes: `tests/whatsapp-contas-lembretes-c9.test.ts`.

### 2.6 `whatsapp-cartao-cadastro.server.ts` (549 linhas) — cadastro de cartão, máquina de estados
- `buscarCadastroCartaoAtivo`/`transitar` (83-162): usa RPC `whatsapp_advance_card_session` com `pg_advisory_xact_lock('wa-card:'||user_id||':'||phone)` (migração 20261004120000:360-362) — serializa transições por conversa; retorna `'stale'` quando outra mensagem já avançou, `'replay'` quando `external_id` já processado — **reentrância e corrida tratadas no banco**, não apenas na aplicação.
- `detectarIntencaoCadastroCartao` (170-190): regex restritiva com `ENTIDADES_NAO_CARTAO` evitando capturar "cadastrar gasto/conta/meta" como cartão.
- `irParaConfirmacao`/`cadastrar` (257-330): checa duplicidade (`encontrarCartaoDuplicado`) **antes** da confirmação e de novo dentro de `criarCartaoViaWhatsApp` (fora do escopo lido nesta rodada — NÃO VERIFICADO diretamente, citado como coberto no anexo-2 §2.4); trata `limite_plano/sem_permissao/sem_vinculo/erro/invalido/duplicado` sem deixar estado pendente orfão.
- RPC `whatsapp_close_card_sessions`/`whatsapp_advance_card_session`: `SECURITY INVOKER`, `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT ... TO service_role` — chamada só pelo backend.
- Testes: `whatsapp-cartao-cadastro-2026-10-01.test.ts`, `whatsapp-cartao-unico-auto-2026-10-01.test.ts`, `whatsapp-cartao-nao-cadastrado-frase-2026-10-01.test.ts`.

### 2.7 `cartao-fatura.server.ts` (802 linhas) — motor financeiro reusado por WA-F*/WA-F5
- `fetchGastosDaFatura` (183-222): consulta **tripla** (`byDate`, `byYm` via `invoice_month`, `byComp` via `fatura_competencia`) + `mergeById` — cobre registros legados e novos; todas as 3 queries aplicam `.eq("user_id", userId).eq("cartao_id", cartaoId).is("deleted_at", null)`.
- `getFaturaAtualPorCartao`/`getFaturaPorMes`/`getFaturaPorCompetencia` (247-306, 463-553): filtro final em memória (`forma_pagamento==="credito"`, `confirmado!==false`, `competenciaDoGasto(...)===targetComp`) — dupla barreira SQL+memória contra vazamento de gasto de outro cartão/competência.
- `loadParcelasDoUsuario`/`buildCompraParcelada`/`isParcelaEmAberto` (620-722): só considera parcela "confiável" quando `parcela_atual` e `total_parcelas` são inteiros coerentes (`pa>=1 && tp>=2 && pa<=tp`) — nunca infere parcelamento por texto/valor.
- Todas as funções usam `.is("deleted_at", null)` na tabela `gastos` — **ver achado F-01 (crítico)** sobre a existência real dessa coluna.
- Testes: `fatura-competencia-2026-10-01.test.ts`, `fatura-parity-whatsapp-site.test.ts`.

### 2.8 `whatsapp-faturas.server.ts` (1362 linhas) — WA-F1/F2/F4
- `detectFaturaIntent`/`detectFutureFaturaIntent`/`hasFaturaPeriodCue`: separa claramente "fatura atual" de "fatura futura" para não cruzar competências.
- `handleFaturaDetailIntent`/`renderPage` (581-727): paginação com `nextSession:{kind,cartaoId,mode,page}` — sem valor/descrição persistidos; `handleFaturaPagination` (734-771) **revalida** `cartaoId` contra `loadCartoesDoUsuario(userId)` a cada chamada (não confia cegamente no estado da sessão).
- `resolveTargetInvoiceMonth`/`isBeyondHorizon` (891-1021): limita a 12 meses à frente (`MAX_MONTHS_AHEAD`), rejeita datas negativas (mês já passado sem ano explícito → ano seguinte).
- `cleanDescricaoDisplay` (461-491): normaliza visualmente sem alterar valor/categoria — nunca infere estabelecimento novo.
- Testes: `whatsapp-faturas.test.ts`, `whatsapp-faturas-detalhe.test.ts`, `whatsapp-faturas-futuras.test.ts`, `agenda-ver-fatura-2026-10-01.test.ts`.

### 2.9 `whatsapp-limites.server.ts` (439 linhas) — WA-F5
- `detectLimiteIntent` (104-180): guard de valor monetário sobre texto **bruto** (comentário explícito sobre por que não usar `norm()` — vírgulas seriam removidas e mascarariam "89,90"), evitando capturar gasto como consulta de limite.
- `handleLimiteIntent` (247-442): sempre delega o cálculo a `getResumoLimiteCartao/getResumoLimitesUsuario` (`cartao-limite.server.ts`, fora do escopo mas citado/confiado); fallback transparente quando `disponivelEstimado===null` ("não consigo comparar com segurança") em vez de inventar número.
- Testes: `whatsapp-limites.test.ts`.

---

## 3. Achados

| ID | Severidade | Confiança | Local | Descrição | Reprodução (dados fictícios) | Sugestão |
|---|---|---|---|---|---|---|
| **F-01** | **P0** | CONFIRMADO (estático) | `cartao-fatura.server.ts:198-220,370-377,490-497,621-627` (todas as queries em `gastos` com `.is("deleted_at", null)`) vs. `supabase/migrations/*.sql` (nenhum `ALTER TABLE public.gastos ADD COLUMN ... deleted_at`) vs. `docs/migrations-candidate/gastos-soft-delete-f2.sql:1-9` ("CANDIDATA — NÃO APLICADA") | Todo o motor de fatura (WA-F1/F2/F4/F5, limites, parcelas) depende de `gastos.deleted_at`. A busca exaustiva em `supabase/migrations/*.sql` não encontra nenhuma migração que crie essa coluna na tabela `gastos` (só em `receitas`, migração `20260731181756`). A migração candidata que a criaria (`gastos-soft-delete-f2.sql`) está explicitamente marcada "NÃO APLICADA" e não existe em `supabase/migrations/`. Porém `src/integrations/supabase/types.ts` **declara** `gastos.deleted_at: string \| null` como coluna real. Ou seja: (a) se a coluna de fato não existe no Postgres de produção, **toda consulta de fatura/limite/parcela falha** com erro de coluna inexistente (todas essas funções fazem `throw` em `fetchGastosDaFatura` quando `error` não é nulo — WA-F1..F5 ficariam 100% fora do ar); (b) se a coluna existe fora do controle de versão (schema drift), o repositório de migrações está desatualizado e qualquer `supabase db reset`/ambiente novo quebra o produto. | Usuário "Ana" pergunta "qual minha fatura do Nubank?" em produção; se `gastos.deleted_at` não existir na tabela real, `getFaturaAtualPorCartao` lança "Não foi possível consultar os gastos da fatura." para 100% dos usuários. | Confirmar com `\d gastos` no banco real (fora do escopo read-only desta auditoria) se a coluna existe; se existir, criar a migração retroativa correspondente em `supabase/migrations/` e aplicar a `gastos-soft-delete-f2.sql` oficialmente; se não existir, isso é um incidente em produção que precisa correção imediata, não apenas de documentação. |
| **F-02** | **P1** | CONFIRMADO (estático) | `whatsapp-contas-pagar.server.ts` (arquivo inteiro) — ausência de qualquer termo "estornar/estorno/desfazer" | O pacote WhatsApp só tem baixa de conta (`processarBaixaConta`/`persistirBaixa`, irreversível via `whatsapp_baixa_conta_atomic`). Não existe detector de intenção nem handler para "desfazer o pagamento da luz" / "cancelar baixa". A única rota de estorno existente no projeto é `src/lib/contas-estorno.ts` (client/site, fora do pacote 3), cujo próprio teste (`tests/contas-estorno-soft-delete.test.ts:155-166`) documenta explicitamente um **resíduo de corrida não-atômica**: "corrida: gasto marcado entre leitura e DELETE nunca é apagado; conta não muda (resíduo documentado)... Resíduo: o ativo g1 foi apagado sem transação — pendência F4 (RPC transacional)". A RPC atômica que resolveria isso (`estornar_conta_gastos_atomic`, `docs/migrations-candidate/gastos-delete-atomic-f4.sql:9-33`) **não está aplicada** (não existe em `supabase/migrations/`) e **não é chamada por nenhum arquivo em `src/`** (confirmado por grep vazio). | Usuário paga a conta "Luz" pelo WhatsApp (gasto `g1` criado), depois exclui esse gasto pelo app (soft-delete), depois tenta "desfazer" o estorno pelo site: a função `estornarPagamentoConta` bloqueia com `MSG_ESTORNO_GASTO_EXCLUIDO` (comportamento correto e testado), mas o usuário não tem *nenhum* caminho equivalente pelo WhatsApp — nem para estornar, nem para reabrir a conta. | Decidir produto: implementar handler de estorno no pacote WhatsApp reaproveitando a RPC `estornar_conta_gastos_atomic` (quando aprovada/aplicada) em vez do padrão não-atômico de `contas-estorno.ts`; documentar explicitamente a limitação atual na UX ("baixa pelo WhatsApp não pode ser desfeita por aqui"). |
| **F-03** | **P1** | CONFIRMADO (estático) | `contas-vencimento.server.ts:190-209` (`findVencimentoByTerm`) e reusado por `whatsapp-contas-pagar.server.ts:510` e `whatsapp-contas.server.ts:532` | O `select` não filtra por nome no SQL — carrega **todas** as contas `pendente` do usuário e filtra em memória (3 passes de `.filter`). Sem `.limit()` no `select` inicial (só o resultado final é limitado a 12). Para usuário com centenas de contas pendentes (ex.: recorrências mensais acumuladas por anos sem baixa), cada tentativa de "paguei a internet" dispara uma leitura completa da tabela antes de cortar para 12. | Usuário com 500 contas pendentes antigas (recorrência mensal nunca quitada por 40 meses) digita "paguei a luz": a função primeiro lê as 500 linhas via rede/DB antes de filtrar. | Adicionar `.ilike("nome", \`%${term}%\`)` como pré-filtro no SQL (mantendo o fallback de match exato/palavra-inteira em memória sobre o conjunto já reduzido), ou paginar a consulta inicial. |
| **F-04** | **P2** | CONFIRMADO (estático) | `whatsapp-contas-pagar.server.ts:156-157` (`hasMonetaryValue`) vs. anexo-2 §3.1 (`whatsappParser.ts:77-88`) | Este arquivo trata corretamente o formato de milhar BR sem vírgula (`/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/`) para **bloquear** falso-positivo de baixa quando há valor. Isso contrasta com o bug G-P0-1 relatado no anexo-2 para o parser de **lançamento** de gasto (`whatsappParser.ts`), que interpreta `"1.950"` como `1,95`. Achado é apenas de **inconsistência entre módulos do mesmo pipeline** — o pacote 3 (contas/cartões) não tem esse bug de leitura de milhar nos campos revisados (`extrairValor` em `whatsapp-contas-criar.server.ts` e `whatsapp-parcelamento.server.ts` não foram auditados linha a linha neste pacote: `extrairValor` é importado, não definido aqui — **NÃO VERIFICADO** diretamente se herda o bug do anexo-2). | Se `extrairValor` (de `whatsapp-parcelamento.server.ts`, fora do escopo deste pacote) tiver a mesma falha relatada no anexo-2, uma conta cadastrada via "aluguel de 1.950 todo mês" (`whatsapp-contas-criar.server.ts:586`, chama `extrairValor(textoSemData)`) seria persistida com `valorCentavos=195` em vez de `195000`. | Auditar `extrairValor` em `whatsapp-parcelamento.server.ts` (fora deste pacote) como item prioritário do próximo pacote; se confirmado o mesmo bug, ele atinge diretamente a criação de contas a pagar (valor previsto errado, sem alerta visual forte além do preview textual). |
| **F-05** | **P2** | NÃO TESTADO | `whatsapp-cartao-cadastro.server.ts` chama `criarCartaoViaWhatsApp` (`cartao-cadastro.server.ts`, fora da lista de arquivos deste pacote) | Duplicidade de cartão, vínculo de permissão/plano e idempotência de `criarCartaoViaWhatsApp` não foram lidos integralmente nesta rodada (fora do escopo do pedido). O anexo-2 afirma cobertura positiva (linhas 70-150), mas esta auditoria não validou linha a linha. | — | Incluir `cartao-cadastro.server.ts` e `cartao-validacao.ts` no próximo pacote para fechar a cadeia de confiança do cadastro de cartão. |
| **F-06** | **P2** | CONFIRMADO (estático) | `whatsapp-contas-criar.server.ts:1217-1221` (campo `import_batch_id: null` comentado como "traço de origem do batch", mas sempre `null`) | Comentário no código ("marcação mínima de origem... reaproveitado como traço de origem do batch") não corresponde ao valor real gravado (`null` fixo) — não há de fato nenhuma marcação de origem (`whatsapp`) persistida na linha de `contas_a_pagar`, diferente de `gastos.origem='whatsapp'` usado em outros pontos do sistema (ex.: RPC `whatsapp_baixa_conta_atomic`, linha 80). Isso dificulta auditoria futura de quais contas a pagar vieram do WhatsApp vs. do site. | — | Se necessário para auditoria/suporte, adicionar coluna/uso real de origem em `contas_a_pagar`, ou remover o comentário enganoso. |

---

## 4. Testes rodados

Comando: `bun test` sobre os 22 arquivos de teste locais relacionados ao pacote (sem rede, sem mocks de rede externa):
`whatsapp-contas-criar.test.ts`, `whatsapp-contas-pagar.test.ts`, `whatsapp-contas.test.ts`, `whatsapp-contas-lembretes-c9.test.ts`, `whatsapp-faturas.test.ts`, `whatsapp-faturas-detalhe.test.ts`, `whatsapp-faturas-futuras.test.ts`, `whatsapp-limites.test.ts`, `whatsapp-cartao-cadastro-2026-10-01.test.ts`, `whatsapp-cartao-unico-auto-2026-10-01.test.ts`, `whatsapp-cartao-nao-cadastrado-frase-2026-10-01.test.ts`, `fatura-competencia-2026-10-01.test.ts`, `fatura-parity-whatsapp-site.test.ts`, `whatsapp-contas-vencimento-dia-n.test.ts`, `whatsapp-contas-pagar-data.test.ts`, `whatsapp-contas-pagar-preserve-name.test.ts`, `contas-canceladas-mes.test.ts`, `contas-estorno-soft-delete.test.ts`, `agenda-ver-fatura-2026-10-01.test.ts`, `whatsapp-contas-adiar-3-31.test.ts`, `whatsapp-contas-editar.test.ts`, `whatsapp-contas-receber-consulta.test.ts`.

**Resultado exato:** `452 pass`, `2 skip` (ambos em escopo de outro pacote — recorrência "escopo SINGLE/FUTURE_PENDING" em `whatsapp-contas-editar`, não lido integralmente aqui), `0 fail`, `1645 expect() calls`, `454 tests across 22 files`, `898.00ms`. Nenhuma chamada de rede/banco real (mocks em memória, confirmado por leitura de `tests/contas-estorno-soft-delete.test.ts:20-66`, representativo do padrão usado no conjunto).

---

## 5. Lacunas

1. **F-01 não pôde ser confirmado contra o banco real** (diretiva proíbe acesso a banco) — é uma inconsistência estática grave entre migrações rastreadas e `types.ts`/código de produção; precisa de verificação com acesso de leitura ao schema real do Postgres.
2. `cartao-cadastro.server.ts`, `cartao-validacao.ts`, `cartao-limite.server.ts`, `cartao-parcelamento.server.ts`, `whatsapp-parcelamento.server.ts` (fonte de `extrairValor`) são **dependências diretas** do pacote 3 mas não estavam na lista de arquivos pedida — citados apenas via import e via anexo-2 (NÃO VERIFICADO nesta rodada).
3. Não há teste de unidade dedicado e isolado para `contas-vencimento.server.ts` (funções cobertas apenas indiretamente via testes de `whatsapp-contas*`).
4. Rate limit/quota financeira (`assertFinancialActionQuotaForWhatsApp`) é chamada corretamente nos pontos de escrita (baixa e criação de conta), mas o arquivo `whatsapp-financial-quota-gate.server.ts` em si **não fazia parte do escopo pedido** e não foi lido integralmente — seu comportamento interno (limites, janela, discriminador) é tratado aqui como caixa-preta confiável.
5. Concorrência real (duas mensagens simultâneas do mesmo usuário) só foi avaliada por leitura de código (claims atômicos, `pg_advisory_xact_lock`, RPCs `FOR UPDATE`) — não há teste de carga/concorrência real disparado nesta auditoria (fora do orçamento de testes locais determinísticos).

