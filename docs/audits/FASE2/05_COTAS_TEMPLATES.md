# FASE 2 — Pacote 5: Cotas e templates Meta

> Gravado pelo agente principal a partir do relatório do revisor desta área (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`). Texto do revisor preservado abaixo; correções do consolidador vêm primeiro.

## Notas do consolidador

- **TPL-P0-01 reclassificado para P1.** Só o Admin Master aciona esse caminho, que também exige `WHATSAPP_META_SUBMISSION_ENABLED=true` (valor atual NÃO VERIFICADO). Não há impacto financeiro nem em dados de usuários; o risco é um template duplicado na Meta. O defeito em si está confirmado.
- Nenhum SSRF confirmado no wikimedia.

---

# Auditoria — Pacote 5: Cotas/Templates WhatsApp

**Escopo:** `src/server/{whatsapp-financial-quota-gate,whatsapp-quota,whatsapp-quota-admin,whatsapp-query-guard,whatsapp-meta-template-management,whatsapp-meta-template-sync,whatsapp-meta-template-placeholders,whatsapp-meta-template-submission,whatsapp-meta-templates-catalog,whatsapp-meta-template-mapping,whatsapp-wikimedia}.server.ts`
**HEAD auditado:** `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`
**Método:** leitura integral linha a linha (visualizador numerado), `grep`/`rg` só para indexação de call sites, 1 execução de testes locais existentes via `bun test` (sem rede, sem banco). Nenhuma escrita, nenhuma chamada de rede, nenhum acesso a banco real foi feita por este auditor.

---

## 1. Cobertura por arquivo

| Arquivo | `wc -l` | Intervalo revisado | % | Status |
|---|---:|---|---:|---|
| `whatsapp-financial-quota-gate.server.ts` | 398 | 1–398 | 100% | INTEGRAL |
| `whatsapp-quota.server.ts` | 396 | 1–396 | 100% | INTEGRAL |
| `whatsapp-quota-admin.server.ts` | 364 | 1–364 | 100% | INTEGRAL |
| `whatsapp-query-guard.server.ts` | 243 | 1–243 | 100% | INTEGRAL |
| `whatsapp-meta-template-management.server.ts` | 433 | 1–433 | 100% | INTEGRAL |
| `whatsapp-meta-template-sync.server.ts` | 216 | 1–216 | 100% | INTEGRAL |
| `whatsapp-meta-template-placeholders.server.ts` | 156 | 1–156 | 100% | INTEGRAL |
| `whatsapp-meta-template-submission.server.ts` | 114 | 1–114 | 100% | INTEGRAL |
| `whatsapp-meta-templates-catalog.server.ts` | 107 | 1–107 | 100% | INTEGRAL |
| `whatsapp-meta-template-mapping.server.ts` | 78 | 1–78 | 100% | INTEGRAL |
| `whatsapp-wikimedia.server.ts` | 102 | 1–102 | 100% | INTEGRAL |

Arquivos adicionais lidos integralmente por serem dependência direta de autorização/dados (não fazem parte do pacote nominal, mas foram necessários para validar "quem chama" e os RPCs citados): `src/lib/whatsapp-runtime-admin.functions.ts` (1–145, INTEGRAL), `src/lib/whatsapp-templates-admin.functions.ts` (1–85, INTEGRAL), `src/server/admin-master.server.ts` (1–92, INTEGRAL). Trechos de `drizzle/migrations/20260717193002_*.sql` (linhas 305–377, RPC `whatsapp_consume_financial_action_quota_atomic`) e de `docs/audits/anexo-6-sql-seguranca-testes.md` (1–80) foram lidos como evidência cruzada — PARCIAL por não serem alvo do pacote, citados apenas como apoio.

---

## 2. Inventário por arquivo

### 2.1 `whatsapp-financial-quota-gate.server.ts` (398 linhas)

- **`defaultLoadPlanRow(userId)`** (L106–125): lê `user_plans` via `supabaseAdmin` (`sb`), `select` fixo, `.eq("user_id", userId).maybeSingle()`. Try/catch retorna `null` em qualquer erro (fail-closed silencioso — não distingue "sem plano" de "erro de rede/DB"). Sem RLS aplicável (service_role).
- **`hashId`** (L127–129): trunca id para 8 chars — mitigação de PII em logs, não hashing real (não é hash criptográfico, é slice).
- **`safeLog`** (L132–138): `console.info` com `try/catch` mudo — nunca derruba fluxo.
- **`buildFinancialActionKey`** (L174–183): monta `wa:financial:<messageId>:<actionType>[:<disc>]:v1`. Puro, determinístico.
- **`assertFinancialActionQuotaForWhatsApp`** (L211–373) — função central:
  - Entradas: `userId`, `externalMessageId`, `actionType`, `discriminator?`; `deps?` para injeção de teste.
  - Validações (L223–235): `userId` deve ser string ≥8 chars; `externalMessageId` não vazio após trim. Ambas fail-closed → `invalid_input`.
  - Ordem canônica confirmada no código: (1) `readRuntimeConfig` → `runtime_global_off` se `!rc.global_enabled` (L246–251); (2) `getWhatsAppEntitlement` → `entitlement_denied` (L254–268); (3) `loadPlanRow` (L271–272); (4) admin master pula quota mas retorna sempre o mesmo early-return com `adminMaster:true` (L275–288) — correto por design (comentário interno confirma que `whatsapp_plan_quotas` não tem linha para admin_master); (5) `resolveCycleForPlan` → `cycle_invalid` (L292–299); (6) `consumeFinancialActionQuota` (RPC atômica) (L302–332).
  - Try/catch global (L245/L368–372): qualquer exceção não tratada cai em `internal_error` com `blocked()` — fail-closed confirmado.
  - Idempotência: key estável por `messageId+actionType[+disc]`; a RPC subjacente (`whatsapp_consume_financial_action_quota_atomic`, lida em `drizzle/migrations/20260717193002_*.sql:305-369`) usa `pg_advisory_xact_lock` por `user_id`, checa `whatsapp_usage_events.idempotency_key` com prefixo `fin:` antes de incrementar, e faz `SELECT ... FOR UPDATE` no contador — atomicidade e idempotência **CONFIRMADAS no SQL real**, RLS irrelevante pois é `SECURITY DEFINER` com checagem explícita `auth.role() <> 'service_role'`.
  - `financialQuotaBlockedReply` (L380–398): mensagens genéricas sem PII/contadores detalhados — correto.
  - Testes: `tests/whatsapp-c11-financial-quota-gate.test.ts` (bun:test, passou).

### 2.2 `whatsapp-quota.server.ts` (396 linhas)

- Wrappers finos 1:1 sobre 7 RPCs `*_atomic`/`get_usage_snapshot`, todos usando `supabaseAdmin` (`sb`) por padrão, mas aceitam `client` injetável (testes).
- Padrão uniforme em todas as funções (`consumeInboundQuota` L100–131, `consumeFinancialActionQuota` L136–166, `reserveOutboundQuota` L172–207, `commitOutboundQuota` L213–245, `releaseOutboundQuota` L252–284, `markReservationAmbiguous` L294–321, `reconcileReservationFromCallback` L327–355, `getUsageSnapshot` L361–394): `try { rpc(...) } catch` → em qualquer erro OU exceção retorna `denied("db_error")`/`{outcome:"db_error"}` — **fail-closed confirmado uniformemente**.
- `normalizeConsume` (L84–95) só aceita valores com `typeof` correto, não repassa shape bruto da RPC → defesa contra campo inesperado do banco.
- Logs (`safeLog` L72–78) só registram `event`/`code` do erro Postgres, nunca payload/telefone — consistente com o comentário de cabeçalho.
- Nenhuma validação de formato de `userId`/`notificationId`/`idempotencyKey` é feita aqui (delegada ao caller — `whatsapp-financial-quota-gate.server.ts` valida `userId`/`messageId` antes de chamar `consumeFinancialActionQuota`, mas `consumeInboundQuota`/`reserveOutboundQuota` não têm um gate equivalente neste pacote — callers estão fora do escopo do pacote).
- Sem testes dedicados dentro deste pacote (cobertos indiretamente via `whatsapp-c11-financial-quota-gate.test.ts` apenas para o caminho financeiro, com `consumeFinancialActionQuota` mockado via `deps`).

### 2.3 `whatsapp-quota-admin.server.ts` (364 linhas)

- **Comentário de cabeçalho explícito (L1–13): autorização é responsabilidade do CALLER**, não deste módulo — confirmado: nenhuma função aqui chama `assertAdminMaster`/`hasAdminMasterRole`.
- `ALLOWED_PLAN_CODES`/`FREE_PLAN_CODES` (L20–38): allowlist fechada; `isAllowedPlan`/`isFreePlan` (L80–85) usados em `validateQuotaPatch`.
- `sanitizeReason` (L88–94): exige 3–500 chars, rejeita `<>`\0`. Usado como gate de auditoria mínima (obrigatório em `updatePlanQuota`).
- `validateNumberField` (L97–107): exige inteiro finito, 0 ≤ v ≤ 1_000_000.
- `validateQuotaPatch` (L110–163): valida campos numéricos um a um; **planos free DEVEM ter todos os limites =0** (L140–148, `free_plan_must_be_zero`) — regra de negócio crítica contra abuso; valida `daily ≤ monthly` já no patch isolado (L150–160) e **revalida de novo após merge com estado atual** em `updatePlanQuota` (L230–240) — dupla checagem evita bypass por patch parcial (ex.: só setar `daily_inbound_limit` alto mantendo `inbound_monthly_limit` do estado anterior baixo é pego na segunda checagem).
- `updatePlanQuota` (L204–279): exige `reason` sanitizado (L210–211) antes de qualquer validação de patch; `SELECT ... maybeSingle()` do estado atual (L220–228), merge, update (`c.from(...).update(updatePayload).eq("plan_code", planCode)`), log estruturado best-effort (L260–272, dentro de try/catch mudo). **Risco de corrida (TOCTOU):** leitura do estado atual e o `update` final não estão numa transação/lock — duas chamadas concorrentes de admin podem produzir um merge inconsistente (ex.: duas mudanças parciais simultâneas, cada uma validando contra o snapshot pré-mudança da outra). Isso é um painel admin de baixa frequência, mas não há `SELECT...FOR UPDATE` nem retry otimista.
- `getUsageSnapshot` (L293–363): lê `whatsapp_usage_counters` com filtro de ciclo corrente, agrega totais e `users_over_80pct`/`users_at_limit` por plano via `outbound_monthly_limit` apenas (não considera `inbound`/`financial` no ratio de alerta — possível lacuna de cobertura do alerta, não é bug de segurança).
- Nenhum SQL dinâmico; todas as queries usam o query-builder do Supabase com `.eq`/`.select` fixos — sem risco de SQL injection direto neste arquivo.
- Testes: `tests/whatsapp-c11-f3b3-quota-admin.test.ts` (bun:test, passou).

### 2.4 `whatsapp-query-guard.server.ts` (243 linhas)

- 100% puro, sem I/O, sem efeitos colaterais (confirmado por leitura completa — não há `fetch`, não há `sb`/`supabaseAdmin`, não há `console`).
- `detectConsultaShape` (L124–162): nunca lança, usa apenas regex; `QUERY_MARKERS`/`WRITE_ACTION_VERBS`/`HAS_MONEY`/`AREA_PATTERNS` são expressões regulares estáticas. Sem ReDoS aparente (padrões simples, sem grupos aninhados quantificados).
- Sem claims, sem sessão, sem escrita — consistente com o cabeçalho.
- Testes: `tests/whatsapp-query-guard.test.ts` (bun:test, passou, inclui negativos para não interceptar lançamentos reais).

### 2.5 `whatsapp-meta-template-management.server.ts` (433 linhas)

- **Flags lidas em runtime** (nunca import-time): `isMgmtEnabled()` (L45–47, `WHATSAPP_META_MGMT_ENABLED`), `isSubmissionEnabled()` (L48–50, `WHATSAPP_META_SUBMISSION_ENABLED`) — correto.
- `readWabaId` (L54–61): exige padrão `^[0-9]{5,32}$`; `readAccessToken` (L63–67): exige string não vazia. WABA_ID só do ambiente, nunca do chamador — confirmado (nenhum parâmetro de WABA em nenhuma função pública).
- `buildMessageTemplatesUrl` (L83–107): monta path fixo `${wabaId}/message_templates` com query opcional (`fields`/`limit`/`after`, todos `encodeURIComponent`). Delegra host/versão a `buildWhatsAppGraphUrl` (fora do pacote, não lido integralmente aqui — **NÃO TESTADO** neste pacote se esse helper valida corretamente o host `graph.facebook.com`).
- `deleteRemoteTemplate`/`sendRemoteMessage` (L111–116): stubs que sempre lançam `not_implemented` — barreira de design para impedir uso acidental de operações destrutivas/envio nesta fase.
- `computeTemplateFingerprint` (L131–142): SHA-256 determinístico sobre campos relevantes do template — puro, sem segredo embutido.
- `prepareSubmissionPayload` (L150–185): valida `internal_key` contra `resolveAllowedMapping` (allowlist fechada), exige `body` não vazio, `language==="pt_BR"`, **`category==="UTILITY"` hard-coded** (L155) — **allowlist de categoria UTILITY confirmada e correta**: templates de outra categoria (ex. MARKETING) são rejeitados antes de montar payload.
- `prepareDryRun` (L213–246): **nunca executa POST** (comentário L231–233 confirmado pelo código — não há `fetch` nesta função); apenas monta payload e fingerprint; detecta duplicidade local por `(meta_name, language)` (L223–230).
- `listRemoteTemplates` (L291–363): GET com `AbortController` e timeout `Math.min(Math.max(opts.timeoutMs ?? 15000, 1000), 30000)` (L315) — **timeout confirmado e limitado** (1s–30s, não pode ser desabilitado por opts arbitrariamente grande/pequeno). Trata erro de rede como `timeout` se `AbortError`, senão `http_error` (L354–359) — fail-closed.
- `fetchRemoteTemplateByName` (L413–432): reusa `listRemoteTemplates` e filtra client-side por nome/idioma — **não aceita ID vindo do client** (comentário L420–421 confirmado).
- Token só em header `Authorization: Bearer` (L321–322) — nunca em URL/log. Confirmado: nenhum `console.log`/`console.error` neste arquivo referencia `tok.token` ou a URL completa com querystring de auth.

### 2.6 `whatsapp-meta-template-sync.server.ts` (216 linhas)

- 100% leitura remota + opcional `applyPatch` injetado pelo caller (nunca grava direto neste módulo — `DML` fica em `whatsapp-templates-admin.functions.ts:32-45`).
- `isMgmtEnabled()` gate no topo de `syncRemoteTemplates` (L98) — `disabled` sem fetch.
- Nunca ativa template automaticamente, nunca altera `body`/placeholders (confirmado: `SyncPatch` type L36–43 só tem `status/provider_template_id/quality_score/rejection_reason/last_synced_at`).
- `detectContentDivergence` (L210–215): só compara `category` remoto vs local; se diferente, marca `content_divergence` e **não aplica patch** (L136–148, `continue` antes de `applyPatch`). Correto como defesa contra sobrescrita silenciosa, mas é um sinal de divergência bastante restrito (não compara `body`/`components`) — **lacuna de cobertura, não falha de segurança** (a API de listagem da Meta usada aqui não devolve body).
- `sanitizeRejection` (L83–87): remove controle, trunca a 240 chars — mitigação de log-injection/PII residual no motivo de rejeição vindo da Meta.
- Idempotência: compara `needsUpdate` campo a campo (L158–163) antes de chamar `applyPatch`; entradas sem mudança retornam `no_change` sem DML.

### 2.7 `whatsapp-meta-template-placeholders.server.ts` (156 linhas)

- 100% puro, sem I/O.
- `validateDatePlaceholder` (L25–38): regex `^([0-3][0-9])\/([0-1][0-9])\/([0-9]{4})$` + validação de mês/dia real (`daysInMonth`/`isLeapYear`) — rejeita `29/02` em ano não bissexto, `31/04`, mês 0/13. Reconstrói valor canônico (não ecoa input cru).
- `sanitizeLabelPlaceholder` (L99–117): cadeia de checagens fail-closed em ordem (not_string → empty → multi_line → control_chars → too_long → html → url → pix_email → pix_random → cnpj → cpf → boleto_line → phone → card_number → monetary_value), cada uma cai no fallback `"Conta cadastrada"` sem lançar. Padrões (`CPF_PATTERN`, `CNPJ_PATTERN`, `BOLETO_LINE_PATTERN`, `CARD_PATTERN`, `PHONE_PATTERN`, `MONETARY_PATTERN`, `PIX_EMAIL`, `PIX_RANDOM`) são heurísticos (regex), não há verificação de dígito verificador de CPF/CNPJ — podem deixar passar CPF/CNPJ com formato mas dígito inválido (que ainda assim seria PII-like e indesejável mesmo que "inválido" numericamente) e podem ter falso-negativo para formatos atípicos (ex. CPF sem máscara dentro de frase maior sem separador). É defesa em profundidade sobre um placeholder que já deveria vir de campo estruturado (nome da conta), risco residual baixo.
- `resolveAndSanitizePlaceholders` (L145–155): combina os dois, fail-closed em `invalid_date`, nunca falha em `label` (sempre cai no fallback). Sem testes dedicados dentro deste pacote de arquivos nominal (mas cobertos por `tests/whatsapp-c11-f4b-template-resolver.test.ts`, que importa `whatsapp-approval...` — **PARCIAL**, não há teste que importe `whatsapp-meta-template-placeholders.server.ts` diretamente por nome neste bun test; não foi possível confirmar cobertura direta sem rodar grep de import dentro do teste).

### 2.8 `whatsapp-meta-template-submission.server.ts` (114 linhas) — **foco do pedido**

- `isSubmissionEnabled()` (L22–24): lê `WHATSAPP_META_SUBMISSION_ENABLED==="true"` em runtime — correto, gate aplicado logo no topo de `submitTemplateToMeta` (L52).
- `readAccessToken()` (L27–29): `process.env.WHATSAPP_ACCESS_TOKEN`; `token_missing` se ausente (L55).
- `submitTemplateToMeta(local, opts)` (L48–113):
  - Guarda `local.provider_template_id || local.status !== "draft"` → `already_submitted` (L57–59) — impede resubmissão.
  - `prepareSubmissionPayload`/`buildMessageTemplatesUrl` (L61–64) reaproveitam o módulo de management — herdam a allowlist UTILITY e a validação de WABA.
  - **POST real para a Meta** (L70–77): `Authorization: Bearer ${token}` em header (correto, não em log/URL), `Content-Type: application/json`, body = payload preparado. **Sem timeout/AbortController** aqui — diferente de `listRemoteTemplates`, que usa `AbortController` com até 30s. Chamada de submissão pode ficar pendurada indefinidamente se a Meta não responder — **achado de robustez (não de segurança crítica)**.
  - **L82 `console.error("[submitTemplateToMeta] Erro Meta:", data)`**: `data` é o JSON de erro decodificado da resposta da Meta (`await res.json()`, L79). A API Graph normalmente retorna `{error:{message, type, code, fbtrace_id, error_subcode}}` — **não inclui o token de acesso nem PII de usuário final** (o endpoint é de templates/catálogo, não de envio a destinatário). Risco real: `fbtrace_id`/`error_subcode` podem vazar para logs de aplicação (stdout/console) sem redaction — **CONFIRMADO: nenhuma sanitização é aplicada a `data` antes do log**, diferente do padrão usado em `whatsapp-meta-template-sync.server.ts` (`sanitizeRejection`, trunca e remove controle) e em `whatsapp-financial-quota-gate.server.ts`/`whatsapp-quota.server.ts` (`safeLog` só repassa `code`). Aqui o objeto inteiro da Meta é logado sem truncamento/sanitização — inconsistência de padrão de logging dentro do próprio pacote.
  - **L94-109 — ponto citado explicitamente no pedido:**
    ```
    const { error: updateError } = await supabaseAdmin
      .from("whatsapp_meta_templates")
      .update({ provider_template_id: providerId, status, submitted_at, last_synced_at })
      .eq("id", local.id);
    if (updateError) {
      console.error("[submitTemplateToMeta] Erro ao atualizar banco:", updateError);
    }
    return { ok: true, provider_template_id: providerId, status };
    ```
    **CONFIRMADO: a função retorna `{ ok: true, ... }` incondicionalmente após o bloco de update, mesmo quando `updateError` é truthy.** O erro de persistência é apenas logado (`console.error`), nunca propagado ao `SubmissionResult`. Isso é o achado P0/P1 citado no pedido — ver seção 3, ID **TPL-P0-01**.
  - Catch global (L110–113): captura exceções de rede/parse e devolve `meta_error` com `detail: String(err)` — risco menor de vazar mensagem de erro bruta (ex. stack trace serializado por `String(err)`) para o chamador (não para o usuário final do WhatsApp, apenas para o admin via painel), mas ainda é uma superfície de vazamento de detalhe técnico para quem consome `SubmissionResult.detail`.
- Nenhum teste dedicado localizado para este arquivo (`submitTemplateToMeta`) dentro da suíte local executada — **LACUNA DE TESTE CONFIRMADA** (ver seção 4/5).

### 2.9 `whatsapp-meta-templates-catalog.server.ts` (107 linhas)

- Comentário (L1–10) declara FORCE RLS com única policy `service_role manages meta templates` — não foi possível confirmar isso no banco real (read-only, sem acesso a banco autorizado neste pacote); fica como **NÃO TESTADO** nesta rodada (consistente com o que o anexo 6 já reporta de forma geral para tabelas WhatsApp).
- `buildServiceRoleCatalogLoader` (L55–91): import dinâmico de `supabaseAdmin`, 3 métodos (`getByInternalKeyAndVersion`, `getByMetaNameAndLanguage`, `listAll`), todos com `select` de colunas fixas (sem `select *`), erros da query viram `throw new Error("catalog_read_failed:<code>")` — não mascara erro, mas também não sanitiza o `error.code` antes de compor a mensagem (código Postgres é baixo risco).
- `loadCanonicalForNotificationKey` (L96–106): delega a `resolveAllowedMapping` — se o evento não está na allowlist, retorna `null` sem tentar DB — correto (evita leitura por chave de evento arbitrária vinda de fora da allowlist).

### 2.10 `whatsapp-meta-template-mapping.server.ts` (78 linhas)

- 100% puro, mapa estático congelado (`Object.freeze`) com 3 entradas (`gi_conta_vencendo_hoje`, `gi_conta_vencendo_amanha`, `gi_conta_atrasada`), todas `category: "UTILITY"`, `language: "pt_BR"`, `version: 1`.
- `resolveAllowedMapping`/`isAllowedNotificationKey`/`isAllowedMetaName` são a única fonte de verdade de correlação evento→template — **allowlist fechada confirmada**: não há fallback dinâmico, não há leitura de env/DB para estender a lista em runtime.

### 2.11 `whatsapp-wikimedia.server.ts` (102 linhas) — **foco SSRF**

- `API` fixo (L7, `https://pt.wikipedia.org/w/api.php`); `apiUrl()` (L19–23) monta sempre a partir de `new URL(API)` e só adiciona parâmetros de query — **host nunca é parametrizável pelo chamador**, SSRF por escolha de host **não é possível** por este vetor.
- `getJson` (L25–31): `fetcher(url, { headers, signal, redirect: "error" })` — **`redirect: "error"` é defesa explícita contra SSRF por redirect** (a Wikipedia não deveria redirecionar para outro host, e se tentasse, o fetch falharia em vez de seguir); limite de 32KB de corpo antes de `JSON.parse` (L28) — mitiga payload bomb.
- `createWikimediaSource(...).lookup(topic, signal)` (L57–97): recebe `signal: AbortSignal` do chamador (quem decide timeout está fora deste arquivo — **timeout delegado ao caller**, não há timeout interno aqui; se o caller não passar AbortController com timeout, a chamada pode pendurar. **NÃO TESTADO** neste pacote por não ter acesso ao caller).
- `query` (o `topic`) é validado (L60): rejeita <2 ou >80 chars, ou contendo `https?://` ou `[<>\r\n]` — mitiga injeção de URL via `topic` controlado pelo usuário final (ex. pedir pesquisa de um "tópico" que na verdade é uma URL) antes mesmo de ir para `srsearch`. Como `srsearch` vai para querystring via `searchParams.set` (encoding automático), não há injeção de parâmetro adicional possível.
- `articleUrl` (L39–47): ao processar a resposta, valida que a URL retornada pela própria Wikipedia tem `protocol==="https:"`, `hostname==="pt.wikipedia.org"`, `pathname` começa com `/wiki/`, sem `username`/`password` embutidos — **defesa adicional contra a própria resposta da API ser manipulada/conter campo `fullurl` inesperado** (ex. se a API um dia devolvesse outro host). Combinado com `redirect:"error"`, a superfície de SSRF deste arquivo está **bem mitigada e CONFIRMADA**.
- Cache em memória (`Map`, `MAX_CACHE_ENTRIES=128`, TTL diferenciado positivo/negativo) com eviction FIFO simples (`cache.keys().next().value`) — não é LRU real, mas limita crescimento ilimitado. Não é problema de segurança, é nota de eficiência.
- Função extra hardcoded para IPCA (L83–94) reusa as mesmas validações (`articleUrl`, `section.length >= 30`) — consistente.

---

## 3. Achados

| ID | Severidade | Confiança | path:linhas | Descrição | Reprodução (dados fictícios) | Sugestão |
|---|---|---|---|---|---|---|
| **TPL-P0-01** | **P0** | **CONFIRMADO** | `whatsapp-meta-template-submission.server.ts:94-109` | `submitTemplateToMeta` reporta sucesso (`{ok:true, provider_template_id, status}`) **mesmo quando o `UPDATE` em `whatsapp_meta_templates` falha** (`updateError` truthy é apenas logado, nunca propagado). O template fica submetido na Meta (POST já ocorreu) mas o banco local continua em `status:"draft"` sem `provider_template_id`. Uma nova chamada de `submitTemplateToMeta` para o mesmo `local` (ainda `draft`/sem `provider_template_id` no banco) passaria de novo pela guarda L57-59 e tentaria **submeter o mesmo template novamente à Meta**, gerando risco de nome duplicado/rejeição por "template já existe" ou — pior — duas entradas remotas divergentes sob o mesmo `internal_key`/`meta_name` sem o catálogo saber qual é a válida. | 1) Admin chama `whatsappAdminSubmitTemplate({internalKey:"gi_conta_atrasada", version:1})` com template em `draft`. 2) Meta aceita e devolve `{id:"123", status:"PENDING"}`. 3) O `UPDATE` falha (ex.: timeout de rede entre app e Postgres, ou RLS/policy mudou). 4) Função retorna `ok:true` ao painel — admin acredita que está sincronizado. 5) Painel mostra ainda `draft` (porque não foi de fato persistido) — estado inconsistente visível apenas numa releitura manual. 6) Se o admin clicar "submeter" de novo, a guarda L57-59 não barra (local.status ainda é "draft", sem provider_template_id) e um novo POST é enviado à Meta para o mesmo `meta_name`. | Propagar a falha: se `updateError`, retornar `{ok:false, reason:"meta_error", detail:"persist_failed_after_meta_accept"}` (ou um reason dedicado tipo `"persist_failed"`) preservando o `providerId`/`status` recebidos da Meta no corpo do erro, para que o caller possa reconciliar manualmente (ex. via `syncRemoteTemplates`, que já faz correlação por `meta_name+language` e corrigiria o drift na próxima sync). Não corrigir agora, apenas reportar, conforme instrução. |
| **TPL-P1-01** | P1 | CONFIRMADO | `whatsapp-meta-template-submission.server.ts:82` | `console.error("[submitTemplateToMeta] Erro Meta:", data)` loga o corpo de erro inteiro retornado pela Graph API sem sanitização/truncamento, diferente do padrão usado em `whatsapp-meta-template-sync.server.ts` (`sanitizeRejection`, corta a 240 chars e remove chars de controle) e em `whatsapp-quota.server.ts`/`whatsapp-financial-quota-gate.server.ts` (`safeLog` só repassa `code`/`reason`). O corpo típico de erro Graph (`{error:{message, type, code, error_subcode, fbtrace_id}}`) não costuma conter o token de acesso, mas pode conter `fbtrace_id` (identificador rastreável do lado Meta) e mensagens de erro que ecoam parte do payload enviado (ex. nome de template, idioma) em stdout/logs persistidos sem retenção/redaction controlada. | Forçar a Meta a devolver erro: enviar template com `name` fora do padrão (ex. com espaço) → POST retorna 400 com `error.message` detalhado contendo o valor inválido enviado → log grava o payload de erro completo em texto plano no stdout do servidor. | Sanitizar antes de logar: extrair apenas `data?.error?.code`/`data?.error?.type` (já existe `data?.error?.message` sendo usado no `return`, mas não precisa ir para o log bruto); aplicar a mesma função `sanitizeRejection`-like usada em `whatsapp-meta-template-sync.server.ts`. |
| **TPL-P1-02** | P1 | CONFIRMADO | `whatsapp-meta-template-submission.server.ts:70-77` | Chamada `fetchFn(url.url, {...})` de POST para a Meta **sem `AbortController`/timeout**, ao contrário de `listRemoteTemplates` (`whatsapp-meta-template-management.server.ts:313-317`, timeout 1s–30s configurável). Uma Meta lenta/instável pode travar a função indefinidamente (limitado apenas pelo timeout de infraestrutura externa, se houver). | Simular `fetchFn` que nunca resolve a Promise (mock de teste) → `submitTemplateToMeta` nunca retorna, nunca libera o `await` do caller (`whatsappAdminSubmitTemplate`). | Adicionar `AbortController` com timeout (ex. 15–30s) igual ao padrão de `listRemoteTemplates`, tratando abort como `reason:"meta_error", detail:"timeout"`. |
| **TPL-P2-01** | P2 | SUSPEITO | `whatsapp-meta-template-submission.server.ts:112` | `catch (err) { ...detail: String(err) }` pode vazar stack/mensagem técnica bruta (dependendo do tipo de `err`, ex. `TypeError` com detalhes internos de runtime) para `SubmissionResult.detail`, que é devolvido pelo server-function `whatsappAdminSubmitTemplate` ao painel. Exposição é apenas para Admin Master autenticado (owner), então o impacto é baixo (não é vazamento a usuário final), mas é informação de diagnóstico que poderia incluir detalhes de implementação. | Forçar exceção síncrona em `fetchFn` (ex. `fetchFn` lança `Error("ECONNREFUSED 10.0.0.5:443")`) → `String(err)` propaga o IP/porta interno para o payload de resposta ao admin. | Normalizar detail para mensagens de categoria (ex. `"network_error"`), reservando o erro completo só para log server-side. |
| **QA-P1-01** | P1 | CONFIRMADO | `whatsapp-quota-admin.server.ts:220-254` | `updatePlanQuota` lê o estado atual (`SELECT ... maybeSingle()`) e, após validar e mesclar em memória, faz `UPDATE ... WHERE plan_code=planCode` sem lock otimista (sem `updated_at` em `WHERE`) nem `SELECT ... FOR UPDATE`. Duas chamadas administrativas concorrentes para o mesmo `plan_code` (ex. dois admins editando ao mesmo tempo, ou double-click no painel) podem gerar "last write wins" silencioso sem detectar a condição de corrida — o merge de cada chamada é calculado sobre o snapshot pré-conflito, então a validação `daily ≤ monthly` pode passar em ambas as validações individuais mas o resultado final pode violar a invariante combinada dependendo da ordem de commit. | Admin A e Admin B abrem o painel de quotas do plano `mei_essencial` ao mesmo tempo (ambos veem `daily_outbound_limit=100, outbound_monthly_limit=3000`). Admin A envia patch `{outbound_monthly_limit: 50}` (válido contra o snapshot que ele viu: 100≤50 falha, é rejeitado na realidade — mas trocando a ordem: Admin A define `daily_outbound_limit=90` primeiro, validado contra o `outbound_monthly_limit=3000` ainda não alterado; concorrentemente Admin B reduz `outbound_monthly_limit` para `50` validado contra o `daily_outbound_limit=100` antigo (que ele ainda vê) — o commit de B passa (100>50 seria barrado, mas a leitura de B pode ocorrer antes do commit de A). Resultado possível: tabela final com `daily_outbound_limit=90, outbound_monthly_limit=50`, violando `daily ≤ monthly`. | Adicionar `SELECT ... FOR UPDATE` na leitura do estado atual, ou condicionar o `UPDATE` a `updated_at` capturado na leitura (optimistic locking), rejeitando com erro de conflito se a linha mudou entre leitura e escrita. |
| **TPL-P2-02** | P2 | CONFIRMADO | `whatsapp-meta-template-sync.server.ts:212-215` | `detectContentDivergence` só compara `category` remoto vs local; não compara `body`/`components`/`language`. Se a Meta um dia expuser `body` na listagem (hoje não expõe, conforme comentário L205-208) e ele divergir do local sem mudança de `category`, a sync aplicaria `patched` silenciosamente sobre `status`/`provider_template_id` sem sinalizar a divergência de conteúdo. Hoje é mitigado porque a superfície remota consultada (`listRemoteTemplates`) de fato não traz `body`. | Hipotético: Meta API passa a incluir `components`/`body` no campo de listagem usado por `normalizeRemoteList`; um operador edita o template diretamente no Business Manager da Meta alterando o texto sem mudar a categoria → próxima `syncRemoteTemplates` marcaria `no_change`/`patched` ignorando a divergência de conteúdo. | Quando a superfície remota evoluir para incluir mais campos, estender `detectContentDivergence` para compará-los antes de permitir patch. Documentar explicitamente a limitação atual como aceita. |
| **PH-P2-01** | P2 | SUSPEITO | `whatsapp-meta-template-placeholders.server.ts:85-94` | `CPF_PATTERN`/`CNPJ_PATTERN`/`PHONE_PATTERN` são heurísticos por formato, sem validação de dígito verificador; `PHONE_PATTERN` (`/(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}\b/`) pode ter falso-negativo para números de telefone sem o padrão exato esperado (ex. com extensão, ou número internacional não-BR formatado diferente), deixando passar um rótulo com telefone embutido para o template de WhatsApp. Impacto limitado porque o rótulo ({{2}}) é alimentado por nome de conta cadastrado pelo próprio usuário final, não por terceiro, e o canal de saída é um template aprovado pela Meta (não reexibe dado sensível de outra pessoa) — mas ainda é superfície de PII em mensagem de notificação. | Rótulo de conta = `"Ligar 991234567 confirmar"` (sem separadores no padrão exato do regex) poderia, dependendo de como os dígitos se alinham com o `\b`, não casar com `PHONE_PATTERN` e passar sanitização sem fallback, inserindo um número de telefone em texto livre no corpo do template enviado via WhatsApp. | Se o risco for considerado relevante, reforçar com checagem de dígitos verificadores para CPF/CNPJ e ampliar `PHONE_PATTERN` para cobrir mais formatos, ou — mais robusto — restringir a origem do rótulo para não aceitar texto livre do usuário sem normalização prévia (fora do escopo deste arquivo). |
| **WM-P2-01** | P2 | NÃO TESTADO | `whatsapp-wikimedia.server.ts:57-97` | `lookup(topic, signal)` não define timeout próprio; depende inteiramente do `AbortSignal` passado pelo chamador. Não foi possível localizar e revisar o caller dentro deste pacote (fora do escopo nominal) para confirmar se ele sempre fornece um `AbortController` com timeout finito. | — | Confirmar no caller (fora deste pacote) que todo uso de `wikimediaSource.lookup` passa um `signal` com timeout; se não, considerar timeout interno default no próprio módulo como defesa em profundidade. |
| **QA-P2-02** | P2 | CONFIRMADO | `whatsapp-financial-quota-gate.server.ts:106-125` | `defaultLoadPlanRow` engole qualquer erro de `supabaseAdmin.from("user_plans")...` e retorna `null`, que é tratado adiante como "sem plano" (cai em `resolveCycleForPlan(null, now)`, fora deste pacote). Não há distinção entre "usuário realmente sem plano" e "erro de rede/DB ao consultar user_plans" — ambos seguem o mesmo caminho. Dependendo do comportamento de `resolveCycleForPlan` para `plan=null` (não lido neste pacote), isso pode tanto bloquear corretamente (fail-closed desejável) quanto mascarar uma falha de infraestrutura como se fosse um estado de negócio normal, dificultando observabilidade/alertas. | Simular erro transitório de rede no Supabase durante a consulta de `user_plans` para um usuário pago → função retorna `null` sem logar o erro real (não há `safeLog` dentro do catch de `defaultLoadPlanRow`) → se `resolveCycleForPlan(null,...)` resultar em `cycle_invalid`, o usuário pago é bloqueado sem que o log indique que foi por falha de infraestrutura e não por ausência de plano. | Logar (sanitizado) a ocorrência de erro real do Supabase dentro do catch de `defaultLoadPlanRow`, mesmo retornando `null`, para permitir diferenciar os dois casos em observabilidade. |

Nenhum achado P0/P1 de SSRF foi confirmado em `whatsapp-wikimedia.server.ts`: host fixo, `redirect:"error"`, validação de topic de entrada e validação de URL de saída (`articleUrl`) convergem para mitigação robusta. Nenhuma allowlist de UTILITY foi contornável: `prepareSubmissionPayload` (management) hard-codea `category==="UTILITY"` e `resolveAllowedMapping` restringe `internal_key`/`meta_name` a 3 entradas estáticas — **CONFIRMADO sem bypass encontrado**. Owner/admin: todos os call sites externos a este pacote (`whatsapp-runtime-admin.functions.ts`, `whatsapp-templates-admin.functions.ts`) checam `assertAdminMaster`/`hasAdminMasterRole` (baseado em `user_roles.role='owner'` no banco, não em claim de JWT nem em email) antes de invocar qualquer função deste pacote que grave dado administrativo — **CONFIRMADO**, nenhuma função deste pacote nominal faz sua própria checagem de autorização (por design, documentado no cabeçalho de `whatsapp-quota-admin.server.ts`), portanto a segurança depende inteiramente desses dois arquivos de call site, que foram lidos integralmente.

---

## 4. Testes rodados (números exatos)

Comando: `bun test tests/whatsapp-c11-f3b3-quota-admin.test.ts tests/whatsapp-c11-f4b-template-resolver.test.ts tests/whatsapp-c11-financial-quota-gate.test.ts tests/whatsapp-c92-canary-template-e1e.test.ts tests/whatsapp-c92-template-language-e1e.test.ts tests/whatsapp-c92-template-loader-e3a.test.ts tests/whatsapp-query-guard.test.ts`

Resultado: **174 pass, 0 fail, 444 expect() calls, Ran 174 tests across 7 files** (sem rede, sem banco — confirmado pela ausência de qualquer `fetch`/`rpc` real nos mocks usados, uso de `deps`/stubs injetados em todas as suítes).

Observação metodológica: a primeira tentativa usando `bunx vitest run` falhou nos 6 arquivos que importam `bun:test` (`Cannot find package 'bun:test'`) — corrigido usando `bun test` diretamente, conforme runner nativo do projeto.

Nenhum teste local cobre diretamente `whatsapp-meta-template-submission.server.ts` (`submitTemplateToMeta`) nem `whatsapp-quota.server.ts` (`consumeInboundQuota`/`reserve/commit/release/markAmbiguous/reconcile/getUsageSnapshot`) nem `whatsapp-wikimedia.server.ts` — não foi possível medir cobertura automatizada desses três arquivos nesta rodada; a confiança dos achados correspondentes (TPL-P0-01, TPL-P1-01/02, QA-P2-02, WM-P2-01) baseia-se em leitura estática, marcada como CONFIRMADO quando o comportamento é determinístico e visível diretamente no código-fonte (ex. TPL-P0-01: o `return {ok:true,...}` incondicional após o bloco de update é um fato textual do arquivo, não uma inferência).

---

## 5. Lacunas

1. **Sem teste automatizado para `submitTemplateToMeta`** (arquivo mais sensível do pacote, contém o achado P0): nenhuma suíte local em `tests/` importa `whatsapp-meta-template-submission.server.ts`. Recomenda-se criar teste que injete `fetchFn` mock + `supabaseAdmin` mock para exercitar exatamente o caminho `updateError` truthy e comprovar/quantificar TPL-P0-01 automaticamente.
2. **Sem teste automatizado para `whatsapp-quota.server.ts`**: os 7 wrappers de RPC não têm suíte própria; a validação de fail-closed por `db_error` foi confirmada só por leitura estática.
3. **Sem teste automatizado para `whatsapp-wikimedia.server.ts`**: não foi encontrado `tests/*wikimedia*`; o SSRF hardening (host fixo, `redirect:"error"`, validação de `articleUrl`) é só verificado estaticamente, não por teste de regressão.
4. **`buildWhatsAppGraphUrl`** (dependência de `whatsapp-meta-template-management.server.ts`) está fora do pacote nominal e não foi lido integralmente nesta rodada — a garantia de host fixo `graph.facebook.com` depende dele; declarado NÃO TESTADO.
5. **`resolveCycleForPlan`** (dependência de `whatsapp-financial-quota-gate.server.ts`) também está fora do pacote; o comportamento exato para `plan=null` (usado quando `defaultLoadPlanRow` falha silenciosamente, achado QA-P2-02) não foi confirmado nesta rodada.
6. Não houve acesso a banco real nem a `pg_proc`/`information_schema` nesta auditoria (proibido pelo escopo); a confirmação de `SECURITY DEFINER`/ACL `service_role` das RPCs `*_atomic` baseia-se na leitura do SQL de migração (`drizzle/migrations/20260717193002_*.sql:305-369`) mais o já registrado em `docs/audits/anexo-6-sql-seguranca-testes.md §2.3` ("todas as 34 funções whatsapp_*: anon=f, authenticated=f"), não numa consulta própria ao catálogo do banco de produção.
7. Este pacote não inclui `whatsapp-cycle-resolver.server.ts`, `whatsapp-entitlement.server.ts`, `whatsapp-runtime-config.server.ts`, `whatsapp-graph-version.server.ts` — citados como dependências diretas, mas fora do escopo solicitado; qualquer achado que dependa deles foi marcado NÃO TESTADO/SUSPEITO em vez de CONFIRMADO.

