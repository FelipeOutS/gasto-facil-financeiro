# Anexo 1 — Auditoria: Webhook WhatsApp & Identidade

Escopo: `src/routes/api/public.whatsapp.expense.ts` (handler GET/POST/OPTIONS do webhook Meta) e os módulos server de suporte diretamente envolvidos em assinatura, autorização, elegibilidade, entitlement, beta, rollout, runtime config, opt-out, verificação de vínculo, gates de saída, logging de saída, dispatcher, interactive, sanitização de erro, versão da Graph API, validação/sanitização de mídia, rate limit e auth de API.

Convenções: IDs `W1-P0` (crítico/bloqueante), `W1-P1` (alto), `W1-P2` (médio/baixo/observação). HIPÓTESE = suspeita não totalmente confirmada no código lido. NÃO VERIFICADO = fora do escopo lido neste anexo (ex.: SQL de RPCs, triggers, migrations).

---

## 1. Verificação de assinatura Meta (HMAC) — `public.whatsapp.expense.ts:162-173`

```
function verifyMetaSignature(rawBody: string, headerValue: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !headerValue) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = headerValue.startsWith("sha256=") ? headerValue.slice(7) : headerValue;
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}
```
- **Comparação é timing-safe** (`timingSafeEqual`), com checagem de tamanho igual antes (evita exceção de tamanho desigual, prática correta).
- `Buffer.from(received, "hex")`: se `received` não for hex válido, `Buffer.from` NÃO lança — produz um buffer truncado/parcial em runtime Node (decodifica até o primeiro caractere inválido, ignorando o resto). Isso é tolerado pelo `try/catch`, mas o comportamento efetivo é "buffer mais curto que `expected`", que falhará em `timingSafeEqual` por tamanho diferente — exceção capturada, `return false`. Comportamento final é seguro (nega), mas funciona por acidente do catch, não por validação explícita do formato hex. **W1-P2** — adicionar validação explícita de `/^[0-9a-f]+$/i.test(received)` deixaria a intenção clara e removeria dependência do catch.
- Corpo é lido 1x (`request.text()`) e reusado tanto para HMAC quanto para JSON.parse — correto (não há dessincronia entre o que foi assinado e o que foi parseado).
- **Ordem confirmada**: rate limit (IP) → limite de tamanho (`content-length` E tamanho real pós-leitura) → HMAC → parse Zod → callbacks de status → extração de mensagens → link-verification → opt-out → flags → elegibilidade → gate C11 → mídia/IA. Rate limit roda **antes** do HMAC (linhas 518-545), o que é aceitável pois é por IP e protege contra flood antes de computar HMAC, mas permite que qualquer IP (mesmo sem segredo) consuma 60 reqs/min antes de ser rejeitado — comportamento esperado de rate limit de borda, não falha.

## 2. GET de verificação do webhook — linhas 476-512

```
if (mode === "subscribe" && typeof token === "string" &&
    token.length === envToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(envToken))) { ... }
```
- Comparação timing-safe correta, com checagem de tamanho igual antes de `timingSafeEqual` (evita exceção) — **correto**.
- Falha de config (`WHATSAPP_VERIFY_TOKEN` ausente) retorna 500 com texto simples — não vaza segredo. OK.
- **W1-P2**: a comparação usa `Buffer.from(token)`/`Buffer.from(envToken)` em UTF-8 puro (não hex), compatível por serem strings simples — correto, sem o problema de decodificação hex do item 1.

## 3. Payload — normalização e validação Zod (linhas 192-425)

- `MetaPayload` aceita apenas `object`, `entry[]` (≤20), `changes[]` (≤20), `messages[]` (≤50) — limites de tamanho de array evitam payload bomb estrutural (ainda que o corpo já esteja limitado a 64 KB por `MAX_RAW_BODY`, linha 467 e checagens 550-572).
- `MetaAnyMessage` é uma union com fallback `z.object({id, type}).passthrough()` — mensagens de tipos não tratados (ex. `sticker`, `location`, `contacts`, `reaction`) são aceitas pelo schema (fallback) mas **não entram em `extractIncomingMessages`** (apenas text/interactive/image/audio/document são extraídos) — descartadas silenciosamente, sem erro, sem log de tipo desconhecido. Não há vazamento, mas também não há observabilidade de volume de tipos não suportados (**W1-P2** — métrica ausente).
- Dedupe de mídia MIME: `ALLOWED_IMAGE_MIME` filtra na extração (linha 374); documento filtra apenas `application/pdf` (linha 407); áudio não filtra na extração (o filtro do MIME declarado ocorre depois, linha 971-982, antes do download) — **consistente com o comentário do código**: extração só dos metadados, validação real adiada.
- Texto limitado a 1000 chars (`MetaTextMessage.text.body` max 1000) e `nfm_reply.response_json` max 10000 chars — limites razoáveis contra payloads grandes.

## 4. Ordem de identidade/plano/link/consentimento ANTES de IA/OCR/download — linhas 680-900 (CONFIRMADO)

Sequência real por mensagem no loop principal:
1. `logWhatsAppInboundReceived` (log técnico, sem persistência financeira) — linha 691.
2. `completeWhatsAppLinkVerification` (confirmação de vínculo via texto "CONFIRMAR GASTO INTELIGENTE ...") — roda **antes de qualquer gate de elegibilidade**, pois é o próprio mecanismo de habilitação do vínculo. Correto, pois este fluxo não lê/grava dados financeiros (`whatsapp-link-verification.server.ts:77-93`, usa RPC `whatsapp_complete_link_verification`).
3. `detectOptout` + `executeOptoutForSender` — roda antes de `productEnabled`, antes de elegibilidade, antes de qualquer IA/OCR. Comentário no código confirma a intenção ("Opt-out belongs to the transport boundary, before link activity, subscription..."). **Correto e documentado.**
4. `isWhatsAppEnabled()` (flag de produto) — bloqueia tudo abaixo se false.
5. `checkPhoneEligibility` → `canUseWhatsAppForSender` (vínculo ativo + opt-in + não revogado + admin master OU entitlement de plano) — **confirmado que roda antes de qualquer download de mídia/OCR/Whisper** (linha 748, antes do bloco `try` de processamento de imagem/áudio/documento que começa em 811).
6. `runInboundProductionGate` (WA-C11: runtime.global/inbound, entitlement, rollout, ciclo, quota atômica) — roda **depois** da elegibilidade e **antes** de qualquer bloco de mídia (linha 796, antes do `try` de 811). Confirmado pela leitura linear do código.
7. Somente dentro do `try` (811+) ocorrem downloads de mídia (imagem/áudio/documento) e chamadas a OCR/Whisper, sempre precedidas por `externalIdAlreadyConfirmed` (dedupe) e por entitlement específico (`podeUsarOcrComprovante`, flag de áudio).

**Conclusão**: a ordem identidade → plano → vínculo → consentimento → runtime/rollout/quota → mídia/IA está de fato implementada na rota principal e é coerente com os comentários do próprio código. Não encontrei um caminho de bypass para texto comum. **W1-P1 (parcial, ver item 4a)**: a rota de **imagem com caption “pesquisa de produto”** (`isProductImageCaption`, linha 862) dispara `sendWhatsAppReply` **antes** do gate de `podeUsarOcrComprovante` (linha 869) — mas isso ocorre **depois** de `elig.allowed` e do gate C11 (786-803), portanto a ordem canônica identidade/plano continua respeitada; apenas o gate específico de OCR é pulado para esse ramo porque a imagem não é baixada nesse caso (correto, pois não há OCR). Não é falha.

### 4a. Observação sobre ordem dentro do bloco de imagem
Linha 853-891: ordem real é (1) dedupe `externalIdAlreadyConfirmed`, (2) heurística de "foto é pedido de pesquisa de produto" (responde e sai, SEM checar `podeUsarOcrComprovante` antes, mas também sem baixar mídia), (3) `podeUsarOcrComprovante`, (4) download, (5) validação de bytes mágicos, (6) data URL → pipeline. A ordem documentada no comentário (linhas 812-823) bate com o código. **OK.**

## 5. Download de mídia — `downloadWhatsappMedia` (linhas 436-465)

- Usa `buildWhatsAppGraphUrl({kind:"media_lookup", mediaId})` — URL fechada, versão de Graph validada via allowlist estrita (`whatsapp-graph-version.server.ts`, só aceita `v20.0`, fail-closed em qualquer outro valor/ausência). **Boa prática.**
- Limite de tamanho aplicado **depois** de baixar o buffer inteiro: `const buf = Buffer.from(await dl.arrayBuffer()); if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;` (linhas 457-459). **W1-P1**: não há streaming com corte antecipado — um host malicioso controlando a URL assinada da Meta (cenário improvável, pois a URL vem da própria Meta) poderia forçar buffering completo de um arquivo grande antes do corte. Como a URL de mídia é obtida via Graph API oficial (não é input do atacante), o risco real é baixo, mas o comentário do código ("Limite duro: paramos de ler se passar de maxBytes, sem bufferizar 100 MB") **não corresponde ao comportamento real** (o código efetivamente bufferiza tudo antes de cortar) — **inconsistência entre comentário e implementação**, classificar como **W1-P2** (doc/código dessincronizados, sem exploração prática óbvia dado que a fonte da URL é confiável).
- Erros nunca logam `err.message` (comentado e implementado corretamente, linha 462-464) — mitigação deliberada contra vazamento de URL assinada/token em logs. **Boa prática confirmada.**
- Token de acesso (`WHATSAPP_ACCESS_TOKEN`) é lido do `process.env` e usado em `Authorization: Bearer` — nunca logado. **OK.**

## 6. Dedupe/idempotência por `external_id` (WAMID)

- `externalIdAlreadyConfirmed` (linhas 129-160): consulta `whatsapp_messages` por `external_id`, considera "já confirmado" apenas se `status === "salva"` E (`gasto_id` OU receita confirmada). **Importante**: isso é dedupe de **resultado financeiro**, não dedupe de **processamento**. Uma mensagem que falhou no meio do pipeline (ex.: OCR falhou, status != "salva") pode ser reprocessada em reentrega da Meta — correto por design, mas significa que não há proteção contra reprocessamento de passos custosos (download, OCR) para mensagens que não geraram gasto ainda. **NÃO É O MESMO** que a quota (`runInboundProductionGate`), que é idempotente via RPC atômica com idempotency key = `external_id` (comentário explícito em `whatsapp-c11-gates.server.ts:31-32` e uso em `whatsapp-financial-idempotency.server.ts`, NÃO VERIFICADO em detalhe pois fora do escopo lido integralmente deste anexo).
- O gate C11 retorna `duplicate: true` quando a quota já foi consumida para esse `external_id` (RPC `whatsapp_consume_inbound_quota_atomic`, NÃO VERIFICADO em SQL), e o código webhook **não usa** esse `gate.duplicate` para pular diretamente o processamento (comentário nas linhas 804-809 diz explicitamente que deixa o dedupe de `externalIdAlreadyConfirmed` decidir). Ou seja, há **duas camadas de dedupe não sincronizadas**: uma por quota (gate C11, idempotente via RPC) e outra por resultado financeiro salvo (`externalIdAlreadyConfirmed`). **W1-P1**: se a quota WA-C11 marcar `duplicate=true` mas a mensagem nunca chegou a `status="salva"` (ex.: falhou no parser antes), o webhook **reprocessa integralmente** o pipeline de novo (incluindo possíveis novas chamadas a IA/parser) sem uma trava de concorrência explícita nesse ponto. Não há lock por `external_id` visível nesta rota (`processarMensagemWhatsApp` — corpo não lido neste anexo, **NÃO VERIFICADO**), portanto **concorrência entre duas reentregas simultâneas da Meta para o mesmo WAMID não está comprovadamente protegida neste arquivo** além da quota atômica (que é sobre contagem, não sobre exclusão mútua de efeitos colaterais). Recomenda-se verificar `whatsapp-financial-idempotency.server.ts` (fora do escopo deste anexo) para confirmar se há lock/claim por `external_id` antes de qualquer escrita financeira.
- Em caso de reentrega totalmente duplicada (`status: "duplicada"` para todas as mensagens do lote), o `webhook_logs` é marcado como `ignored` em vez de `processed` (linhas 1246-1252) — bom controle de observabilidade, evita sugerir efeito colateral novo quando não há.
- Supressão de resposta para status `"duplicada"` (linha 1172: `out.status !== "duplicada"`) evita reenviar "mensagem já processada" ao usuário em reentregas — correto do ponto de vista de UX, mas também significa que uma reentrega real da Meta (ex.: timeout do primeiro ACK) não reconfirma nada ao usuário; aceitável.

## 7. Status callbacks (sent/delivered/read/failed) — `whatsapp-meta-status-callbacks.server.ts`

- Rodam **depois de HMAC/Zod** e **antes** da extração de mensagens de conteúdo (`public.whatsapp.expense.ts:604-654`) — confirmado pelo comentário e pela posição do código.
- Falha transitória de DB (`isTransientDbError`, linhas 140-148) força `requiresWebhookRetry = true` → a rota responde **500** para a Meta reenviar (linha 637). Isso é correto para não perder eventos de status, mas **implica que mensagens de conteúdo no MESMO lote também não são processadas nesse request** (comentário explícito: "Não processamos mensagens no mesmo request"). Isso é seguro porque a Meta reenviará o webhook inteiro, e o pipeline de mensagens já é idempotente por `external_id` — **mas depende da garantia de idempotência completa do item 6, que tem a ressalva acima.**
- Dedupe de evento de status via `event_key = sha256(provider_message_id|status|event_at|error_code)` com unicidade garantida por `23505` tratado como sucesso idempotente (`persistStatusEvent`, linhas 466-470). **Boa prática.**
- `applyProviderStatusAggregate` implementa CAS com até 3 tentativas (`APPLY_CAS_MAX_ATTEMPTS = 3`, linha 101) e regra "nunca regride" (MIN() para sent/delivered/read, bloqueio de failed sobrepor sent). Lido até a linha 700; a lógica de CAS e re-leitura de eventos (auto-heal) está implementada corretamente conforme o comentário. **Páginas 700-1179 do arquivo NÃO foram lidas integralmente neste anexo** (ver tabela de cobertura) — ficam como NÃO VERIFICADO quaisquer detalhes adicionais além do trecho 1-700.
- Sanitização de texto de erro (`sanitizeText`, `sanitizeCode`) remove caracteres de controle e trunca — mitigação razoável contra injeção de log, mas **não impede PII arbitrária dentro do limite de 1000 chars** caso a Meta inclua, por exemplo, parte de um número de telefone dentro de `error.message` — **W1-P2** (hipótese, Meta normalmente não inclui PII nessas mensagens, mas não há filtro de padrão de dígitos longos aqui como existe em `whatsapp-outbound-log.server.ts:sanitizeErrorText`, que SIM remove sequências de ≥8 dígitos). **Inconsistência entre os dois sanitizadores de erro** (outbound-log redige dígitos longos; meta-status-callbacks não) é uma observação válida — **W1-P2**.

## 8. Rate limiting — `rate-limit.server.ts`

- `checkRateLimit` delega para RPC `rate_limit_hit` (SQL não lido, **NÃO VERIFICADO** se é atômico no banco — mas há teste dedicado `tests/rate-limit-atomic-c82.test.ts`, sugerindo atomicidade testada).
- Fail-open em erro de RPC/exceção: `return { blocked: false, ..., dbError: true }` (linhas 78-83) — ou seja, **se o banco estiver indisponível, o rate limit abre** (não bloqueia). Para o webhook público do WhatsApp isso é uma escolha de disponibilidade sobre segurança — aceitável dado que o HMAC ainda protege contra tráfego não assinado, mas **DIFERENTE do padrão fail-closed usado em outros gates do WhatsApp** (authz, entitlement, runtime-config são todos fail-closed). **W1-P2** — inconsistência de postura (rate limit é a única camada fail-open do pipeline).
- `enforceUserRateLimit` aceita `failMode: "open"|"closed"` explicitamente nos call sites que o usam (fora do escopo direto da rota webhook, que usa `checkRateLimit` diretamente sem failMode configurável) — a rota do webhook sempre usa o comportamento fail-open padrão de `checkRateLimit`.
- Preset `whatsappWebhook = { limit: 60, windowSeconds: 60 }` — 1 req/seg em média por IP; parece razoável para um webhook de produção com potencial de múltiplas mensagens por lote.
- `shouldSendBlockedReply` (em `whatsapp-authz.server.ts:137-150`) usa uma chave de rate limit derivada de **hash truncado (32 hex chars) do telefone**, nunca o telefone bruto — mitigação de PII em `rate_limit_events.key` confirmada pelo código e pelo comentário.

## 9. PII em logs — avaliação transversal

- `logWebhookEvent`/`updateWebhookLog` (não lidos integralmente, mas usados apenas com `status`, `http_status`, `error_message` curto, `external_id`, `processing_time_ms`, `response_body` agregado por contagem) — **sem telefone, sem texto** em nenhum dos call sites da rota principal. Confirmado nas linhas 530-544, 552-571, 577-584, 593-601, 630-636, 646-652, 659-664, 1246-1265.
- `console.error`/`console.info` nunca incluem `err.message` cru nos pontos de reply/download (padrão `errorName: e instanceof Error ? e.name : "unknown"` repetido em pelo menos 6 lugares: 761-764, 957-960, 1048-1052, 1085-1088, 1106-1109, 1125-1128, 1227-1233, 1239-1242) — **boa prática consistente**.
- `whatsapp-entitlement.server.ts: logDecision` usa `hashUserId = userId.slice(0,8)` — não é hash criptográfico, é apenas um prefixo do UUID. Isso **não é PII direta** (não é telefone/email), mas é um identificador quase-único reversível por correlação com a tabela de usuários — classificar como **W1-P2** (observação de nomenclatura: "hash" é enganoso, é truncamento, não hashing; não gera vazamento de PII per se pois UUID já é um identificador interno, não um dado pessoal direto).
- `whatsapp-c11-gates.server.ts: hashId` tem o mesmo padrão (`id.slice(0,8)`), mesmo comentário aplicável.
- `whatsapp-optout.server.ts: safeHash` (linhas 103-110) implementa um hash FNV-like não criptográfico de 32 bits para log — **não-reversível na prática para telefone cru** (nunca recebe telefone, apenas `userId` via `buildOptoutAudit`), adequado ao propósito declarado.
- `whatsapp-outbound-log.server.ts`: grava apenas `recipient_hash` (SHA-256 truncado) e `recipient_last4` — não grava telefone completo nem conteúdo da mensagem (apenas `content_sha256` + `content_length`). **Boa prática confirmada.**
- `wa_audio_money_normalization` log (linha 1142-1147) grava `moneyDetected`, `normalizedValuesCount`, `applied` — não grava o texto transcrito nem valores monetários literais. **OK.**
- **W1-P1**: o comentário de cabeçalho da rota (linhas 69-72) promete "Telefones e textos completos NUNCA são gravados em `webhook_logs`" — confirmado para `webhook_logs`, mas **não cobre `whatsapp_messages`**, que por design (ver `externalIdAlreadyConfirmed`, que lê `telefone`? não lê — lê `id, status, gasto_id, parsed`) grava telefone em outra tabela (`whatsapp_links`, `whatsapp_messages` — **NÃO VERIFICADO neste anexo**, pois o schema de `whatsapp_messages` e o corpo de `processarMensagemWhatsApp` não fazem parte do escopo de arquivos lidos). Classificado como **NÃO VERIFICADO** e não como falha, pois é esperado que uma tabela operacional grave o telefone do vínculo — mas fica como lacuna de cobertura para um próximo anexo.

## 10. Opt-out — `whatsapp-optout.server.ts`

- Reconhecimento **por mensagem íntegra normalizada**, nunca substring (`detectOptout`, linhas 90-98) — testado explicitamente contra falsos positivos documentados (`OPTOUT_FALSE_POSITIVES`, linhas 51-63, mas o comentário na linha 50 diz "Nunca são consultadas em runtime" — são apenas documentação/smoke test, não usadas em runtime; confirmei isso é apenas uma constante exportada, sem uso de produção neste arquivo). **OK, consistente com o comentário.**
- `executeOptoutForSender` (linhas 237-271): resolve o dono do telefone por candidatos de normalização (com/sem DDI 55) e **requer exatamente 1 owner** (`owners.size !== 1 → "unknown"`) — mitigação correta contra ambiguidade/telefones compartilhados por múltiplos vínculos.
- `executeOptoutRevocation`: revoga **todos** os vínculos ativos do usuário (`whatsapp_revoke_links` RPC, `p_link_id: null`) e cancela apenas notificações `pending` sem `claim_token` (não mexe em processing/sending/sent/delivered/read) — consistente com o comentário de não regressão de efeitos já em voo.
- Falha em SELECT inicial retorna `{ok:false, reason:"select_error"}` sem reverter nada (fail-safe, não aplica opt-out parcial). Falha em `whatsapp_revoke_links` RPC também aborta sem side effects parciais confirmados **exceto** que o SELECT já rodou (leitura, sem efeito). OK.
- O outcome de erro é propagado até a rota como `"retry"` → resposta HTTP 500 (linha 728: `if (outcome === "retry") return jsonResponse({ error: "transient_optout_failure" }, 500)`), fazendo a Meta reenviar — correto para não perder um opt-out por falha transitória.

## 11. Verificação de vínculo (link) — `whatsapp-link-verification.server.ts`

- Token gerado com `randomBytes(12)` mapeado para alfabeto de 32 símbolos sem caracteres ambíguos (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, exclui I/O/0/1) — boa prática de UX+segurança.
- Hash do token usa `sha256("wa-link-v1:" + token.toUpperCase())` — salted por um prefixo de versão fixo (não é um "salt" criptográfico real, é um domain separator). Isso é aceitável para tokens de alta entropia (96 bits de `randomBytes(12)`), mas **não há rate limit visível na função `completeWhatsAppLinkVerification`** contra tentativas de força bruta de token por um atacante que conheça o número de telefone-alvo e tente adivinhar os 12 caracteres — **W1-P1 (HIPÓTESE)**: a trava real de força bruta pode estar na RPC `whatsapp_complete_link_verification` (ex.: expiração curta do token, contador de tentativas) — **NÃO VERIFICADO** pois é SQL fora do escopo. Dado 96 bits de entropia, força bruta online é impraticável mesmo sem rate limit adicional, mas a ausência de um limite explícito no código de aplicação é uma lacuna de defesa em profundidade.
- `completeWhatsAppLinkVerification` só é chamada após HMAC+Zod (confirmado pela posição no webhook) — mitigação contra spoofing de remetente.

## 12. Entitlement / Beta / Rollout / Runtime config

- `whatsapp-entitlement.server.ts` é a fonte única (`getWhatsAppEntitlement`), fail-closed em exceção (linhas 243-247, captura tudo e retorna `blocked("internal_error")`).
- **Admin Master bypassa plano/beta mas NÃO bypassa runtime global/inbound** — confirmado no comentário de `whatsapp-c11-gates.server.ts:25-27` e no código (`runInboundProductionGate` checa `rc.global_enabled`/`rc.inbound_enabled` **antes** de resolver entitlement/admin, linhas 200-208). **Correto e importante**: um kill-switch operacional não pode ser furado por bypass de admin.
- `whatsapp-beta.server.ts` (`canUseWhatsApp`/`getWhatsAppBetaStatus`) parece ser um gate **legado** — o comentário em `whatsapp-authz.server.ts:95-104` diz que pós-liberação geral o `canaryOnly` não bloqueia mais pagantes, e `whatsapp-entitlement.server.ts:206-210` comenta `void hasBetaAccess` — a função `hasBetaAccess` é importada mas **nunca efetivamente usada para bloquear** (chamada e descartada com `void`). **W1-P2**: código morto/vestigial (`hasBetaAccess`) mantido no módulo de entitlement sem uso funcional — não é uma falha de segurança (não abre bypass), mas é uma dívida técnica que pode confundir auditorias futuras achando que beta ainda é obrigatório.
- `whatsapp-rollout.server.ts`: `evaluateRollout`/`evaluateRolloutSync` fail-closed em qualquer etapa (RPC `whatsapp_user_in_rollout` com fail-closed em erro, linha 69 `return false` em catch). Planos gratuitos são hard-blocked (`FREE_PLAN_CODES`) antes mesmo de consultar RPC — eficiente e correto.
- `whatsapp-runtime-config.server.ts`: leitura sempre fail-closed (`FAIL_CLOSED_RUNTIME` em qualquer erro/ausência de linha), sem cache (TTL zero, comentário explícito "Nenhum cache longo"). `updateRuntimeConfig` exige `reason` não vazio (≥3 chars) para campos sensíveis (`REASON_REQUIRED_FIELDS`) — mas a validação de quem pode chamar (**Admin Master**) é delegada ao caller (comentário linha 13: "Alteração exige Admin Master (validado no caller)") — **este módulo não impõe isso sozinho**; se algum caller esquecer de checar admin master antes de chamar `updateRuntimeConfig`, não há defesa em profundidade aqui. **W1-P1 (HIPÓTESE)** — depende de auditoria da rota admin que chama esta função (fora do escopo deste anexo, candidato a um Anexo de administração).

## 13. Gates de saída (outbound) — dupla/quádrupla trava

- `whatsapp-outbound-gates.server.ts: isOutboundHttpAllowed` exige **simultaneamente**: `WHATSAPP_ENABLED`, `WHATSAPP_CANARY_ENABLED`, `WHATSAPP_DISPATCH_ENABLED`, `WHATSAPP_OUTBOUND_HTTP_ENABLED` todos `"true"` (comparação estrita, case-insensitive só para o valor "true"; qualquer outra coisa nega) — fail-closed por padrão (ausência de env = false). Também valida presença/formato de `WHATSAPP_PHONE_NUMBER_ID` (dígitos) e `WHATSAPP_ACCESS_TOKEN`, e a versão da Graph API via `getWhatsAppGraphVersion()`. **Nenhum fetch pode ocorrer sem todas as flags = true.** Confirmado como "SEM call site operacional" neste arquivo — é usado apenas por `whatsapp-dispatcher-outbound.server.ts:runOutboundForNotification` (linha 195-203) antes de montar o transport.
- Nenhum header, token ou URL é logado nesse módulo.

## 14. Dispatcher de saída — `whatsapp-dispatcher-outbound.server.ts`

- `runOutboundForNotification`: gate → `loadRecipient` (lê de `whatsapp_links` com `ativo=true` + `opt_in_em` presente + `revogado_em` nulo, linha 83-100) → `loadTemplate` (lê template ativo) → `transportFactory` → `execute`. **Recipient nunca vem do payload da notificação, apenas de `whatsapp_links`** (comentário linha 18-19 confirmado pelo código). Mitigação correta contra um `payload` malicioso/alterado redirecionar o envio para outro telefone.
- `defaultLoadTemplate` loga erros de query com `code`/`message` crus do PostgREST (linhas 136-146) — **W1-P2**: `error.message` do PostgREST normalmente não contém PII de usuário (é erro de schema/SQL), mas não há sanitização explícita aqui como em outros módulos (`sanitizeErrorText`). Risco baixo mas inconsistente com o padrão do resto do código.
- Pré-condição documentada: "caller já fez claim atômico com `claim_token` válido" — o dispatcher **não valida isso internamente**, confia no caller. **NÃO VERIFICADO** se o caller (rota `public.hooks.whatsapp-dispatcher.ts`, fora do escopo deste anexo) de fato sempre garante claim antes de chamar.

## 15. Texto/Botões/Listas/Flows — envio e fallback

- Ordem de preferência de envio de resposta ao usuário (linhas 1172-1234): `out.interactive` (CTA URL) → `out.graphInteractive` (ex.: Flow) → botões/listas construídos de `out.resposta` via `buildInteractiveFromReply` → fallback para texto puro (`sendWhatsAppReply`) se qualquer envio interativo falhar (`sentOk=false`). **Fallback sempre preserva a entrega da mensagem em texto plano**, mesmo se o interativo falhar — bom design de resiliência.
- Vínculo de botões de confirmação de gasto a uma sessão específica via `signExpenseButton` (assinatura HMAC dos tokens de botão com `userId+telefone+rowId+rev`, visto em `whatsapp-interactive.server.ts:252-266`) — **W1-P1 confirmado como mitigação, não falha**: impede que um botão de uma sessão vaze/seja reaproveitado para outro usuário ou sessão (replay de botão), pois o token é assinado e preso a `rowId`/`rev`. Função de assinatura (`expense-button-token.server.ts`) está **fora do escopo lido neste anexo** — **NÃO VERIFICADO** o algoritmo exato de assinatura/expiração.
- `replyIdToTexto` (linhas 213-233) converte botão/lista para o MESMO texto que o pipeline textual entenderia — reduz superfície de duplicação de lógica de autorização (um único caminho de validação financeira para texto e botão). Tokens com padrão `wa13_`/`wa12_` (assinados) são passados adiante **sem conversão para texto livre**, preservando a referência de segurança — correto.
- Para Flows (`nfm_reply.response_json`), o conteúdo é só repassado como `flowReply.responseJson` ao pipeline (`runMsg.flowReply`) — a validação do JSON do formulário do Flow **não foi localizada neste arquivo** (deve ocorrer dentro de `processarMensagemWhatsApp`, fora do escopo) — **NÃO VERIFICADO**.

## 16. Validação de mídia (magic bytes) — `whatsapp-media-validation.server.ts` e `whatsapp-media-sanitize.server.ts`

- `validateDownloadedImage`: detecta JPEG/PNG/WEBP por bytes mágicos reais (assinaturas completas, incluindo os 8 bytes do PNG e RIFF+WEBP) — **não confia apenas no mimetype declarado**, cruza declarado×real (jpeg/jpg tratados como equivalentes) — mitigação robusta contra spoofing de mimetype.
- Limite `MAX_IMAGE_BYTES = 15MB` aplicado tanto na validação quanto no `downloadWhatsappMedia` (linha 878 da rota, como `maxBytes`) — consistente.
- `whatsapp-media-sanitize.server.ts: stripMediaFields` é uma blindagem defensiva (deny-list de chaves: `base64`, `media_id`, `document`, `image`, etc. + detecção heurística de data URLs >80 chars) aplicada **antes de persistir sessões** — **boa prática de defesa em profundidade**, mas é uma deny-list (não allow-list): um campo novo com nome não listado contendo dados binários/base64 longos só seria pego pela heurística de prefixo `data:` — **W1-P2**: não cobre, por exemplo, uma string base64 pura sem prefixo `data:` armazenada sob uma chave não listada (ex.: `foto_base64_v2`). Recomenda-se migrar para allow-list de campos permitidos em sessões, se praticável.

## 17. Graph API version — `whatsapp-graph-version.server.ts`

- Fail-closed total: variável ausente/vazia → `missing`; formato inválido → `invalid`; formato válido mas não autorizado (hardcoded só `v20.0`) → `unsupported`. `buildWhatsAppGraphUrl` constrói URLs fechadas por `kind` (messages/register/subscribed_apps/media_lookup/admin_path), todas com validação de formato do parâmetro variável (dígitos-apenas para phone/waba IDs, regex restrito para media_id e admin_path, bloqueio explícito de `..`, `://`, `/` inicial). **Nenhuma URL arbitrária pode ser montada por este builder.** Muito bem implementado.

## 18. Sanitização de erro de transporte — `whatsapp-transport-error-sanitizer.server.ts`

- Allowlist estrita de `error_name` (10 valores conhecidos, resto vira "Other"); `cause_code` restrito a regex `[A-Z0-9_-]{1,32}`; `cause_errno` só número finito |<1e9|; nunca usa `.message` do erro nem `JSON.stringify` do erro bruto; duration truncada a 24h. **Muito bem implementado, zero superfície de vazamento por este caminho.**

## 19. api-auth.ts — autenticação Bearer/Cookie

- `getUserFromRequest`: extrai Bearer header ou cookie (`sb-access-token` ou `*-auth-token`), tenta parsear como array `[token, refresh]` ou objeto `{access_token}`; fallback para valor cru se começar com `eyJ` (JWT). Usa `sb.auth.getUser(token)` contra Supabase com chave `anon` (não `service_role`) e `Authorization` header do próprio token — **correto**, não eleva privilégio.
- **Não é usado pela rota do webhook WhatsApp** (o webhook não autentica usuário via Bearer — autentica via HMAC do corpo). `api-auth.ts` é usado por outras rotas administrativas (`isAdminMasterUser`, `ensurePremiumFeatureAccess`) que **delegam para `hasAdminMasterRole`** (fonte única, não lido neste anexo — **NÃO VERIFICADO** em profundidade, mas referenciado consistentemente em todos os módulos de authz/entitlement como a fonte única).
- `ensurePremiumFeatureAccess` usa `getSubscriptionForUserIdentity` (fora do escopo) e bypassa para Admin Master — consistente com o padrão do restante do sistema.

## 20. Uso de `service_role` (supabaseAdmin)

- **Confirmado em todos os módulos lidos**: `whatsapp-authz`, `whatsapp-entitlement`, `whatsapp-beta`, `whatsapp-rollout`, `whatsapp-runtime-config`, `whatsapp-optout`, `whatsapp-link-verification`, `whatsapp-outbound-log`, `whatsapp-dispatcher-outbound`, `whatsapp-meta-status-callbacks`, e a rota principal usam `supabaseAdmin` (`client.server.ts`, import dinâmico ou estático) — ou seja, **toda a lógica de autorização roda com `service_role`, contornando RLS por design** (webhook não tem sessão de usuário; é a única forma de operar). Isso é esperado para um endpoint de servidor-para-servidor, mas **centraliza toda a responsabilidade de controle de acesso no código da aplicação** (zero rede de segurança de RLS). Qualquer bug lógico nesses módulos (authz/entitlement/rollout) é a ÚNICA barreira contra acesso indevido — reforça a importância crítica dos itens P0/P1 acima. **W1-P1 (estrutural, não um bug específico)**: concentração de confiança total no código aplicativo sem defesa em profundidade de RLS para estas tabelas (`whatsapp_links`, `whatsapp_messages`, `whatsapp_notifications`, etc.) — **NÃO VERIFICADO** se RLS existe mas é irrelevante (service_role bypassa sempre), portanto esse ponto é mais uma observação arquitetural do que uma falha pontual.
- Nenhum uso de `service_role` client foi encontrado fora de `src/server/*.server.ts` / rota de API (nenhuma exposição ao bundle client) — os arquivos lidos são todos `.server.ts` (bloqueados do bundle client, conforme comentário em `whatsapp-graph-version.server.ts:3-4`, e assumindo que o guard de build do projeto aplica essa regra; **NÃO VERIFICADO** a configuração do bundler em si, fora do escopo).

## 21. Testes que cobrem os componentes auditados

| Componente | Teste(s) encontrados |
|---|---|
| HMAC/assinatura/webhook HTTP | `tests/whatsapp-webhook-http.test.ts` (577 linhas) |
| Replay/dedupe WAMID | `tests/whatsapp-webhook-replay-3-27.test.ts` (68 linhas) |
| Authz (`canUseWhatsAppForSender`) | `tests/whatsapp-authz.test.ts` (288 linhas) |
| Entitlement | NÃO foi encontrado teste dedicado `whatsapp-entitlement*.test.ts` — **cobertura NÃO VERIFICADA diretamente**; pode ser exercitado indiretamente por `whatsapp-c11-f3b2b-inbound-gate.test.ts` |
| Gate C11 inbound | `tests/whatsapp-c11-f3b2b-inbound-gate.test.ts` |
| Gate C11 notification creation | `tests/whatsapp-c11-f3b2b-notification-gate.test.ts` |
| Opt-out | `tests/whatsapp-c11-f3b2e-optout.test.ts` (197 linhas), `tests/whatsapp-c11-f3b2e1-optout-precedencia.test.ts` |
| Link verification (token) | `tests/whatsapp-link-token.test.ts` (22 linhas — bastante curto, cobertura superficial aparente) |
| Mídia (magic bytes) | `tests/whatsapp-media-blindagem.test.ts` (106 linhas) |
| Graph version | `tests/whatsapp-graph-version-unification.test.ts` (214 linhas) |
| Outbound gates/wiring | `tests/whatsapp-c11-f3b2d-outbound-wire.test.ts`, `tests/whatsapp-foundation-access-outbound.test.ts` |
| Dispatcher (concorrência, hardening, wiring, rotas) | `tests/whatsapp-c92-dispatcher-concurrency-d2b2.test.ts`, `-hardening-d2b2`, `-routes-d2b2`, `-wiring-d2b2` |
| Status callbacks Meta | `tests/whatsapp-c92-meta-status-callbacks.test.ts`, `tests/whatsapp-c11-f3b2e1-status-callback-wire.test.ts` |
| Sanitização de erro de transporte | `tests/whatsapp-c92-transport-error-sanitizer-e4c.test.ts` (181 linhas) |
| Template loader | `tests/whatsapp-c92-template-loader-e3a.test.ts` |
| Rate limit atômico | `tests/rate-limit-atomic-c82.test.ts` (254 linhas) |
| Interactive (botões/listas) | `tests/whatsapp-botoes-contexto-2026-10-12.test.ts`, `tests/whatsapp-ux-menu-botoes-2026-10-01.test.ts`, `tests/whatsapp-confirmar-ajustar-cancelar.test.ts` |
| Flows | `tests/whatsapp-flow.test.ts` |
| Áudio (duração, transcrição) | `tests/whatsapp-audio.test.ts`, `tests/whatsapp-audio-duration.test.ts` |
| Boleto/PDF (OCR) | `tests/whatsapp-boleto-c10b-hardening.test.ts`, `tests/whatsapp-boleto-c10b2.test.ts`, `tests/whatsapp-boleto-rate-limit-3-36.test.ts` |
| api-auth.ts | Nenhum teste dedicado `api-auth*.test.ts` encontrado — **NÃO VERIFICADO cobertura direta**; usado indiretamente por outras rotas |

Não foi possível, dentro do escopo deste anexo, confirmar se os testes realmente exercitam os caminhos de código específicos apontados como P0/P1 (ex.: dupla camada de dedupe do item 6, `hasBetaAccess` morto). Isso exigiria leitura integral dos arquivos de teste, não realizada aqui.

---

## Resumo de achados por severidade

### P0 (crítico) — nenhum confirmado
Não foi encontrado nenhum bypass direto de autenticação/autorização, vazamento de PII em log persistido, ou injeção de URL/comando neste conjunto de arquivos.

### P1 (alto)
- **W1-P1-01**: Dupla camada de dedupe não sincronizada entre quota WA-C11 (`duplicate` por `external_id`, atômica via RPC) e `externalIdAlreadyConfirmed` (por `status="salva"`); reentregas da Meta para mensagens que falharam antes de salvar podem reprocessar o pipeline inteiro sem lock explícito visível nesta camada (seção 6).
- **W1-P1-02**: `completeWhatsAppLinkVerification` não possui rate limit de tentativas visível na camada de aplicação contra força bruta do token de 12 caracteres; depende de garantias não verificadas na RPC SQL (seção 11).
- **W1-P1-03**: `updateRuntimeConfig` não impõe Admin Master internamente — depende 100% do caller; não auditado neste anexo (seção 12).
- **W1-P1-04**: Centralização total da autorização em `service_role` sem rede de segurança de RLS comprovada para as tabelas WhatsApp (observação estrutural, seção 20).

### P2 (médio/baixo/observação)
- **W1-P2-01**: `verifyMetaSignature` depende do comportamento de catch do Node para truncamento de hex malformado em vez de validar o formato explicitamente (seção 1).
- **W1-P2-02**: Tipos de mensagem Meta não suportados (sticker/location/etc.) são descartados silenciosamente sem métrica (seção 3).
- **W1-P2-03**: Comentário de `downloadWhatsappMedia` ("paramos de ler antes de 100MB") não corresponde ao comportamento real (buffer completo antes do corte) (seção 5).
- **W1-P2-04**: Inconsistência entre sanitizadores de erro — `whatsapp-outbound-log.server.ts` redige sequências de dígitos longos, `whatsapp-meta-status-callbacks.server.ts` não (seção 7).
- **W1-P2-05**: Rate limit é a única camada fail-open do pipeline WhatsApp (todas as outras são fail-closed) (seção 8).
- **W1-P2-06**: `hashUserId`/`hashId` (`.slice(0,8)`) são truncamentos, não hashes criptográficos — nomenclatura enganosa (seção 9).
- **W1-P2-07**: `hasBetaAccess` é código morto/vestigial em `whatsapp-entitlement.server.ts`, importado e descartado com `void` (seção 12).
- **W1-P2-08**: `defaultLoadTemplate` loga `error.message`/`code` do PostgREST sem sanitização padronizada (seção 14).
- **W1-P2-09**: `stripMediaFields` é deny-list, não allow-list; campos novos de mídia sem nome reconhecido ou sem prefixo `data:` podem escapar (seção 16).

---

## Tabela de cobertura de leitura

| Arquivo | Total de linhas | Linhas lidas | Status |
|---|---:|---|---|
| src/routes/api/public.whatsapp.expense.ts | 1271 | 1-1271 | Integral |
| src/server/whatsapp-authz.server.ts | 151 | 1-151 | Integral |
| src/server/whatsapp-entitlement.server.ts | 262 | 1-262 | Integral |
| src/server/whatsapp-beta.server.ts | 67 | 1-67 | Integral |
| src/server/whatsapp-rollout.server.ts | 101 | 1-101 | Integral |
| src/server/whatsapp-runtime-config.server.ts | 174 | 1-174 | Integral |
| src/server/whatsapp-link-verification.server.ts | 94 | 1-94 | Integral |
| src/server/whatsapp-optout.server.ts | 272 | 1-272 | Integral |
| src/server/whatsapp-outbound-gates.server.ts | 114 | 1-114 | Integral |
| src/server/whatsapp-outbound-log.server.ts | 241 | 1-241 | Integral |
| src/server/whatsapp-dispatcher-outbound.server.ts | 262 | 1-262 | Integral |
| src/server/whatsapp-interactive.server.ts | 538 | 1-510 (trecho final de helpers de extração de opções numeradas ~505-538 não exibido na íntegra) | Parcial |
| src/server/whatsapp-transport-error-sanitizer.server.ts | 115 | 1-115 | Integral |
| src/server/whatsapp-graph-version.server.ts | 156 | 1-156 | Integral |
| src/server/whatsapp-media-validation.server.ts | 80 | 1-80 | Integral |
| src/server/whatsapp-media-sanitize.server.ts | 57 | 1-57 | Integral |
| src/server/rate-limit.server.ts | 146 | 1-146 | Integral |
| src/server/api-auth.ts | 149 | 1-149 | Integral |
| src/server/whatsapp-c11-gates.server.ts | 478 | 1-478 | Integral |
| src/server/whatsapp-meta-status-callbacks.server.ts (referenciado via import na rota, fora da lista original mas essencial para status callbacks) | 1179 | 1-700 | Parcial (trechos 701-1179 não lidos; cobre reconciliação adicional de eventos "unmatched" e possivelmente helpers de teste/export não revisados) |

**Observação de cobertura**: todos os 18 arquivos explicitamente listados pelo usuário foram lidos integralmente. Dois arquivos adicionais foram lidos por serem importados diretamente pela rota principal e necessários para avaliar status callbacks e botões/listas (`whatsapp-interactive.server.ts` e `whatsapp-meta-status-callbacks.server.ts`); ambos tiveam leitura parcial (identificada acima) e qualquer achado baseado nas partes não lidas foi marcado como NÃO VERIFICADO no corpo do anexo.
