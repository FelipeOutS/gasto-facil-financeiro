# Anexo 6 — SQL, RLS, permissões, segurança transversal e cobertura de testes

Commit auditado: `32baac8bc973d7a131d8615f3ee8e5566d30a088`. Este anexo foi fechado pelo agente principal. O revisor original ficou sem tempo e não gravou o arquivo, então o conteúdo vem de três fontes:
- leitura dirigida do repositório;
- **consulta read-only a metadados** do banco (catálogo `pg_proc`/`pg_class`/`information_schema`, sem nenhuma leitura de linhas de usuários);
- execução local de 3 scripts SQL num PostgreSQL 17 descartável e sem rede.

## 1. Inventário de SQL presente no projeto

| Local | Qtde | Papel | Aplicado no banco real? |
|---|---:|---|---|
| `supabase/migrations/*.sql` | 183 arquivos (37 citam `whatsapp_`/`agenda_`) | Histórico de migrações | Presumido (é o histórico da plataforma). Não verificado arquivo a arquivo |
| `drizzle/migrations/*.sql` | 8 (0000–0007) | Migrações recentes | 0006 `agenda_items` e 0007 hotfix `gastos.deleted_at` confirmados por metadados (ver §2) |
| `docs/migrations-candidate/gastos-soft-delete-f2.sql` | 1 | Soft-delete completo F2 | **NÃO aplicado**: funções F2 ausentes no catálogo |
| `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` | 1 | Desfazer com soft-delete | **NÃO aplicado** |
| `docs/migrations-candidate/gastos-delete-atomic-f4.sql` | 1 | `estornar_conta_gastos_atomic`, `reverter_extrato_atomic` | **NÃO aplicado**: as duas funções **não existem** em `pg_proc` |
| `docs/migrations-candidate/whatsapp-shopping-quota.sql` | 1 | Cota e contexto de Compras | **Aplicado fora do repositório**: tabelas `whatsapp_shopping_searches`/`_contexts` e funções `whatsapp_shopping_*` existem no catálogo, mas não há migração versionada correspondente em `supabase/` nem em `drizzle/` |
| `docs/migrations-candidate/wa-c92-e1e-canary-template.sql` | 1 | Template canário | NÃO VERIFICADO |

**Correção a um achado bruto do revisor anterior:** ele afirmou que "`agenda_items` não existe em nenhuma migration". Isso é **falso**: a tabela está em `drizzle/migrations/0006_agenda_items.sql:2-42`, com GRANT, RLS e 4 políticas "own". O achado foi descartado.

**Q-P1-01 (CONFIRMADO) — drift de schema do Assistente de Compras.** O SQL de cota e contexto roda no banco real, mas só existe no repositório como candidato (`docs/migrations-candidate/whatsapp-shopping-quota.sql`). Um ambiente novo ou uma restauração a partir das migrações versionadas fica **sem** essas funções. Pelo desenho fail-closed (`shopping-assistant.ts:69-71`), as Compras deixariam de funcionar sem erro visível.
- **Proposta:** versionar o mesmo SQL (idempotente) como migração. Exige migração aditiva, sem efeito no banco atual.

## 2. Metadados do banco real (somente catálogo)

### 2.1 Coluna de soft-delete
`information_schema.columns`: a coluna `public.gastos.deleted_at` **existe** (hotfix 0007). Ela não existia quando os anexos 4 e 5 foram escritos; o anexo 4 §8.3 marca isso como NÃO VERIFICADO e este item resolve a dúvida.

### 2.2 Funções SECURITY DEFINER sem `search_path`
Consulta em `pg_proc` por `prosecdef = true` sem `search_path` em `proconfig`: **0 resultados** no schema `public`. A contagem por grep nas migrações sugeria divergência em 11 arquivos; era falso positivo (comentários ou recriação posterior).

### 2.3 EXECUTE para `anon`/`authenticated` nas funções `whatsapp_*`/`agenda_*`
- Todas as 34 funções `whatsapp_*`, incluindo as 6 `whatsapp_shopping_*`: **anon=f, authenticated=f**.
- Exceções encontradas:

| Função | SECURITY DEFINER | anon/auth executa | Avaliação |
|---|---|---|---|
| `agenda_validate_source` | sim | sim | Função de trigger (`RETURNS trigger`). Não pode ser chamada fora de trigger. Sem risco |
| `whatsapp_cleanup_csp_reports` | sim (`search_path=public,pg_temp`) | **sim** | **Q-P2-01**: qualquer chamador anônimo pode disparar `DELETE FROM whatsapp_csp_reports WHERE created_at < now()-7 dias`. O efeito é só antecipar a limpeza, sem vazamento. Proposta: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` (migração aditiva) |

### 2.4 Tabelas: RLS, políticas e grants

| Tabela | RLS | Políticas | anon SELECT grant | Observação |
|---|---|---:|---|---|
| agenda_items | on | 4 | sim | Políticas `auth.uid() = user_id`. O grant para anon é neutralizado porque não há política para anon |
| whatsapp_messages | on | 8 | sim | Índice único `idx_whatsapp_messages_external_id` (parcial, `external_id IS NOT NULL`) confirmado no catálogo; é a base do dedupe por WAMID |
| whatsapp_links | on | 8 | sim | — |
| whatsapp_shopping_searches / _contexts | on | 0 | não | Acesso só via funções DEFINER restritas a service_role. Correto |
| whatsapp_pix_pending_secrets | on | 0 | **sim** | Sem política, o RLS nega tudo. **Q-P2-02**: o grant é desnecessário (defesa em profundidade); proposta: revogar |
| whatsapp_plan_quotas, whatsapp_usage_counters/events, whatsapp_runtime_config(_audit), whatsapp_csp_reports | on | 0 | sim | Mesmo padrão de Q-P2-02 |
| whatsapp_financial_actions, whatsapp_recent_actions, whatsapp_notification_attempts/status_events/templates, whatsapp_link_challenges, whatsapp_meta_templates, whatsapp_planning_actions | on | 0–1 | não | Correto |

Conclusão: nenhuma tabela WhatsApp/Agenda está legível por `anon` na prática. A proteção, porém, depende da **ausência de política**, não da ausência de grant (Q-P2-02).

## 3. SQL local descartável (PostgreSQL 17.9, offline)

Execução como usuário `nobody` (o `initdb` recusa root), com variáveis `PG*` removidas e porta local. Cópia dos scripts em `/tmp/pgaudit/root`.

| Script | Testes PASSOU | FALHOU | rc |
|---|---:|---:|---:|
| `scripts/test-shopping-quota-sql.sh` | 22 | 0 | 0 |
| `scripts/test-gastos-delete-atomic-sql.sh` (F4) | 15 | 0 | 0 |
| `scripts/test-gastos-soft-delete-sql.sh` (F2) | 45 | 0 | 0 |

Comando base: `env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE runuser -u nobody -- env PG_BIN=/nix/store/avg1rhq9w93k03qmdaklazcsapn45zpd-postgresql-17.9/bin bash /tmp/pgaudit/root/scripts/<script>`.

Os testes validam **os candidatos sobre stubs**, não o banco real.

## 4. Segurança transversal

### 4.1 SSRF
Pontos com `fetch` encontrados em `src/server/whatsapp*.ts`, `shopping/*` e `nfce-fetch`:

| Ponto | URL controlada pelo usuário? | Status |
|---|---|---|
| `whatsapp-boleto-ocr.server.ts:158` | não (gateway fixo) | OK |
| `whatsapp-transcription.server.ts:78` | não (gateway fixo) | OK. Sem timeout: ver C-P1-04 |
| `whatsapp.server.ts:6012` (`built.url`) | NÃO VERIFICADO a origem de `built` | Fase 2 |
| `src/lib/mercado/nfce-fetch.functions.ts:56` | URL vinda de QR da nota | Anexo 3 §12 descreve allowlist de SEFAZ. Revalidação: NÃO VERIFICADO nesta rodada |
| `serpapi-shopping.ts` | host fixo SerpApi, query escapada | OK (anexo 5) |
| Download de mídia Meta (`public.whatsapp.expense.ts:437-465`) | URL devolvida pela Graph API | Sem timeout/streaming: C-P1-02, W1-P2-03 |

### 4.2 Logs
O anexo 1 §9 cobre a rota e os gates. Ponto específico: W1-P2-04 (sanitizador de status callback não redige dígitos). A varredura completa de `console.*` em todos os `whatsapp-*.server.ts` **não foi concluída**: Fase 2.

### 4.3 Quotas e idempotência

| Mecanismo | Base | Evidência |
|---|---|---|
| Dedupe inbound | índice único em `whatsapp_messages.external_id` | catálogo |
| Cota inbound / financeira / outbound | RPCs `*_atomic` (service_role only) | catálogo |
| Compras (cota) | `whatsapp_shopping_reserve`/`finish` | 22 testes SQL locais |
| Continuação de Compras | claim `shopping_followup` | ver S-P1 no relatório principal |

## 5. Cobertura de testes

- `scripts/test-whatsapp.mjs:172` seleciona os prefixos `whatsapp-`, `agenda-`, `admin-master-` e `free-ads-`, então **Agenda está incluída** (3 arquivos `agenda-*`).
- Há 156 arquivos de teste `whatsapp|agenda|shopping|serpapi` em `tests/`. A suíte executou 162 arquivos, porque inclui `admin-master-*`/`free-ads-*`.
- A maior parte é comportamental com mocks (`tests/_whatsapp-fake.ts`). Uma parte usa asserções estruturais (`readFileSync` do fonte), por exemplo `whatsapp-webhook-replay-3-27.test.ts` e `whatsapp-shopping-followup.test.ts:189-194`. Essas **não provam comportamento**.
- **Nenhum teste toca serviços reais** (Meta, IA, SerpApi), o que é correto por segurança. A qualidade real de OCR, transcrição e busca fica sem verificação automática (C-P0-01 / C-P1-01).

### Lacunas de teste concretas

| # | Cenário sem teste | Achado ligado |
|---|---|---|
| T1 | "Mercado 1.950", "Aluguel 1.500", "R$ 2.000" sem vírgula → valor esperado 1950/1500/2000 | G-P0-1 |
| T2 | Falha do 2º DELETE em `revertExtratoImportadoSeguro` (simular erro em `receitas`) → estado do lote | A-P1 (reversão não atômica) |
| T3 | Claim `shopping_followup` OK + envio falha + reentrega do mesmo WAMID → usuário recebe algo? | S-P1 |
| T4 | Duas entregas simultâneas do mesmo WAMID de foto → no máximo 1 chamada de OCR | W1-P1-01 (custo) |
| T5 | Download de mídia lento/infinito → corte por tempo | C-P1-02 |
| T6 | Transcrição pendurada → timeout | C-P1-04 |
| T7 | Lote de áudio pendente + 2º áudio "confirmar" | C-P1-05 |
| T8 | `handlePagarPessoaIntent` grava centavos como reais (código morto) | A-P1 Pix 100x |
| T9 | Restauração de ambiente só com migrações versionadas → Compras funcionando | Q-P1-01 |

## 6. Cobertura deste anexo

| Item | Status |
|---|---|
| Inventário de arquivos SQL | Integral (listagem) |
| Conteúdo de cada uma das 183+8 migrações | **Parcial**: só 0003, 0006 e o candidato de Compras foram lidos por grep estruturado. Fase 2 |
| Metadados do banco real (funções, RLS, grants, coluna) | Integral para os objetos `whatsapp_*`/`agenda_*` listados |
| Execução SQL local | Integral para os 3 scripts existentes |
| Varredura de logs sensíveis | Parcial |
| SSRF | Parcial (`whatsapp.server.ts:6012` e `nfce-fetch` pendentes) |
