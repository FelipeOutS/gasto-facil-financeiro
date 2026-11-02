# Pré-implantação F2 → WhatsApp UNDO → F4 — 13/10/2026

**Status: PREFLIGHT PREPARADO. Nada aplicado, nada publicado.**

| Item | Valor |
|---|---|
| HEAD | `3a8e55399cd853a4ca1b3050b495b4c5c4d34017` |
| Banco real | **sem alteração**. Consultas feitas somente ao catálogo (`information_schema`, `pg_catalog`, `pg_policies`, `has_*_privilege`), sem ler nenhuma linha de tabela |
| Testes | todos em PostgreSQL 17 local descartável (`listen_addresses=''`, socket em `/tmp`, sem variáveis `PG*`) |

## 0. Veredito

| Escopo | Resultado |
|---|---|
| SQL × schema real (colunas, tipos, owners, RLS, triggers, assinatura do undo) | **GO técnico**: nenhum mismatch bloqueante encontrado |
| Ensaio local conjunto F2 → UNDO → F4 (cada arquivo aplicado 2×) | **GO**: 85 PASSOU / 0 FALHOU |
| Implantação real | **NO-GO hoje**. Faltam três pré-requisitos que não podem ser feitos nesta etapa: B1, B2 e B3 abaixo |

### Bloqueantes de implantação (não são defeitos de SQL)

| # | Bloqueante | Por quê | Como liberar |
|---|---|---|---|
| B1 | Backup real + **restauração testada em projeto separado** | Exigido pelo dono. Não foi feito, e nenhum backup foi declarado testado | §5 |
| B2 | Contagem agregada `count(*) WHERE deleted_at IS NOT NULL` em `gastos` | Desde o hotfix, a coluna existe e as políticas de UPDATE (own/connected) permitem que um cliente a preencha. A F2 cria um CHECK validado, `gastos_deletion_consistent_chk` (`gastos-soft-delete-f2.sql:21-25`), que exige os 4 marcadores juntos. Se houver ≥1 linha com só `deleted_at`, a migração **falha e faz rollback** (fail-closed, sem dano). É leitura agregada de dados: precisa de autorização explícita | §3, passo P3. Se for maior que 0: NO-GO; decidir o tratamento antes da janela |
| B3 | Flags e segredos atuais (`WHATSAPP_*`, piloto de compras) | NÃO VERIFICADOS (sem acesso nesta etapa) | Conferir no painel antes da janela |

## 1. Inventário e integridade (SHA-256 no HEAD)

| Ordem | Arquivo | SHA-256 | Aplicar? |
|---|---|---|---|
| 1 | `docs/migrations-candidate/gastos-soft-delete-f2.sql` (270 linhas) | `72ed75d5834cd765cb640760a06979ad392a2d7d925cffba2e67ac3132d2aa35` | Sim |
| 2 | `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` (108 linhas) | `40edb42e0bec244d3e1893e72acf773cf577491d7895654852043b8362548b66` | Sim |
| 3 | `docs/migrations-candidate/gastos-delete-atomic-f4.sql` (110 linhas) | `559c8c2ddbac0c060ba3a5587865dec31a0dab0e2db6560d782fbf9e99fa1279` | Sim |
| — | `docs/migrations-candidate/whatsapp-shopping-quota.sql` | `04feacd6996cca46eb7965a197f02b0a87aaf2d9af96ec5640fd18b3a1885a71` | **NÃO**: já está no banco (2 tabelas + 6 funções) |

**Drift documental:** o cabeçalho de `gastos-delete-atomic-f4.sql:2-3` ainda lista o SQL de Compras como "passo 4". Esse passo **não vale mais**, porque o SQL de Compras já foi aplicado. O SQL candidato não foi alterado (fora da autorização). A ordem válida é a da tabela acima.

No dia, conferir `sha256sum` dos três arquivos antes de colar. Se divergir, NO-GO.

## 2. Comparação candidato × banco real (catálogo)

| Verificação | Real | Candidato | Resultado |
|---|---|---|---|
| Dono de `gastos`/`extratos_importados`/`audit_logs` | `postgres`, RLS on, FORCE off | F2:260-270 exige RPC com o mesmo dono e dono ≠ papéis de cliente | OK, se aplicado como `postgres` |
| `gastos`: id, user_id, valor numeric, data date, origem, grupo_parcelamento_id, recorrencia_id, total_parcelas smallint, created_at/updated_at NOT NULL, deleted_at | todos presentes | F2/UNDO/F4 | OK |
| `gastos`: deleted_by, deletion_batch_id, deletion_source | ausentes | F2:10-13 `ADD COLUMN IF NOT EXISTS` (nullable, sem default) | OK, aditivo |
| CHECKs atuais de `gastos` | `gastos_fatura_competencia_format`, UNIQUE (user_id,id) | F2 adiciona 2 CHECKs | OK (ver B2) |
| Triggers de `gastos` | `free_ads_quota_gastos` (BEFORE INSERT), `trg_gastos_updated_at` (BEFORE UPDATE) | F2 adiciona `gastos_guard_soft_delete` (BEFORE INSERT OR UPDATE) | Sem conflito de nome. Ver N1 |
| `receitas` deleted_at/origem/recorrencia_id; `recorrencias` origem/status | presentes | UNDO:74-96 | OK |
| `whatsapp_recent_actions` (state, expires_at, entity_kind, entity_id, related_id, telefone, undone_at, edit_state, pending_patch) | presentes, CHECKs compatíveis (`idle`, `undone`) | UNDO:22-101 | OK |
| Assinatura do undo | `(p_user_id uuid, p_phone text, p_action_id uuid, p_scope text DEFAULT 'single') RETURNS text`, INVOKER, `search_path=public,pg_temp`, EXECUTE só service_role; md5(prosrc) atual `9173692ff6dfa07ba78c18bfff10ceda` | UNDO:8-11 com assinatura idêntica + REVOKE/GRANT iguais | OK. `CREATE OR REPLACE` compatível |
| `contas_a_pagar`: status, data_pagamento, gasto_id, updated_at | presentes | F4:31, UNDO:39 | OK |
| `extratos_importados`: status sem CHECK, reverted_at | presentes | F4 grava `parcial`/`revertido` | OK |
| `transferencias_internas`, `dinheiro_guardado`, `movimentacoes_meta`: created_at/updated_at NOT NULL, import_batch_id | presentes | F4 regra de 5 s | OK |
| `audit_logs` (actor_user_id, action NOT NULL, target_user_id, entity_type, entity_id text, metadata jsonb) | presentes | F2:208, 242 (INSERT como dono via DEFINER) | OK |
| Políticas UPDATE/DELETE para own + connected (`can_admin_account`) nas 5 tabelas do lote e em extratos | presentes | F4 é INVOKER com `FOR UPDATE` (exige política de UPDATE) | OK. Dono e conta conectada admin conseguem; quem só visualiza recebe `extrato_not_found` |
| Grants de tabela | authenticated SELECT/UPDATE/DELETE; **anon também tem DELETE** (sem política para anon, o RLS nega) | — | P2 pré-existente, fora do escopo |

### Notas de comportamento (não bloqueiam; registrar)

- **N1 — gasto marcado bloqueia UPDATE.** Depois da F2, qualquer UPDATE comum numa linha marcada lança `gastos_row_soft_deleted`. Há 13 UPDATEs de `gastos` no app, como `store.ts:553` e `:1839` e `whatsapp-fatura-escolha.server.ts:159`.
  - Hoje **nenhum código chama** as RPCs de marcação da F2 (grep vazio em `src/`), então não surgem linhas marcadas só por instalar a F2.
  - Antes de ligar a exclusão por período, esses UPDATEs precisam filtrar `deleted_at IS NULL`.
- **N2 — conta compartilhada.** As RPCs da F2 e o `estornar_conta_gastos_atomic` da F4 agem só sobre o **titular** (`auth.uid() = user_id`). `reverter_extrato_atomic` segue o RLS e aceita admin conectado, como o site atual.
- **N3 — restaurado conta como editado.** O `trg_gastos_updated_at` atualiza `updated_at` quando a F2 marca ou restaura. Um gasto de extrato restaurado passa a contar como "editado" (>5 s) e é **mantido** na reversão de extrato. É o lado conservador.
- **N4 — GUC hostil.** O guard confere `current_user` = dono, além da GUC (testes H1–H13). Risco residual: outra função SECURITY DEFINER do `postgres`, chamada com `gi.gastos_soft_delete=on`, poderia editar uma linha já marcada. Nenhuma dessas funções grava marcadores.
- **N5 — locks.** `CREATE INDEX` (sem CONCURRENTLY) e o CHECK validado da F2 travam escritas em `gastos` durante a execução. O tamanho da tabela não foi medido (seria leitura de dados). Usar horário de baixo uso.

## 3. Procedimento da janela (executar SOMENTE com autorização explícita)

### Antes
- [ ] P1. Backup real feito e **restauração testada em projeto separado** (§5).
- [ ] P2. `sha256sum` dos 3 arquivos igual à §1.
- [ ] P3. Leitura agregada autorizada (B2): `SELECT count(*) FROM public.gastos WHERE deleted_at IS NOT NULL;`. Precisa dar 0.
- [ ] P4. Catálogo igual a este relatório: rodar o SQL read-only da §4 (A1–A4) e conferir a md5 do undo.
- [ ] P5. Site **ainda sem publicar** a mudança de reversão de extrato. Nesse estado a versão publicada usa o código antigo, o que é compatível.
- [ ] P6. Flags e segredos conferidos (B3). Envio automático e flags novas seguem OFF.

### Durante (uma migração por arquivo, nesta ordem, cada uma numa transação)
1. F2. Se falhar: parar. Nada foi aplicado (rollback automático).
2. UNDO. Se falhar: parar. A F2 fica aplicada, mas é inerte (nenhum código a chama).
3. F4. Se falhar: parar. F2 e UNDO ficam aplicados e são compatíveis com o site publicado.

### Depois (somente leitura)
- [ ] D1. Rodar A5 da §4: as funções existem com os privilégios esperados.
- [ ] D2. Smoke de leitura no site e no WhatsApp: listar gastos e faturas, abrir resumo, sem gravar.
- [ ] D3. **Publicar o site** (a reversão passa a usar a RPC) somente após D1/D2 e aprovação.
- [ ] D4. "Reverter extrato" só com dados **fictícios**, num projeto de homologação separado. **Nunca** testar no lote de um usuário real.
- [ ] D5. Observabilidade por 24 h:
  - erros `reversão segura indisponível` no console do site;
  - erros `gastos_soft_delete_fields_protected` / `gastos_row_soft_deleted`;
  - retornos `soft_deleted` do undo.

## 4. SQL de auditoria READ-ONLY (catálogo; sem ler linhas)

```sql
-- A1 colunas
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN ('gastos','receitas','extratos_importados','transferencias_internas','dinheiro_guardado','movimentacoes_meta','whatsapp_recent_actions')
   AND column_name IN ('deleted_at','deleted_by','deletion_batch_id','deletion_source','created_at','updated_at','import_batch_id','reverted_at') ORDER BY 1,2;
-- A2 triggers e constraints de gastos
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.gastos'::regclass AND NOT tgisinternal;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.gastos'::regclass;
-- A3 dono/RLS
SELECT relname, pg_get_userbyid(relowner), relrowsecurity FROM pg_class WHERE oid IN ('public.gastos'::regclass,'public.extratos_importados'::regclass);
-- A4 undo atual
SELECT pg_get_function_arguments(oid), prosecdef, proconfig, md5(prosrc) FROM pg_proc WHERE proname='whatsapp_undo_recent_action';
-- A5 pós-migração: funções e privilégios
SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner),
  has_function_privilege('anon',p.oid,'EXECUTE') anon, has_function_privilege('authenticated',p.oid,'EXECUTE') auth,
  has_function_privilege('service_role',p.oid,'EXECUTE') srv
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND p.proname ~ '^(gastos_|_gastos|tg_gastos_guard|whatsapp_undo_recent_action|reverter_extrato_atomic|estornar_conta_gastos_atomic)';
```

Esperado em A5 (igual ao ensaio local):

| Função | anon | authenticated | service_role | DEFINER |
|---|---|---|---|---|
| `_gastos_*` (3) | f | f | f | — |
| `gastos_preview_exclusao_periodo`, `gastos_soft_delete_periodo`, `gastos_restaurar_lote` | f | t | t | t |
| `whatsapp_undo_recent_action` | f | f | t | f |
| `reverter_extrato_atomic`, `estornar_conta_gastos_atomic` | f | t | f | f |

## 5. Backup e restauração (descrição; não executado)

1. Exportar ou fazer snapshot do banco real **antes** da janela, pelos recursos de backup da plataforma. Não usar dump manual pelo agente.
2. Restaurar num **projeto separado**, sem usuários reais, e conferir:
   - os papéis `anon`/`authenticated`/`service_role` existem;
   - RLS ativo e políticas iguais (contagem por tabela);
   - grants de tabela e de função (A5);
   - triggers (A2);
   - dono `postgres`;
   - contagens agregadas por tabela batendo com a origem, sem exportar conteúdo.
3. Ensaiar F2 → UNDO → F4 **nesse projeto separado** e repetir §3 "Depois". Só então liberar a janela real.
4. Registrar quem fez, quando e o resultado. Pode haver custo da plataforma: **não verificado**.

Sem o ambiente separado, **não há GO**.

## 6. Reversão (rollback) — conservadora

- **Nunca** apagar as colunas `deleted_at`/`deleted_by`/`deletion_batch_id`/`deletion_source`, nem "desfazer" com DELETE manual.
- **Antes de existir algum lote marcado:** retirar EXECUTE das RPCs novas (`REVOKE EXECUTE ... FROM authenticated, service_role`) ou remover só as funções novas. Isso não toca dados.
  - Sem `reverter_extrato_atomic`, o site **novo** falha fechado ("Nada foi apagado").
  - Para o undo: reaplicar a versão anterior de `supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql`, conferindo antes a md5 de A4.
- **Ponto de não-retorno:** existir **qualquer** gasto com `deletion_batch_id` preenchido. A partir daí, só correção para frente: manter colunas e trigger, retirar o EXECUTE das RPCs de marcação se preciso e restaurar lotes pela própria RPC.
- Em problema no site, voltar a versão publicada anterior. Ela é compatível com F2, UNDO e F4.

## 7. Testes executados nesta etapa (todos locais/fictícios)

| Teste | Resultado |
|---|---|
| Ensaio conjunto F2 → UNDO → F4 no mesmo cluster, cada arquivo 2× (idempotência). Inclui testes F2 (10 + hostile GUC), 6 de UNDO novos e F4 (10 + paridade) | **85 PASSOU / 0 FALHOU**, rc=0 |
| `scripts/test-gastos-soft-delete-sql.sh` | 45 / 0 |
| `scripts/test-gastos-delete-atomic-sql.sh` (inclui 2 corridas com 2 conexões) | **35** / 0. Correção: o relatório anterior dizia 36; a contagem real é 35 |
| `tests/whatsapp-undo-soft-delete-p0.test.ts` (estrutural/mocks) | 10 / 0 |
| `tests/extrato-revert-atomic-rpc.test.ts` (mocks) | 8 / 0 |

Rodados juntos no mesmo processo, os dois arquivos acima dão 1 falha, por conflito de mocks entre eles. Separados, passam.

Os stubs locais imitam só as colunas e políticas necessárias. **Não equivalem ao schema real**: a equivalência foi checada só pelo catálogo (§2). O ensaio de UNDO usou stub próprio (`recorrencias`, `whatsapp_recent_actions`), mantido em `/tmp`, fora do projeto.
