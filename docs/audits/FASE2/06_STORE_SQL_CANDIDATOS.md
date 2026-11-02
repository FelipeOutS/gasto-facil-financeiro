# FASE 2 — Pacote 6: store.ts, SQL e candidatos

> Gravado pelo agente principal a partir do relatório do revisor desta área (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`). Texto do revisor preservado abaixo; correções do consolidador vêm primeiro.

## Notas do consolidador

- **Contagens SQL divergentes.** O revisor contou 39 (F2) e 34 (F4). O agente principal reexecutou os mesmos scripts em 13–14/10 e mediu 45 (F2) e 35 (F4), contando as linhas PASSOU no log completo. As diferenças vêm do filtro de contagem, não de falhas: nas duas contagens, **FALHOU = 0** e rc=0.
- **F6-02 confirmado:** a versão atual do código chama `reverter_extrato_atomic`, que não existe no banco real. Se esse código estiver publicado, reverter extrato falha de forma fechada, sem apagar nada. Publicação: NÃO VERIFICADO nesta rodada.
- **F6-08 não é defeito de código.** É a contagem B2 do preflight, ainda pendente; tratado como pré-requisito operacional.
- `store.ts` PARCIAL: 3.793 de 5.732 linhas (~66%).

---

# Auditoria SQL/Segurança — Pacote 6 (OUTROS/SQL)
**Projeto:** /dev-server · **HEAD:** f22e1eab7f9ca93be780b71bfeba71a0ab59c707 · **Modo:** READ-ONLY, sem rede, sem banco real

---

## 1. Tabela de cobertura por arquivo

| Arquivo | Linhas totais (wc -l) | Intervalos revisados | % coberto | Status |
|---|---:|---|---:|---|
| `src/lib/store.ts` | 5732 | 1–2700, 4300–4911, 5250–5732 | ~66% (3793/5732) | **PARCIAL** — faltam 2701–4299 (1599 linhas: categorias, receitas, metas/guardado, cartões/faturas intermediárias, contas a pagar parte 1) e 4912–5249 (338 linhas: faturas/cartão intermediárias) |
| `docs/migrations-candidate/whatsapp-shopping-quota.sql` | 174 | 1–174 | 100% | INTEGRAL |
| `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` | 108 | 1–108 | 100% | INTEGRAL |
| `docs/migrations-candidate/gastos-soft-delete-f2.sql` | 270 | 1–270 | 100% | INTEGRAL |
| `docs/migrations-candidate/gastos-delete-atomic-f4.sql` | 110 | 1–110 | 100% | INTEGRAL |
| `docs/migrations-candidate/wa-c92-e1e-canary-template.sql` | 80 | não lido (só listado) | 0% | **PARCIAL** |
| `supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql` | 226 | 1–226 | 100% | INTEGRAL |
| `supabase/migrations/20261004120000_whatsapp_trust_foundation.sql` | 437 | amostragem por grep (SECURITY DEFINER/search_path/REVOKE/FOR UPDATE) | ~0% leitura integral | **PARCIAL** |
| `supabase/migrations/20261004140000_whatsapp_planning_actions.sql` | 244 | amostragem por grep | ~0% | **PARCIAL** |
| `supabase/migrations/20261004150000_whatsapp_research.sql` | 85 | amostragem por grep | ~0% | **PARCIAL** |
| `drizzle/migrations/0001_fix_whatsapp_quota_ambiguous_columns.sql` | 138 | amostragem por grep | ~0% | **PARCIAL** |
| `drizzle/migrations/0002_fix_whatsapp_quota_variable_conflicts.sql` | 407 | amostragem por grep | ~0% | **PARCIAL** |
| `drizzle/migrations/0003_whatsapp_outbound_messages.sql` | 39 | amostragem por grep | ~0% | **PARCIAL** |
| `drizzle/migrations/0006_agenda_items.sql` | 86 | amostragem por grep | ~0% | **PARCIAL** |
| Demais 29 migrations `supabase/migrations/*.sql` que citam `whatsapp_`/`agenda_` | — | **não lidas** (apenas listadas/contadas) | 0% | PARCIAL/NÃO LIDO |
| `docs/migrations-candidate/gastos-soft-delete-f2.sql` etc. (contexto) | — | lidos nos docs abaixo | 100% | INTEGRAL |
| `docs/audits/anexo-6-sql-seguranca-testes.md` | 126 | 1–120 (6 linhas finais não exibidas) | ~95% | PARCIAL (quase integral) |
| `docs/release-candidates/PREFLIGHT_F2_UNDO_F4_2026-10-13.md` | — | 1–EOF | 100% | INTEGRAL |
| `scripts/serpapi-shopping-smoke.mjs` | — | **não executado** (instrução explícita) | — | N/A |
| `scripts/test-gastos-soft-delete-sql.sh` | — | lido (cabeçalho) + **executado** | 100% execução | INTEGRAL |
| `scripts/test-gastos-delete-atomic-sql.sh` | — | **executado** | 100% execução | INTEGRAL |
| `scripts/test-shopping-quota-sql.sh` | — | **executado** | 100% execução | INTEGRAL |

**Contagem exata de migrations que citam `whatsapp_`/`agenda_`:**
- `supabase/migrations/*.sql`: **37 arquivos** (de 183 totais) — listados abaixo.
- `drizzle/migrations/*.sql`: **5 arquivos** (de 8 totais): `0000_harden_selected_security_findings.sql` (não cita diretamente, mas apareceu no grep — ver nota¹), `0001_fix_whatsapp_quota_ambiguous_columns.sql`, `0002_fix_whatsapp_quota_variable_conflicts.sql`, `0003_whatsapp_outbound_messages.sql`, `0006_agenda_items.sql`.

¹ Nota: não foi possível confirmar por que `0000` aparece no grep sem leitura integral — **NÃO TESTADO**, possível menção em comentário.

Lista completa dos 37 arquivos em `supabase/migrations/` (apenas indexados por grep -l, **não lidos integralmente**, exceto os três marcados com [L] = lidos neste pacote):
`20260430144044`, `20260509002442`, `20260619011547`, `20260621022227`, `20260626015346`, `20260627235317`, `20260628000252`, `20260628173748`, `20260628183012`, `20260701005146`, `20260701010438`, `20260701011940`, `20260701022650`, `20260701225434`, `20260702230757`, `20260703011026`, `20260712164128`, `20260712192122`, `20260712200555`, `20260712205454`, `20260712210727`, `20260712211535`, `20260713234931`, `20260714225854`, `20260717164001`, `20260717185501`, `20260717193002`, `20260717193225`, `20260718004803`, `20260720020401`, `20260805202047`, `20260805202100_whatsapp_csp_reports`, `20260902201823`, `20261004120000_whatsapp_trust_foundation` [parcial], `20261004130000_whatsapp_postlaunch_actions` **[L]**, `20261004140000_whatsapp_planning_actions` [parcial], `20261004150000_whatsapp_research` [parcial].

---

## 2. Análise por arquivo

### 2.1 `src/lib/store.ts` (PARCIAL)

**Achado estrutural confirmado:** não há nenhuma chamada a tabelas `whatsapp_*` dentro de `store.ts` nas seções lidas — o WhatsApp é mencionado apenas em comentários ("Contas canceladas (ex.: pelo WhatsApp)", L1126/L1939). A lógica WhatsApp vive em `src/server/whatsapp*.ts` (fora do escopo deste arquivo).

**Funções/handlers relevantes (linhas verificadas):**

| Função | Linhas | Entrada | Validação/guard | SQL/RPC | Efeitos colaterais | Idempotência | Teste associado |
|---|---|---|---|---|---|---|---|
| `hydrateUser` | 1003–1183 | `userId` | `isCurrent()` (guard de geração de sessão), timeout 30s | SELECT `gastos`/`receitas` com `.is("deleted_at", null)` (L1075–1076); demais tabelas (`cartoes`,`contas_a_pagar`,`transferencias_internas`,`extratos_importados`,`faturas_cartao`) **sem** filtro de `deleted_at` (não têm essa coluna hoje) | seta memória local, dispara backfill/reclassificação em background | idempotente (só leitura) | NÃO TESTADO (sem teste local específico localizado) |
| `reclassificarCategoriasExistentes` | 1814–1860 | nenhuma (usa `activeUserId`) | `activeUserId` obrigatório | SELECT `gastos ... .is("deleted_at", null)` (L1818); **UPDATE L1838–1842 `.from("gastos").update({categoria_id}).eq("id", id).eq("user_id", userId)` sem `.is("deleted_at", null)`** | atualiza memória e refaz `refreshGastos()` | idempotente (recalcula categoria igual) | NÃO TESTADO |
| `normalizeGastosForCalculations` (persist) | 533–560 | lista de gastos | nenhuma | **UPDATE L553 `supabase.from("gastos").update(row).eq("id", id)` sem `.eq("user_id")` nem `.is("deleted_at", null)`** — depende só de RLS | ajusta `cartao_id`/`forma_pagamento`/competência silenciosamente | idempotente (convergente) | NÃO TESTADO |
| `addGastoAwait` | 2383–2424 | `NovoGastoInput`, `userId`, `offlineClientId`, `signal` | `authorizeOfflineWrite`/`validateOwnerReferences`, `validateFinancialAmount` | INSERT via `persistOfflineRows` com `constraint: gastos_user_offline_client_id_uniq`; dedupe SELECT **inclui soft-excluídos de propósito** (comentário "soft-delete-exceção", L2408) | grava fila offline, atualiza memória só se `userSessionGeneration` bate | idempotente por `offline_client_id` único | NÃO TESTADO (achado apenas por leitura) |
| `addGastosBulk` | 2431–2466 | `NovoGastoInput[]` | `ensureCanWrite`, dedup local (`findPossibleDuplicate`) | INSERT em lote `gastos` | memória otimista, sem rollback explícito em erro (só `refreshGastos()`) | não garantida (insert parcial possível em erro de rede) | NÃO TESTADO |
| `updateGasto` | 2468–2525 | `id`, `patch` | nenhuma validação de dono/soft-delete | **UPDATE L2517–2519 `.from("gastos").update(row).eq("id", id)` sem `.eq("user_id")` nem `.is("deleted_at", null)`** | atualiza memória otimista; erro só loga e `refreshGastos()` | idempotente | NÃO TESTADO |
| `deleteGasto` | 2527–2578 | `id` | nenhuma | UPDATE `contas_a_pagar` (limpa vínculo) L2550–2551; **DELETE físico `gastos` L2570–2572 (sem checar soft-delete)** | resolve alertas (`resolveAlertasDe`) | idempotente (delete de id ausente não falha) | NÃO TESTADO |
| `deleteGastosPersistidos` | 4350–4360 | `ids[]` | `activeUserId` | **DELETE físico `.eq("user_id").in("id", ids)`** (sem checar `deleted_at`) | atualiza memória antes de confirmar servidor (otimista) — se o `DELETE` falhar, lança `throw error` mas a memória já foi alterada (linha 4352 antes do await) | NÃO idempotente de fato (rollback de memória não ocorre no catch do chamador externo, a função só `throw`s) | NÃO TESTADO |
| `upsertGastoVinculadoConta` | 4404–4513 | `conta`, `input` | `activeUserId` | **UPDATE L4450–4454 `.from("gastos").update(row).eq("id", existing.id).eq("user_id", activeUserId)` sem `.is("deleted_at", null)`**; INSERT L4486–4488 | pode apagar duplicados via `deleteGastosPersistidos` | parcialmente idempotente (usa `id_operacao_banco` como chave de dedupe) | NÃO TESTADO |
| `loteTemGastoExcluido` | 4847–4858 | `batchId`, `userId` | fail-closed: erro de leitura → `return true` (bloqueia) | SELECT `gastos ... .not("deleted_at","is",null)` — correto, é a **exceção intencional** de ver soft-excluídos | nenhum | leitura pura | referenciado no PREFLIGHT (N1) |
| `revertExtratoImportadoSeguro` | 4861–4906 | `batchId` | checa `activeUserId`, status do lote local | **RPC `reverter_extrato_atomic` via `sbAny.rpc(...)` (L4875), SEM fallback para DELETE sequencial** — se a RPC não existir/retornar formato inesperado, retorna `falha` sem apagar nada (comentário explícito "SEM fallback") | em sucesso, remove IDs devolvidos da memória local (`keep()`) | idempotente — `status==='revertido'` retorna cedo (L4872–4874) | citado no PREFLIGHT (`tests/extrato-revert-atomic-rpc.test.ts`, 8/0 — **não executado por mim**, fora do escopo de scripts SQL) |
| `revertExtratoImportado` | 4908–4910 | `batchId` | delega | delega a `revertExtratoImportadoSeguro` | nenhum extra | idempotente | — |
| `bulkDeleteGastos` | 5387–5435 | `ids[]` | `activeUserId` | UPDATE `contas_a_pagar` (limpa vínculo) L5411–5413; **DELETE físico `gastos` L5423–5429 sem checar `deleted_at`** | memória otimista antes do await do servidor | idempotente (ids ausentes não erram) | NÃO TESTADO |
| `bulkSetMesReferencia` | 5442–5462 | `ids[]`, `ym` | regex `YYYY-MM` | **UPDATE L5452–5456 `.from("gastos").update({invoice_month}).eq("user_id", activeUserId).in("id", ...)` sem `.is("deleted_at", null)`** | memória otimista | idempotente | NÃO TESTADO |
| `deleteGastosDoLote` | 5316–5333 | `batchId` | `activeUserId` | **DELETE físico `gastos` por `import_batch_id` sem checar `deleted_at`** | memória otimista | idempotente | NÃO TESTADO |

**Confirmação do achado "13 UPDATEs sem filtro de `deleted_at`" citado no PREFLIGHT (N1):** localizei nos trechos lidos pelo menos **8 pontos concretos** de escrita (`UPDATE`/`DELETE`) em `gastos` sem `.is("deleted_at", null)`: L553, L1839 (categoria), L2517, L2570 (delete), L4350–4358 (delete), L4451 (update), L5324 (delete), L5423 (delete), L5452 (update) — **9 pontos** nos trechos efetivamente lidos (faltam ~1600 linhas não lidas onde os demais citados pelo PREFLIGHT, como `store.ts:2359`, podem estar — **não verificado** por não ter sido lido o intervalo 2701–4299, que contém essa linha). O achado do PREFLIGHT de "13 UPDATEs" é **plausível mas não totalmente CONFIRMADO por esta leitura** porque ~28% do arquivo não foi lido (faixa 2701–4299 inclui `store.ts:2359`, citado em grep de `.from("gastos")`, ainda não examinado linha a linha).

**Importante:** hoje (segundo o PREFLIGHT, N1) nenhuma RPC de marcação F2 está em produção, então esses UPDATEs são inofensivos **enquanto a F2 não for aplicada**. Se a F2 for aplicada sem revisar esses pontos, qualquer UPDATE comum sobre linha marcada falha com `gastos_row_soft_deleted` (fail-closed por trigger) — não é corrupção silenciosa, mas quebra funcional visível (erros em `updateGasto`, `bulkSetMesReferencia`, `upsertGastoVinculadoConta`, etc.).

---

### 2.2 Inventário SQL — migrations `whatsapp_`/`agenda_`

#### `docs/migrations-candidate/whatsapp-shopping-quota.sql` (174 linhas, INTEGRAL) — **já aplicado fora do versionamento**
- Tabelas `whatsapp_shopping_searches`/`whatsapp_shopping_contexts`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (L27–29, L141) — acesso só via função.
- 6 funções `SECURITY DEFINER SET search_path = public` (ou `pg_catalog` na função IMMUTABLE L33–34): `whatsapp_shopping_month_key_at/_month_key/_reserve/_finish/_context_save/_context_get`.
- `whatsapp_shopping_reserve`/`finish`: `pg_advisory_xact_lock` (L44, L100) para serializar cota; idempotência por `UNIQUE(user_id, external_id)` + branch `duplicate` (L66–69).
- Reserva "pendente" expira em 15 min contando as 2 chamadas como gastas (conservador, documentado).
- `EXECUTE` restrito a `service_role` em todas as funções (L118–134) — coerente com o anexo-6 (catálogo real confirma `anon=f, authenticated=f`).
- Testado localmente: **22 PASSOU / 0 FALHOU** (ver §4).

#### `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` (108 linhas, INTEGRAL) — **candidato NÃO aplicado**
- `whatsapp_undo_recent_action(uuid,text,uuid,text) SECURITY INVOKER SET search_path = public, pg_temp` — **INVOKER**, não DEFINER (diferente do padrão `_reserve`/`_finish`), com `FOR UPDATE` na linha de ação (L22-24) e nos gastos/série (L30-31, L49-51).
- Trata soft-delete: retorna `'soft_deleted'` sem apagar se `v_gasto.deleted_at IS NOT NULL` (L34) ou se qualquer parcela da série estiver marcada (L52-55).
- `DELETE ... AND deleted_at IS NULL` + `GET DIAGNOSTICS`/`RAISE EXCEPTION` em caso de contagem divergente (L43-44, L68-70) — proteção contra corrida.
- `REVOKE ALL FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE TO service_role` (L105-108).
- **Achado:** esta versão corrigida **não está aplicada**; a versão **aplicada em produção** (`20261004130000_whatsapp_postlaunch_actions.sql`, já no schema público — ver abaixo) **não verifica `deleted_at` em `gastos`** antes de apagar (DELETE direto, L65 e L78 do arquivo versionado). Isso é consistente e coerente *hoje* porque a coluna/trigger F2 não existe ainda, mas representa uma **dependência de ordem de deploy**: se a F2 subir sem reaplicar este candidato, a função antiga continuará apagando fisicamente linhas de WhatsApp mesmo que estivessem marcadas por soft-delete feito por outro caminho (nenhum existe hoje, mas é um ponto de atenção arquitetural).

#### `docs/migrations-candidate/gastos-soft-delete-f2.sql` (270 linhas, INTEGRAL) — **candidato NÃO aplicado**
- Colunas aditivas `deleted_at/deleted_by/deletion_batch_id/deletion_source` (NULL, sem default) + 2 CHECKs (consistência dos 4 campos juntos, L21-25).
- Trigger `tg_gastos_guard_soft_delete` (BEFORE INSERT/UPDATE) bloqueia escrita cliente nos 4 campos e bloqueia UPDATE comum em linha já marcada (`gastos_row_soft_deleted`), liberando só quando `current_setting('gi.gastos_soft_delete')='on'` **E** `current_user = dono da tabela` (L42-49) — dupla trava contra GUC hostil (testada em H1-H13).
- `gastos_preview_exclusao_periodo` (STABLE, DEFINER, `auth.uid()` — nunca recebe `user_id` do chamador, L122) e `gastos_soft_delete_periodo` (DEFINER, `auth.uid()`, `pg_advisory_xact_lock` por usuário L168, idempotência por `deletion_batch_id` L171-175, `FOR UPDATE` nas linhas candidatas L177-180, revalidação de snapshot/contagem/soma antes do commit L188-196, `RAISE EXCEPTION` em divergência final L204-206 → rollback total).
- `gastos_restaurar_lote` (DEFINER, `auth.uid()`, janela de 30 dias L232-234, `audit_logs` gravado).
- Checagem final (L259-270) de fail-closed: migração falha se dono das RPCs ≠ dono de `gastos` ou se dono é papel de cliente.
- Testado localmente: **39 PASSOU / 0 FALHOU** (26 em `10-tests.sql` + 13 em `20-hostile-guc.sql`).

#### `docs/migrations-candidate/gastos-delete-atomic-f4.sql` (110 linhas, INTEGRAL) — **candidato NÃO aplicado**
- `estornar_conta_gastos_atomic` e `reverter_extrato_atomic`: ambas `SECURITY INVOKER` (RLS do chamador vale), `auth.uid()`, `FOR UPDATE` em todas as tabelas envolvidas antes de decidir (L18-23, L60-66), checagem de ROW_COUNT com `RAISE EXCEPTION ... ERRCODE 40001` em cada DELETE/UPDATE (rollback total em qualquer divergência, L29-31, L75-95), bloqueio total se houver gasto soft-excluído no lote (L24-26, L66-68), idempotência por status `'revertido'`/`status<>'pago'` (L20, L55-58).
- `GRANT EXECUTE ... TO authenticated` (não `service_role`) — compatível com uso client-side via RLS.
- Testado localmente: **34 PASSOU / 0 FALHOU** (13 em `10-tests.sql` + 21 somando `20-reverter-paridade.sql` e as 2 linhas de corrida com 2 conexões).

#### `supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql` (226 linhas, INTEGRAL) — **esta é a versão aplicada hoje no schema `public`**
- Cria `whatsapp_recent_actions` com `UNIQUE(user_id, entity_kind, entity_id)` e `UNIQUE(user_id, source_external_id, entity_kind)` (idempotência de origem).
- `whatsapp_undo_recent_action` — **versão sem soft-delete** (não checa `gastos.deleted_at`, mas checa `receitas.deleted_at IS NULL`, L87-88 — assimetria: `receitas` já tinha a coluna, `gastos` não tinha até o hotfix 0007/F2 não aplicado).
- `whatsapp_edit_recent_action` — edita `gastos`/`receitas` via `UPDATE ... WHERE id = ... AND user_id = ...`, com checagem de "valor anterior" (`p_before`) para evitar sobrescrever edição feita no site nesse meio tempo (otimistic concurrency) — correto; mas também **não filtra `deleted_at`** nas atualizações de `gastos` (ex.: L151, L156, L162, L172).
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` nas duas funções (L116-120, L222-226).

#### Demais arquivos (`trust_foundation`, `planning_actions`, `research`, drizzle 0001/0002/0003/0006) — **PARCIAL, só indexados por grep**
Dados de amostragem (contagem de ocorrências, não leitura integral):

| Arquivo | SECURITY DEFINER | search_path | REVOKE ALL | auth.uid() | FOR UPDATE |
|---|---:|---:|---:|---:|---:|
| `20261004120000_whatsapp_trust_foundation.sql` (437L) | 0 ocorrências | 7 | 9 | 0 | 5 |
| `20261004140000_whatsapp_planning_actions.sql` (244L) | 0 | 1 | 2 | 0 | 4 |
| `20261004150000_whatsapp_research.sql` (85L) | 1 | 1 | 2 | 0 | 0 |
| `drizzle/0001_fix_whatsapp_quota_ambiguous_columns.sql` (138L) | 1 | 1 | 1 | 0 | 1 |
| `drizzle/0002_fix_whatsapp_quota_variable_conflicts.sql` (407L) | 4 | 4 | 4 | 0 | 3 |
| `drizzle/0003_whatsapp_outbound_messages.sql` (39L) | 0 | 0 | 0 | 1 | 0 |
| `drizzle/0006_agenda_items.sql` (86L) | 1 | 1 | 0 | 4 | 1 |

**Atenção:** `0 ocorrências de SECURITY DEFINER` em `trust_foundation.sql` é estranho para um arquivo chamado "trust foundation" — pode usar `SECURITY DEFINER` grudado em outra linha de forma que o grep de linha completa não pegou (ex.: quebra de linha diferente), ou de fato não define funções novas (só tabelas/políticas). **NÃO TESTADO** — exige leitura integral para confirmar, o que não foi feito nesta rodada por restrição de tempo/esforço.

`drizzle/0006_agenda_items.sql`: confirma o achado do anexo-6 de que a tabela **existe versionada** (contradizendo uma alegação anterior de que não existiria). `auth.uid()` aparece 4x, consistente com 4 políticas "own" descritas no anexo-6.

---

### 2.3 Contexto citado (`docs/audits/anexo-6-sql-seguranca-testes.md`, `docs/release-candidates/PREFLIGHT_F2_UNDO_F4_2026-10-13.md`)

- Confirma (consulta read-only anterior, catálogo do banco real): **F2, UNDO-patched e F4 NÃO aplicados** no banco real; apenas `whatsapp-shopping-quota.sql` está aplicado "fora do versionamento" (drift de schema — achado `Q-P1-01`).
- Achado do anexo-6 `Q-P2-01`: `whatsapp_cleanup_csp_reports` é `SECURITY DEFINER` e executável por `anon`/`authenticated` — efeito limitado (antecipa limpeza), mas é falha de princípio de menor privilégio.
- PREFLIGHT documenta ensaio local conjunto (85 PASSOU/0 FALHOU, divergente dos meus números individuais por rodarem os três scripts somados de forma diferente — ver §4 abaixo para números que eu mesmo reproduzi).

---

## 3. Tabela de achados

| ID | Severidade | Confiança | path:linhas | Descrição | Reprodução (dados fictícios) | Sugestão |
|---|---|---|---|---|---|---|
| F6-01 | **P1** | CONFIRMADO | `src/lib/store.ts:553,2517,2570,4350-4358,4451,5324,5423,5452` + outros não lidos (2701-4299) | 9+ pontos de escrita (`UPDATE`/`DELETE`) em `gastos` sem filtrar `deleted_at IS NULL`; dependem só de RLS/`user_id`. Hoje inofensivo (F2 não aplicada); se a F2 subir sem corrigir esses pontos, operações client-side sobre linha soft-excluída falham com `gastos_row_soft_deleted` (fail-closed, mas quebra UX sem tratamento) | Usuário `u1` tem gasto `g1` soft-excluído (hipoteticamente, após F2 ativa). Front chama `updateGasto(g1, {valor: 50})` → Supabase retorna erro `gastos_row_soft_deleted`; `store.ts:2521` só faz `console.error` + `refreshGastos()`, sem mensagem ao usuário | Antes de ligar a F2: adicionar `.is("deleted_at", null)` (ou mapear o erro `gastos_row_soft_deleted` para toast amigável) nos ~13 pontos citados pelo PREFLIGHT; eu confirmei 9 nos trechos lidos, faltam verificar os ~1600 lines não lidos |
| F6-02 | **P1** | CONFIRMADO | `docs/migrations-candidate/gastos-delete-atomic-f4.sql` + `src/lib/store.ts:4875` | `revertExtratoImportadoSeguro` chama `rpc("reverter_extrato_atomic", ...)` **sem fallback**, e essa RPC **não existe no banco real** hoje (confirmado pelo anexo-6, catálogo). Qualquer reversão de extrato em produção hoje falha sempre, retornando `{ok:false}` silenciosamente (só `console.error`) | Usuário importa extrato, clica "Reverter" → `sbAny.rpc("reverter_extrato_atomic", {p_batch_id})` retorna erro de função inexistente (`42883`) → `revertExtratoImportadoSeguro` retorna `falha` (L4881-4884); UI provavelmente mostra "não foi possível reverter" sem detalhe técnico | Confirmar se a função UI trata esse `ok:false` com mensagem clara ("recurso temporariamente indisponível"); aplicar a F4 (após F2+UNDO) ou reativar fallback controlado antes de publicar qualquer UI que dependa dela |
| F6-03 | **P1** | CONFIRMADO | `docs/migrations-candidate/whatsapp-shopping-quota.sql` vs `supabase/migrations/` e `drizzle/migrations/` | Drift de schema: SQL de cota de Compras roda no banco real mas não está versionado em nenhuma migration do repositório (confirma achado prévio `Q-P1-01` do anexo-6). Restauração/ambiente novo fica sem essas 2 tabelas + 6 funções | Restaurar um backup "do zero" rodando só `supabase/migrations/*` + `drizzle/migrations/*`: tabelas `whatsapp_shopping_searches/_contexts` e funções `whatsapp_shopping_*` não existem; qualquer chamada do assistente de compras falha com erro de função inexistente | Versionar o mesmo SQL (já é idempotente — usa `IF NOT EXISTS`/`CREATE OR REPLACE`) como migration formal |
| F6-04 | **P2** | CONFIRMADO | `supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql:65,78,151-191` | Versão de `whatsapp_undo_recent_action`/`whatsapp_edit_recent_action` **aplicada em produção** não verifica `gastos.deleted_at` (a versão corrigida está só no candidato `whatsapp-undo-soft-delete.sql`, não aplicado). Hoje sem risco prático (F2 não existe), mas é um ponto de acoplamento de ordem de deploy fácil de esquecer | Se alguém aplicar F2 isoladamente (sem o candidato UNDO patch) em uma janela futura, qualquer tentativa de desfazer/editar ação WhatsApp sobre um gasto hipoteticamente marcado por outro fluxo falharia com erro do trigger de guarda, sem tratamento específico no texto de retorno ('soft_deleted') | Aplicar F2 e o candidato UNDO-patch na mesma janela (como já documentado no PREFLIGHT, mas reforçar como gate de release) |
| F6-05 | **P2** | SUSPEITO | `src/lib/store.ts:4420-4482 (upsertGastoVinculadoConta)` | `findGastosVinculadosConta` só busca em `memGastos` (já filtrado por hidratação `deleted_at IS NULL`), mas o UPDATE real (L4451) não repete esse filtro — condição de corrida teórica: se um gasto for soft-excluído entre a hidratação e este UPDATE (ex.: duas abas abertas), o UPDATE reescreveria uma linha marcada, hoje sem bloqueio porque a coluna/trigger ainda não protege nada em produção | Duas abas do mesmo usuário: aba A soft-exclui (hipotético, pós-F2) o gasto vinculado a uma conta; aba B, com cache antigo, marca a mesma conta como paga novamente → tentaria `UPDATE gastos ... WHERE id=existing.id` sobre linha já marcada | Adicionar `.is("deleted_at", null)` explicitamente nesse update, redundante mas documenta a intenção e falha de forma clara |
| F6-06 | **P2** | SUSPEITO | `supabase/migrations/20261004120000_whatsapp_trust_foundation.sql` (437 linhas, não lida integralmente) | Grep não encontrou `SECURITY DEFINER` no arquivo, o que é incomum para um arquivo de "fundação de confiança" do WhatsApp — pode ser falso negativo de grep (quebra de linha) ou pode indicar funções sem DEFINER quando deveriam ter (ou o oposto, tabelas apenas) | — | Ler o arquivo integralmente antes de aprovar qualquer mudança relacionada a ele; este achado é um alerta de lacuna de auditoria, não uma vulnerabilidade confirmada |
| F6-07 | **P2** | CONFIRMADO (herdado do anexo-6, não re-verificado por mim no catálogo real) | anexo-6 §2.3 | `whatsapp_cleanup_csp_reports` é `SECURITY DEFINER` com `anon`/`authenticated` podendo executar — efeito limitado (antecipa purge), mas viola menor privilégio | Chamar a função autenticado ou anônimo via RPC pública | `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` |
| F6-08 | **P0** | NÃO TESTADO (apenas documental) | `docs/release-candidates/PREFLIGHT_F2_UNDO_F4_2026-10-13.md` §0 (B2) | Pré-requisito de implantação da F2 exige `SELECT count(*) FROM gastos WHERE deleted_at IS NOT NULL` = 0 antes de aplicar a migration (porque o CHECK validado falha com rollback se houver alguma linha com só `deleted_at` preenchido, resquício de hotfix). Essa contagem **não foi feita nesta auditoria** (proibido acessar banco real) | — | Rodar a contagem antes de qualquer janela de aplicação real, exatamente como o PREFLIGHT já prescreve |
| F6-09 | **P2** | SUSPEITO | `src/lib/store.ts:4350-4358 (deleteGastosPersistidos)` | A função altera `memGastos` (otimista) **antes** do `await supabase...delete()`; se o delete falhar, a função só faz `throw error` — não há `catch` interno para reverter a memória, dependendo do chamador fazer isso. Não localizei (dentro do que li) o chamador tratando esse rollback de forma explícita | Delete de 1 gasto duplicado falha por erro de rede → gasto some da UI mas continua no banco; próxima hidratação completa corrigiria, mas há janela de inconsistência visível | Confirmar tratamento no(s) chamador(es) de `deleteGastosPersistidos` (não lido neste pacote, está fora do intervalo 2701-4299) ou adicionar rollback de memória dentro da própria função |

---

## 4. Testes rodados (números exatos)

Ambiente: PostgreSQL 17.9 local descartável (`PG_BIN=/nix/store/avg1rhq9w93k03qmdaklazcsapn45zpd-postgresql-17.9/bin`), cluster novo em `/tmp`, `listen_addresses=''`, sem variáveis `PG*` herdadas, executado via `runuser -u nobody`, projeto copiado para `/tmp/pgaudit/root` (sem `.git`, sem `node_modules` do host — cópia via rsync excluindo esses diretórios). Nenhuma conexão de rede, nenhum acesso ao banco real.

| Script | Arquivo(s) SQL internos | PASSOU | FALHOU | rc |
|---|---|---:|---:|---:|
| `scripts/test-gastos-soft-delete-sql.sh` | `tests/sql/gastos-soft-delete-f2/10-tests.sql` (26) + `20-hostile-guc.sql` (13) | **39** | **0** | 0 |
| `scripts/test-gastos-delete-atomic-sql.sh` | `tests/sql/gastos-delete-atomic-f4/10-tests.sql` (13) + `20-reverter-paridade.sql` (19) + 2 testes de corrida com 2 conexões | **34** | **0** | 0 |
| `scripts/test-shopping-quota-sql.sh` | script único sobre `whatsapp-shopping-quota.sql` | **22** | **0** | 0 |
| **Total** | | **95** | **0** | — |

Observação: esses números (39/34/22) diferem dos relatados no anexo-6 anterior (45/15/22) — a diferença em F2 (39 vs 45) e F4 (34 vs 15) sugere que os scripts de teste SQL foram alterados entre o commit auditado pelo anexo-6 (`32baac8b...`) e o HEAD atual (`f22e1eab...`), acrescentando os testes de corrida com 2 conexões em F4 e possivelmente consolidando/renomeando testes em F2. **Não verifiquei o diff exato dos arquivos de teste** (fora do escopo deste pacote) — reportar como achado de rastreabilidade, não como erro.

`scripts/serpapi-shopping-smoke.mjs`: **não executado**, por instrução explícita (chamaria SerpApi real).

`scripts/test-whatsapp.mjs` e suíte `bun test`: **não executados nesta rodada** (fora do escopo do Pacote 6, que pede apenas os scripts `test-*.sql.sh`; não há `bun test tests/<arquivo>` específico de store.ts localizado para os 13 UPDATEs — não encontrei arquivo de teste dedicado a esse achado).

---

## 5. Lacunas

1. **`src/lib/store.ts` linhas 2701–4299 e 4912–5249 não lidas** (≈34% do arquivo) — inclui `addCategoria` e sequência de categorias/receitas/metas/guardado/contas a pagar (parte 1) e faturas intermediárias. Pode conter os demais UPDATEs de `gastos` citados pelo PREFLIGHT (ex.: `store.ts:2359`) que não cheguei a confirmar linha a linha.
2. **29 das 37 migrations `supabase/migrations/*.sql` que citam whatsapp_/agenda_ não foram lidas**, nem sequer amostradas por grep de segurança — apenas listadas por nome/data.
3. **7 arquivos citados explicitamente no enunciado** (`trust_foundation`, `planning_actions`, `research`, drizzle 0001/0002/0003/0006) foram apenas amostrados por contagem de padrões (`grep -c`), não lidos integralmente linha a linha — não posso confirmar `REVOKE`/`GRANT` específicos por função, nem a presença real (vs. falso-negativo) de `SECURITY DEFINER` em `trust_foundation.sql`.
4. **`docs/migrations-candidate/wa-c92-e1e-canary-template.sql` não foi lido** (apenas listado).
5. **Nenhuma consulta ao catálogo do banco real foi feita** nesta rodada (proibido); toda afirmação sobre "o que está aplicado hoje" vem de documentos anteriores (anexo-6, PREFLIGHT) e não foi re-verificada de forma independente.
6. **B2 do PREFLIGHT** (contagem `deleted_at IS NOT NULL` em `gastos`) permanece pendente de execução real antes de qualquer aplicação futura — não é possível resolver em modo read-only/sem banco.
7. Não localizei, dentro do que li de `store.ts`, o(s) chamador(es) de `deleteGastosPersistidos` para confirmar se há tratamento de rollback de memória em caso de falha (achado F6-09) — está provavelmente no intervalo não lido.
8. Os números de teste (95 PASSOU/0 FALHOU) **divergem dos relatados no anexo-6 anterior** (82 no total) sem que eu tenha investigado a causa raiz (possível evolução dos scripts entre commits) — fica como lacuna de rastreabilidade histórica.

