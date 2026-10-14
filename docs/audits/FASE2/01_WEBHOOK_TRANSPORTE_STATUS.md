# FASE 2 — Pacote 1: Webhook, transporte e status

> Gravado pelo agente principal a partir do relatório do revisor desta área (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`). Texto do revisor preservado abaixo; correções do consolidador vêm primeiro.

## Notas do consolidador

- **P1-01 rebaixado para SUSPEITO.** O revisor não leu `whatsapp.server.ts`. Esse arquivo tem um dedupe próprio por `external_id` (por volta da L2822), e os gastos usam id determinístico por mensagem (`whatsapp-financial-idempotency.server.ts`). Um segundo gasto pela mesma mensagem só sairia se essas duas barreiras falhassem juntas. Teste dirigido pendente.
- **P1-02 reclassificado para P2.** A rota responde 200 à Meta, então a Meta **não** reentrega a mensagem. O cenário de reentrega descrito pelo revisor não ocorre. O fato confirmado é outro: quando o envio da resposta falha, não há nova tentativa, e o usuário fica sem a confirmação de um gasto que foi salvo.

---

# Pacote 1 — Webhook / Transporte / Status WhatsApp (Anexo 2)

**Escopo**: `src/routes/api/public.whatsapp.expense.ts`, `src/server/whatsapp-meta-transport.server.ts`, `src/server/whatsapp-meta-status-callbacks.server.ts`, `src/server/whatsapp-outbound-adapter.server.ts`, `src/server/whatsapp-messages.ts`, `src/server/whatsapp-notifications.server.ts`, `src/server/whatsapp-notification-attempts.server.ts`, `src/server/whatsapp-outbound-quota-wire.server.ts`, `src/server/whatsapp-sent-audit.server.ts`.

HEAD auditado: `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`. Leitura: 100% integral, em blocos consecutivos, sem grep para substituir leitura (grep usado só para localizar o teste `buscarVinculoBotaoGasto` e listar arquivos de teste).

---

## 1. Tabela de cobertura de leitura

| Arquivo | Linhas totais (`wc -l`) | Intervalos lidos | % | Status |
|---|---:|---|---:|---|
| `src/routes/api/public.whatsapp.expense.ts` | 1271 | 1-500, 500-900, 900-1271 | 100% | INTEGRAL |
| `src/server/whatsapp-meta-transport.server.ts` | 706 | 1-400, 400-706 | 100% | INTEGRAL |
| `src/server/whatsapp-meta-status-callbacks.server.ts` | 1179 | 1-400, 400-800, 800-1179 | 100% | INTEGRAL |
| `src/server/whatsapp-outbound-adapter.server.ts` | 840 | 1-420, 420-840 | 100% | INTEGRAL |
| `src/server/whatsapp-messages.ts` | 987 | 1-500, 500-987 | 100% | INTEGRAL |
| `src/server/whatsapp-notifications.server.ts` | 757 | 1-400, 400-757 | 100% | INTEGRAL |
| `src/server/whatsapp-notification-attempts.server.ts` | 488 | 1-488 | 100% | INTEGRAL |
| `src/server/whatsapp-outbound-quota-wire.server.ts` | 344 | 1-344 | 100% | INTEGRAL |
| `src/server/whatsapp-sent-audit.server.ts` | 30 | 1-30 | 100% | INTEGRAL |

Documento de referência da 1ª rodada lido integralmente: `docs/audits/anexo-1-webhook-identidade.md` (247 linhas).

---

## 2. Inventário por arquivo

### 2.1 `public.whatsapp.expense.ts` (1271 linhas) — rota webhook Meta

**`isWhatsAppEnabled()` (L79-88)** — flag fail-closed, exige `WHATSAPP_ENABLED==="true"` + 4 vars não-vazias.
**`isCanaryEnabled()` (L93-96)**, **`checkPhoneEligibility` (L106-111)** — delega a `canUseWhatsAppForSender`.
**`externalIdAlreadyConfirmed` (L129-159)** — dedupe por `external_id` consultando `whatsapp_messages`; `try/catch` engole qualquer erro de SELECT devolvendo `false` (ver achado P1-01).
**`verifyMetaSignature` (L162-173)** — HMAC SHA-256, `timingSafeEqual`, checagem de tamanho igual antes. Confirma W1-P2-01: a validação de hex é implícita via catch, não explícita.
**GET handler (L475-512)** — comparação de verify token timing-safe, tamanho igual antes.
**Zod schemas (L195-297)** — `MetaTextMessage/Image/Audio/Document/Interactive` + fallback `passthrough` para tipos desconhecidos (W1-P2-02 confirmado).
**`extractIncomingMessages` (L328-425)** — achata `entry[].changes[].value.messages[]`; filtra MIME de imagem (`ALLOWED_IMAGE_MIME`, L373-374) e documento (só `application/pdf`, L406-407) na extração; áudio sem filtro aqui (adiado, L387-388, consistente com comentário).
**`downloadWhatsappMedia` (L436-465)** — 2 fetches (lookup + download), buffer completo antes do corte de `maxBytes` (L457-459) — **confirma W1-P2-03**: comentário "sem bufferizar" não corresponde à implementação (bufferiza tudo, só corta depois). Erros nunca logam `.message` (L462-464).
**POST handler (L514-1267)**:
- Rate limit por IP (L516-545), fail-open sobre HMAC (roda antes).
- Limite de corpo 64KB duplo: `content-length` (L550-560) e tamanho real pós-leitura (L562-572).
- HMAC obrigatório (L574-585).
- Parse+Zod (L587-602), erro vira `200 {skipped:"invalid_payload"}` (evita retry infinito da Meta).
- Status callbacks da Meta processados **antes** da extração de mensagens (L604-654); falha transitória → `500` explícito para forçar retry (contrato documentado no comentário L605-614).
- Loop de mensagens (L680-1245): link-verification → opt-out → `productEnabled` → `checkPhoneEligibility` → `runInboundProductionGate` (WA-C11) → bloco `try` de mídia/texto (L811+).
- **Gate duplicate não interrompe (L804-809)**: comentário explícito "Deixamos o dedupe existente decidir". Confirma W1-P1-01 do anexo-1: dupla camada de dedupe (`gate.duplicate` da quota atômica x `externalIdAlreadyConfirmed`) não está sincronizada — `gate.duplicate=true` NÃO interrompe o processamento; apenas comenta a intenção e segue adiante, deixando a checagem de idempotência financeira a cargo de `externalIdAlreadyConfirmed`, chamada só dentro dos branches de imagem/documento/áudio (L855, L902, L966), **não** no branch de texto puro — mensagens de texto reentregues (`gate.duplicate=true`) sem gasto ainda "salva" reexecutam `processarMensagemWhatsApp` integralmente (achado P1, ver seção 4).
- Catch de falha de envio (L1226-1234, L1236-1243): ambos nunca logam `err.message`, apenas `err.name`. Confirma a intenção "WA-B3.4". **Resposta perdida**: se `sendWhatsAppReply`/interactive falham, o usuário não recebe nada (`out.resposta` computado mas não entregue) e o loop segue para a próxima mensagem — não há fila de retry de saída nem persistência da resposta pendente (achado P1, seção 4).
- Log final do webhook (`updateWebhookLog`, L1246-1265) marca `ignored` quando 100% das msgs são `duplicada` — sem PII (`response_body` só com contagens por status).

### 2.2 `whatsapp-meta-transport.server.ts` (706 linhas) — transporte HTTP real

`createMetaWhatsAppNotificationTransport` (L169-220): fail-closed por versão Graph/phone/token/timeout; `fetchFn` default ao `globalThis.fetch`.
`MetaWhatsAppNotificationTransport.sendTemplate` (L261-408): URL via builder fechado (SSRF impossível), token só em header, guarda defensiva contra `access_token` vazar no body (L293-297), `AbortController` com `clearTimeout` em `finally` (L336-338) — nenhum vazamento de listener (remove `abort` listener externo também).
`#readLimited` (L411-454): **CORRIGE o problema do anexo-1** — aqui (outbound, não o download de mídia inbound) o corte é feito via stream real, com `reader.cancel()` assim que `total > max` (L423-432), sem bufferizar tudo. Diferente do inbound (`downloadWhatsappMedia` na rota), que de fato bufferiza por completo.
`#classify` (L466-592): taxonomia conservadora accepted/rejected/ambiguous; 5xx com erro estruturado → `ambiguous` (não `rejected`) por ser inconclusivo (L507-521); 401/403/429 sem corpo estruturado também classificados (L540-584); 400/404/5xx sem estrutura → `ambiguous` conservador (L585-591).
`extractProviderMessageId`/`extractMetaError` (L610-666): sanitização com `CONTROL_CHARS`, limites de tamanho, nenhum campo bruto não sanitizado é logado.
`categorizeStatus` (L668-694): fail-closed a `"unknown"` se categoria fora da allowlist.
Logger padrão (L700-705): nunca loga token/corpo, só `event`+metadados.

### 2.3 `whatsapp-meta-status-callbacks.server.ts` (1179 linhas) — callbacks sent/delivered/read/failed

`parseStatusesFromChangeValue` (L229-344): valida `pmid` (≤256), `status` contra `ALLOWED_STATUS`, timestamp (`normalizeTimestampToUtcIso`, L154-179, rejeita < 2020 ou > now+24h), sanitiza `error_code/title/message`, valida `phone_number_id` esperado (L252-260, descarta lote inteiro se divergente), e `biz_opaque_callback_data` (client_reference) só aceito se string limpa ≤256 chars (L318-324).
`buildEventKey` (L185-197): SHA-256 determinística de `pmid|status|event_at|error_code` — garante idempotência por evento (não por request).
`reduceProviderStatusEvents` (L347-427): redutor puro; regra "nunca regride" (`earlier()`), `sent+failed` resolvido por ordem temporal (L400-402), `hasDeliveryEvidence` (delivered/read) sempre promove a `sent` mesmo com failed presente (L396-399).
`isTransientDbError` (L141-148): allowlist de 8 códigos Postgres permanentes; qualquer coisa fora disso é tratado como transitório (fail-safe para retry, não fail-closed para segurança — aceitável neste contexto pois gera retry, não bypass).
`persistStatusEvent` (L437-485): INSERT com dedupe por `event_key` (unique), `23505`→`duplicate`.
`applyProviderStatusAggregate` (L520-751) — **núcleo da idempotência de status**:
- Auto-heal: relê TODOS os eventos persistidos do PMID (L524-554), não confia só no lote atual — repara writes parciais.
- CAS até 3 tentativas (L565 loop, `APPLY_CAS_MAX_ATTEMPTS=3`), pin em todas colunas lidas no UPDATE (L696-709), confirma com SELECT de verificação pós-UPDATE (L722-741) — defesa adicional contra write silenciosamente não aplicado por trigger/RLS.
- Estados terminais (`cancelled`/`skipped`) nunca reabrem (L593-600).
- `pending` nunca promove status, só preenche timestamps ausentes (L608-636).
- CAS esgotado → `transient: true` (pede retry ao webhook, L746-750) em vez de devolver sucesso espúrio.
`persistAndApplyEvents` (L871-1023): agrupa por PMID; duplicata de evento **NÃO curto-circuita** o apply (comentário L918-919, código L920-934) — é o padrão correto para reconciliar reentregas da Meta. Reconciliação de quota (`reconcileOutboundQuotaFromMetaStatus`, L1010-1021) e de attempts (`rec.reconcile`, L940-971) são best-effort isolados por PMID, nunca derrubam o lote.
`defaultAttemptReconciler` (L834-868): fail-closed explícito se `.rpc` ausente (não normaliza silenciosamente — ver comentário L838-845, hardening correto contra downgrade de infraestrutura).
`processMetaStatusCallbacks` (L1112-1168): nunca lança (try/catch com retorno `requiresWebhookRetry=true` em qualquer exceção do parser, L1150-1160).

### 2.4 `whatsapp-outbound-adapter.server.ts` (840 linhas) — contrato outbound/template

`validateRecipient` (L143-148): usa `normalizePhone` (não reimplementa regex); hash SHA-256 do destinatário, nunca persiste dígitos crus em `request_hash`.
`renderTemplateComponents` (L183-211): valida presença e sanitiza (`sanitizeParam`, L172-180: remove quebras de linha, cap 1024 chars) de cada parâmetro declarado em `payload_schema`.
`resolveTemplateLanguage` (L277-298): fail-closed a `override_invalid`/`payload_schema_invalid`; legado inválido é silenciosamente ignorado e cai no fallback `pt_BR` (não falha o fluxo — aceitável, mas nota de design).
`buildNotificationRequestHash` (L312-327): canonicalização determinística (ordena chaves) — hash estável para idempotência.
`prepareNotificationAttempt` (L378-477): delega para RPC atômica `whatsapp_attempt_prepare_atomic` (SECURITY DEFINER) — fecha a race entre SELECT da notificação e INSERT da tentativa; outcomes discriminados (`state_changed`, `active_attempt_exists`, `quarantined`, `prepared`).
`markAttemptSending` (L520-554): RPC `whatsapp_attempt_mark_sending_atomic`, revalida ownership (claim_token+lease) imediatamente antes do envio — fecha corrida entre prepare e sending.
`completeAttemptAccepted/Rejected/Ambiguous/cancelPlannedAttempt` (L557-663): todos usam `transitionAttempt` (L483-503) com filtro composto `id+attempt_token+status IN fromStatuses` — nenhuma transição aceita sem o token correto.
`executeNotificationAttemptDryTechnical` (L705-827): orquestrador; **erro no transporte (`catch`) sempre vira `ambiguous`** (L762-771) — nunca assume rejeição nem sucesso por exceção de rede, consistente com a doutrina "ambiguous é quarentena". Falha ao persistir `accepted` após o provider aceitar também vira `ambiguous` (L783-794) — proteção contra "enviado mas não registrado".
Nota: por comentário do próprio arquivo (L1-6, L699-704), este módulo **não está integrado ao dispatcher de produção nesta fase** — é infraestrutura técnica usada por `whatsapp-outbound-quota-wire.server.ts` e pelo dispatcher real (`whatsapp-dispatcher-outbound.server.ts`, fora do escopo deste pacote).

### 2.5 `whatsapp-messages.ts` (987 linhas) — textos estáticos

Arquivo de conteúdo puro (objeto `whatsappMessages` com templates de string). Sem lógica de negócio, sem I/O, sem validação de entrada, sem efeitos colaterais. Não há vetor de injeção identificável porque todas as interpolações (`${...}`) recebem valores já formatados/validados pelos chamadores (não lido neste pacote). Nenhum achado de segurança aplicável; incluído por completude de leitura integral.

### 2.6 `whatsapp-notifications.server.ts` (757 linhas) — fila de notificações outbound

Máquina de estados documentada em comentário (L14-44) e implementada fielmente:
`enqueueNotification` (L182-223): idempotente via `upsert(... onConflict: "user_id,dedupe_key", ignoreDuplicates: true)` — idempotência garantida no nível DB, não em memória.
`claimForProcessing` (L241-269): UPDATE condicional (`status='pending' AND scheduled_at<=now AND (next_attempt_at IS NULL OR <=now)`), grava `claim_token/claimed_at/lease_expires_at` atomicamente — um único worker ganha o claim por race no UPDATE do Postgres.
`markSent/markSkipped/markFailed` (L322-424): dois caminhos discriminados — WORKER (exige `claimToken` não-vazio + `status='processing'` + match exato) vs ADMIN (`claimToken=null`, só toca `pending`, nunca `processing`/terminal). `isValidClaimToken` (L311-313) rejeita vazio/whitespace.
`rescheduleForQuietHours`/`recoverStuckReschedule` (L441-494): worker-only, idêntica disciplina de ownership.
`recoverStuckProcessing` (L572-722): **fail-closed deliberado** se `.rpc` ausente e sem `allowLegacyFakePath` explícito (L612-625) — nunca faz downgrade silencioso para o caminho legado em produção. Caminho legado (L680-721) só ativado por opt-in explícito de teste.
`cancelByDedupe`/`cancelByEntity` (L725-756): sempre filtram `.in("status",["pending"])` — nunca tocam `processing` nem terminal, e sempre com `.eq("user_id", userId)` (isolamento por usuário confirmado em L733, L748).

### 2.7 `whatsapp-notification-attempts.server.ts` (488 linhas) — wrappers RPC

5 wrappers (`finalizeAttemptAccepted/Rejected/Ambiguous`, `reconcileAttemptFromCallback`, `recoverNotificationWithAttempt`) para RPCs SECURITY DEFINER. Padrão uniforme: validação de UUID (`isUuid`, L41-43) e texto limpo (`isCleanText`/`CTRL_RE`, L44-46) **antes** de qualquer chamada RPC; outcome desconhecido da RPC é **fail-closed** (`unknown_outcome`, nunca assume sucesso) em todos os 5 wrappers (ex. L199-206, L265-271, L325-331, L389-393, L449-455). `maskId` (L154-157) trunca UUIDs para logs (`slice(0,8)+"…"`) — mascaramento, não hash.

### 2.8 `whatsapp-outbound-quota-wire.server.ts` (344 linhas) — wiring de quota outbound

`runOutboundWithQuota` (L158-343): orquestra `loadPlan → resolveCycle → reserve → run → commit|release|markAmbiguous`. Comentário extenso (L9-58) documenta decisão de não criar tabela nova, reaproveitando `whatsapp_usage_events`. Regras de finalização:
- `gated`/`no_recipient`/`no_template`/`transport_unavailable`/pré-HTTP (`invalid_recipient` etc.)/`state_changed` → sempre `release` (seguro, pois nenhum HTTP disparou).
- `accepted` → `commit`.
- `rejected` → `release` com motivo `provider_rejected:<code>` (nota explícita L271-273: mesmo rejeições retryable liberam a quota já reservada, pois retry futuro reservará de novo).
- `ambiguous` → **nunca libera nem comita**; chama `markReservationAmbiguous` (RPC durável) — consistente com a doutrina de quarentena do adapter. Reserva permanece "contando" até reconciliação por callback ou expiração de ciclo (comentário L50-58, aceito como custo determinístico).
- Idempotência por `reserved.duplicate` com `state IN (committed, ambiguous)` evita rechamar o transporte (L207-216).

### 2.9 `whatsapp-sent-audit.server.ts` (30 linhas) — auditoria read-only

`auditWhatsAppSentMessages` (L15-29): duas contagens (`whatsapp_outbound_queue.status=sent`, `whatsapp_usage_events.usage_type=outbound`) via `Promise.all`; **lança exceção se qualquer uma falhar ou vier `null`** (L26-28) — não confunde erro de query com "zero mensagens enviadas" (comentário L14 confirma a intenção). Nenhuma escrita, nenhum PII.

---

## 3. Confirmação/refutação dos achados W1-* do Anexo 1

| ID Anexo 1 | Resultado neste pacote |
|---|---|
| W1-P2-01 (hex malformado tolerado via catch) | **CONFIRMADO**, releitura idêntica de `verifyMetaSignature` (L162-173). |
| W1-P2-02 (tipos desconhecidos descartados sem métrica) | **CONFIRMADO**, `MetaAnyMessage` fallback passthrough (L280) não gera log/métrica de tipo. |
| W1-P2-03 (comentário "paramos de ler" não bate com código) | **CONFIRMADO** para `downloadWhatsappMedia` (inbound, rota). **Importante adendo**: o transporte outbound (`whatsapp-meta-transport.server.ts #readLimited`, L411-454) **faz o oposto corretamente** — usa stream real com corte antecipado via `reader.cancel()`. A inconsistência de comentário/código é específica do download de mídia inbound, não do outbound. |
| W1-P1-01 (dupla camada de dedupe dessincronizada) | **CONFIRMADO e aprofundado**: `gate.duplicate` (L804-809) explicitamente não interrompe; o comentário do próprio código admite que decide "deixar o dedupe existente decidir". Para mensagens de **texto puro**, não há chamada a `externalIdAlreadyConfirmed` em lugar nenhum do branch de texto (só nos branches image/document/audio, L855/902/966) — uma reentrega de texto com `gate.duplicate=true` mas sem gasto "salva" ainda reprocessa `processarMensagemWhatsApp` por completo (novo achado P1 detalhado abaixo). |
| W1-P2-04 a W1-P2-09 | Fora do escopo direto deste pacote (arquivos não lidos aqui); não confirmados nem refutados. |
| W1-P1-04 (service_role sem rede de segurança RLS) | Aplica-se igualmente aqui: todos os módulos usam `supabaseAdmin`/RPC SECURITY DEFINER — nenhuma tabela deste pacote (`whatsapp_notifications`, `whatsapp_notification_attempts`, `whatsapp_notification_status_events`, `whatsapp_outbound_queue`, `whatsapp_usage_events`) tem RLS como segunda camada eficaz (service_role bypassa sempre). **NÃO VERIFICADO** se RLS existe nessas tabelas (fora do escopo, SQL não lido). |

---

## 4. Tabela de achados

| ID | Severidade | Confiança | path:linhas | Descrição | Reprodução (dados fictícios) | Sugestão |
|---|---|---|---|---|---|---|
| **P1-01** | P1 | CONFIRMADO | `public.whatsapp.expense.ts:803-809` + `854-858,901-905,965-968` | `gate.duplicate=true` não interrompe o fluxo; `externalIdAlreadyConfirmed` só é chamado nos branches de imagem/documento/áudio, **nunca** no branch de texto puro. Uma reentrega de texto cujo `external_id` já foi contado na quota (`gate.duplicate=true`) mas cujo registro em `whatsapp_messages` ainda não tem `status="salva"` (ex.: falhou/travou entre a contagem de quota e o save) é reprocessada do zero pelo parser financeiro. | Usuário envia "Uber 29,90" (wamid `wamid.ABC123`). A API Meta reentrega o mesmo payload (timeout de rede do lado da Meta) antes do primeiro processamento terminar de persistir o gasto. Segunda chamada: `gate.duplicate=true`, segue adiante, `externalIdAlreadyConfirmed("wamid.ABC123")` nunca é chamado (é texto), `processarMensagemWhatsApp` roda de novo e pode criar um segundo gasto de R$29,90. | Chamar `externalIdAlreadyConfirmed` também no branch de texto (ou generalizar a checagem para todos os tipos de mensagem logo após `gate.duplicate`), não só em imagem/documento/áudio. |
| **P1-02** | P1 | CONFIRMADO | `public.whatsapp.expense.ts:1171-1234` | Quando `sendWhatsAppReply`/`sendWhatsAppInteractiveCtaUrl`/`sendWhatsAppInteractiveReply` falham (catch em L1226-1234), a resposta computada (`out.resposta`) é perdida — não há fila de retry de saída, não há persistência do texto pendente, e o `results.push({status: out.status, gasto_id})` já ocorreu em L1166 antes da tentativa de resposta, ou seja: o gasto FOI salvo (efeito financeiro irreversível) mas o usuário nunca recebe a confirmação. Reenvio da Meta do mesmo wamid resultaria em `duplicada` (status já "salva"), e por W-3.27 (L1168-1171) nenhuma resposta é enviada para `status==="duplicada"` — portanto o usuário nunca mais recebe confirmação daquele gasto específico mesmo em reentregas subsequentes. | Usuário envia "Mercado 50,00". Gasto é salvo com sucesso (`out.status="salva"`). Rede cai no momento exato de `sendWhatsAppReply` (timeout do fetch para Graph API). Catch captura, loga só `err.name`, loop continua. Meta reentrega o mesmo wamid minutos depois (reentrega padrão por falta de ACK visível à Meta, já que o webhook retornou 200 na primeira tentativa). Segunda chamada: `externalIdAlreadyConfirmed` retorna true → `status: "duplicada"` → `out.status !== "duplicada"` é falso → bloco de resposta nem é tentado (L1168). Usuário nunca recebe confirmação do gasto de R$50. | Persistir um "outbox" de resposta pendente associado ao `external_id`/gasto_id quando o envio de confirmação falha, com retry assíncrono (ex.: via `whatsapp_notifications`), independente da idempotência de "duplicada" do pipeline financeiro. |
| **P2-01** | P2 | CONFIRMADO | `public.whatsapp.expense.ts:436-465` vs `whatsapp-meta-transport.server.ts:411-454` | Inconsistência de padrão entre os dois downloads/leituras HTTP do sistema: o outbound (`#readLimited`) corta a leitura via stream assim que excede `maxBytes`; o inbound (`downloadWhatsappMedia`) bufferiza o `arrayBuffer()` inteiro antes de checar o tamanho, apesar do comentário dizer o contrário. Baixo risco prático (fonte da URL é a própria Meta, não o atacante), mas é uma divergência de padrão de hardening entre dois módulos do mesmo pacote. | — (já documentado e reconfirmado do anexo-1, W1-P2-03). | Reescrever `downloadWhatsappMedia` para usar leitura em stream com corte antecipado, no mesmo padrão de `#readLimited`, alinhando comentário e implementação. |
| **P2-02** | P2 | CONFIRMADO | `whatsapp-outbound-adapter.server.ts:291-297` | Guarda defensiva "replicamos" contra `access_token` vazar no body do payload Meta é feita só depois de `buildWhatsAppTemplateRequest` já ter montado o objeto — se o builder (D.1, não lido neste pacote) algum dia inserir o campo, a guarda detecta e aborta com `ambiguous`/log, mas **o payload com o token embutido já existiu em memória** antes da checagem. Não é uma falha ativa (builder atual nunca insere o campo), apenas defesa em profundidade com janela teórica de existência do dado sensível em memória antes do descarte. | — | Validar a ausência de `access_token` dentro do próprio `buildWhatsAppTemplateRequest` (fail-fast na origem), não só no transporte. |
| **P2-03** | P2 | NÃO TESTADO | `public.whatsapp.expense.ts:1196-1210` | `waServer.buscarVinculoBotaoGasto?.(...)` é chamado com optional chaining (`?.`) — se a função não existir no módulo importado via `import * as waServer`, a chamada silenciosamente retorna `undefined` e cai em `?? null`, tratando como "sem vínculo" sem erro nem log. Isso é defensivo, mas mascara um possível erro de wiring/import em produção (ex.: refactor que renomeia a função sem atualizar este call site) sem qualquer sinal de alerta. | Hipoteticamente: renomear `buscarVinculoBotaoGasto` em `whatsapp.server.ts` sem atualizar a chamada aqui. Nenhum teste unitário pegaria isso neste arquivo (o `?.` suprime o `TypeError`), só um erro de tipo do TypeScript detectaria (e só se o `waServer` não for tipado como `any`/wildcard). | Remover o optional chaining (import nomeado direto) ou adicionar log explícito quando `buscarVinculoBotaoGasto` resolver para `undefined`. |
| **P2-04** | P2 | CONFIRMADO | `whatsapp-notifications.server.ts:613-625` vs `whatsapp-outbound-quota-wire.server.ts` (não usa `recoverStuckProcessing` diretamente) | Duplicação de guarda fail-closed `.rpc` ausente em dois lugares (`whatsapp-notifications.server.ts:612-625` e `whatsapp-meta-status-callbacks.server.ts:836-851`), cada um com sua própria mensagem de log e campo `detail`/`reason`. Não é um bug, mas é código duplicado que pode divergir com o tempo (um dos dois pode ser corrigido/hardenizado e o outro esquecido). | — | Extrair um helper comum `assertRpcAvailableOrFailClosed(client, opts)` reutilizado pelos dois módulos. |
| **P2-05** | P2 | SUSPEITO | `public.whatsapp.expense.ts:623-627` | `console.info` de `statusSummary` roda apenas se `received > 0 || retryableErrors > 0` — ou seja, lotes de status totalmente compostos por eventos `unknown_status`/`wrong_phone_number`/`invalid` (que não entram em `received`, pois esses contadores ficam em `ParseOutcome`, não agregados antes da chamada) não geram log algum no nível da rota. Combinado com a ausência de alertas/métricas dedicadas, um atacante ou uma mudança incompatível da Meta que envie `phone_number_id` sistematicamente errado passaria despercebida nos logs do webhook (silenciosamente descartada, sem retry e sem log). | Enviar repetidamente um payload de status com `metadata.phone_number_id` diferente do configurado — `wrong_phone_number` incrementa, mas nem `received` nem `retryableErrors` mudam (ver `parseStatusesFromChangeValue` L252-260: retorna cedo sem popular `events`), então o `console.info` de L627 nunca dispara. | Incluir `unknown_status`/`wrong_phone_number`/`invalid` no critério de log, ou emitir métrica dedicada independente do `console.info` condicional. |

**Nenhum achado P0 confirmado** nos 9 arquivos deste pacote — não há bypass de HMAC, de ownership/claim_token, de idempotência financeira irreversível sem ao menos um gate parcial, nem vazamento de PII/token em log persistido.

---

## 5. Testes executados (números exatos)

Comando: `bun test <12 arquivos>` (runner correto identificado após falha inicial com `vitest`, que não suporta `bun:test`).

```
 308 pass
 0 fail
 943 expect() calls
Ran 308 tests across 12 files. [2.45s]
```

Arquivos de teste executados e relacionados a este pacote:
- `tests/whatsapp-webhook-http.test.ts` — HMAC, rate limit, Zod, eligibilidade, dedupe por imagem, sanitização de log (PASS, incluso nos 308).
- `tests/whatsapp-webhook-replay-3-27.test.ts` — replay/duplicata não dispara resposta (PASS).
- `tests/whatsapp-c92-meta-status-callbacks.test.ts` — parser/redutor/apply de status (PASS).
- `tests/whatsapp-c92-meta-transport-d2b1.test.ts` — transporte HTTP outbound, classificação accepted/rejected/ambiguous (PASS).
- `tests/whatsapp-notifications-c8.test.ts` — enqueue/claim/backoff/gates (PASS).
- `tests/whatsapp-sent-audit.test.ts` — auditoria read-only (PASS).
- `tests/whatsapp-c11-f3b2d-outbound-wire.test.ts` — wiring de quota outbound (PASS).
- `tests/whatsapp-c92-attempts-d2a.test.ts` — wrappers RPC de attempts (PASS).
- `tests/whatsapp-c92-outbound-attempts-d1.test.ts` — adapter outbound D.1 (PASS).
- `tests/whatsapp-c92-ownership-strict.test.ts` — ownership por claim_token (PASS).
- `tests/whatsapp-c92-processing-lease-recovery.test.ts` — lease/recovery (PASS).
- `tests/whatsapp-c92-recovery-anti-ambiguous-e4c.test.ts` — guarda anti-ambiguous (PASS).

Não foram executados testes de rede/banco real (proibido pelo escopo READ-ONLY); todos os 12 arquivos usam fakes/stubs/mocks locais, consistente com a política do projeto.

**Nenhum teste cobre diretamente os achados P1-01 e P1-02** (dedupe de texto puro reentregue antes de "salva"; perda de resposta após falha de envio com gasto já persistido) — os testes existentes de replay (`whatsapp-webhook-replay-3-27.test.ts`) cobrem apenas o caso em que o gasto **já está** `status="salva"`, não o caso intermediário (quota contada, mas save ainda não concluído) nem o caso de falha de rede na entrega da confirmação.

---

## 6. Lacunas

1. **SQL/RPCs não lidas**: `whatsapp_attempt_prepare_atomic`, `whatsapp_attempt_mark_sending_atomic`, `whatsapp_attempt_finalize_*_atomic`, `whatsapp_attempt_reconcile_callback_atomic`, `whatsapp_notification_recover_with_attempt_atomic`, `whatsapp_outbound_reservations`/`whatsapp_usage_events` (RPCs de reserve/commit/release/markAmbiguous) — toda a correção transacional dessas RPCs (SECURITY DEFINER, `pg_advisory_xact_lock`) é **NÃO VERIFICADA** neste pacote; a análise aqui assume que o contrato descrito nos comentários TS corresponde à implementação SQL real.
2. **RLS das tabelas envolvidas** (`whatsapp_notifications`, `whatsapp_notification_attempts`, `whatsapp_notification_status_events`, `whatsapp_outbound_queue`, `whatsapp_usage_events`, `whatsapp_messages`) — **NÃO VERIFICADO**; service_role bypassa RLS sempre, então é relevante apenas como defesa em profundidade teórica.
3. **Dispatcher real de produção** (`whatsapp-dispatcher-outbound.server.ts`, `whatsapp-quota.server.ts`, `whatsapp-cycle-resolver.server.ts`) — referenciados por `whatsapp-outbound-quota-wire.server.ts` mas fora do escopo deste pacote; a corretude de `runOutboundForNotification` (chamado em L219 do wire) não foi auditada aqui.
4. **`whatsapp.server.ts`** (`processarMensagemWhatsApp`, `sendWhatsAppReply`, `buscarVinculoBotaoGasto`) — módulo central do pipeline financeiro importado pela rota, não lido neste pacote; os achados P1-01/P1-02 descrevem o comportamento observável na rota, mas não confirmam se `processarMensagemWhatsApp` tem alguma proteção interna adicional contra duplo processamento financeiro de texto (sessões, por exemplo) que mitigue parcialmente o risco descrito.
5. Não foi possível, dentro do escopo, confirmar empiricamente (com um teste reproduzindo a race exata) os achados P1-01/P1-02 — são **CONFIRMADO por leitura de código**, não por execução de um cenário de concorrência real; marcados como tal na tabela.

