# Anexo 5 — Assistente de Compras (SerpApi) e pesquisa legada (Wikimedia)

Auditoria de código, somente leitura. Nenhum arquivo de produção foi alterado. Banco de dados real **não foi consultado** (regra do ambiente de auditoria); qualquer afirmação sobre o estado do banco de produção está marcada como NÃO VERIFICADO.

## 0. Metodologia e escopo lido

Foram lidos integralmente:
- `src/server/shopping/*.ts` (12 arquivos, 1080 linhas)
- `src/server/whatsapp-research-core.ts`, `whatsapp-research-mvp.ts`, `whatsapp-research-provider.server.ts`, `whatsapp-research.server.ts` (554 linhas)
- `docs/SHOPPING_PILOTO.md` e `docs/migrations-candidate/whatsapp-shopping-quota.sql`
- `tests/whatsapp-shopping-*.test.ts` (9 arquivos) e `tests/sql/whatsapp-shopping-quota/*.sql`
- Trechos relevantes de `src/server/whatsapp.server.ts` (dedupe em `processarMensagemWhatsApp`, chamada a `handleWhatsAppShopping`/`handleWhatsAppResearch`) e `src/server/whatsapp-interactive.server.ts` (`shopping_link_N`)
- Trecho do envio de resposta em `src/routes/api/public.whatsapp.expense.ts` (necessário para responder ao item "reply perdida", não estava na lista original mas é o único ponto que envia a resposta ao WhatsApp)

Não foi lido: `scripts/serpapi-shopping-smoke.mjs` (citado nos testes como script standalone espelhado, mas fora do escopo pedido) — NÃO VERIFICADO quanto a eventuais divergências com `offer-specs.ts`.

Confirmação de que **não existe** migration aplicada ao repo para as tabelas/RPCs `whatsapp_shopping_*`:
```
find supabase/migrations -iname "*shopping*"   → nenhum resultado
```
O único artefato SQL é `docs/migrations-candidate/whatsapp-shopping-quota.sql`, com cabeçalho explícito "CANDIDATO — NÃO APLICADO EM NENHUM BANCO REAL" (`docs/migrations-candidate/whatsapp-shopping-quota.sql:1`). O dono do produto informou que a aplicação já foi feita em produção; **isso não pôde ser verificado nesta auditoria** (NÃO VERIFICADO — sem acesso a banco real, e sem migration correspondente versionada em `supabase/migrations`).

---

## 1. Flags, elegibilidade e piloto

`src/server/shopping/whatsapp-shopping.server.ts:88-98`:
```
if (env.WHATSAPP_SHOPPING_ENABLED !== "true") return null;
if (!isShoppingPilotUser(env.WHATSAPP_SHOPPING_PILOT_USER_IDS, msg.userId)) return null;
```
`isShoppingPilotUser` (`whatsapp-shopping.server.ts:67-77`) exige CSV de UUIDs válidos; qualquer item malformado invalida a lista inteira (sem fallback permissivo) — confirmado por `tests/whatsapp-shopping-pilot.test.ts:27-33`. A flag errada (`WHATSAPP_RESEARCH_ENABLED`) não ativa compras, testado em `whatsapp-shopping-mvp... ` — na verdade em `tests/whatsapp-shopping-finance-safety.test.ts` não, está em `tests/whatsapp-shopping-mvp.test.ts` via módulo próprio; a verificação literal "WHATSAPP_RESEARCH_ENABLED não liga compras" está em `tests/whatsapp-shopping-mvp.test.ts:32-35`. Entitlement (plano pago) é checado depois do flag/piloto (`whatsapp-shopping.server.ts:114-120`), e nega **sem nenhuma leitura de contexto/cota/SerpApi** quando flag ou piloto falham — confirmado (early `return null`, teste "flag OFF... nada lido" `tests/whatsapp-shopping-pilot.test.ts:36-40` e `...44-47`).

Ordem real do pipeline (`whatsapp-shopping.server.ts:84-149`): intenção/follow-up → flag → piloto → contexto (só se follow-up) → entitlement → cota persistente (RPC) → SerpApi. Isso bate com o comentário em `shopping-assistant.ts:3`.

**Achado S-P2** (informativo): a documentação de piloto (`docs/SHOPPING_PILOTO.md:5`) e o comentário do orquestrador (`whatsapp-shopping.server.ts:5`) dizem que, sem o SQL aplicado, a função falha fechada "sem SerpApi" — isso é verdade para a RESERVA de cota (`createDbQuotaStore.reserve`, `shopping-quota-db.ts:17-28`, lança exceção se a RPC não existir, e `shopping-assistant.ts:69-71` captura e devolve `MSG_FALHA` sem chamar `searchShopping`). Mas o **contexto** (`shopping-context.ts`, RPCs `whatsapp_shopping_context_*`) também depende do SQL candidato. Se a RPC de contexto não existir, `contexts.get` lança (`shopping-context.ts:35`) e é capturado em `whatsapp-shopping.server.ts:111` retornando `null` (silenciosamente trata como "sem contexto": a mensagem segue para o roteador normal). Isso é seguro (fail-closed, sem vazar dado), mas **não gera nenhum log ou alerta** de que o recurso de continuações está quebrado por falta de schema — ponto de observabilidade a melhorar, não é falha de segurança.

---

## 2. Separação Compras vs. Gastos (intenção)

`shopping-intent.ts:11-14` define regex de bloqueio: `PAST_PURCHASE` (comprei/paguei/gastei/parcelei/...) e `OTHER_FLOWS` (lembrete/agendar/comprovante/boleto/fatura/pix) são checados **antes** do gatilho de compra (`shopping-intent.ts:33`), e supermercado/mercearia (`GROCERY`, linha 13) é excluído mesmo que o gatilho bata (linha 35). Testes que confirmam: `tests/whatsapp-shopping-mvp.test.ts:49-57`, `tests/whatsapp-shopping-pilot.test.ts:67-72` (áudio transcrito "comprei... ontem por 8 mil" não intercepta), `tests/whatsapp-shopping-finance-safety.test.ts` indiretamente via snapshot.

No roteador principal, `handleWhatsAppShopping` só é chamado quando `!sessao && decisao === "outro" && !msg.image && !msg.document && !financialInstallment` (`whatsapp.server.ts:4480-4482`), ou seja, depois que o pipeline financeiro já teve chance de classificar a mensagem como sessão ativa ou parcelamento financeiro explícito (comentário em `whatsapp.server.ts:4475-4479` documenta essa decisão: "uma compra com valor e parcelamento explícitos pertence ao fluxo financeiro"). Teste de posição no arquivo-fonte: `tests/whatsapp-shopping-mvp.test.ts:189-194`.

**Confirmado, sem defeito**: separação de intenção e de ordem no roteador é consistente entre código e testes.

---

## 3. Chave de API (SerpApi)

`serpapi-shopping.ts:12-22` monta URL fixa (`engine=google_shopping`, `gl=br`, `hl=pt-br`, `google_domain=google.com.br`) com apenas `q` (a busca normalizada) e `api_key`; nenhum dado financeiro ou identificador de usuário é enviado — confirmado por teste explícito `tests/whatsapp-shopping-mvp.test.ts:62-69` (privacidade na URL) e `tests/whatsapp-shopping-pilot... ` não, está em `tests/whatsapp-shopping-finance-safety... ` não — o teste correto é `tests/whatsapp-shopping-mvp.test.ts:166` (`expect(calls[0]).not.toMatch(/1000000|renda|guardado|u1/)`).

Sem chave (`deps.apiKey?.trim()` vazio) → retorna `MSG_SEM_CHAVE` **antes** de reservar cota e sem chamar `searchShopping` (`shopping-assistant.ts:63`, ordem anterior à reserva na linha 70) — confirmado, nenhuma cota é descontada (`tests/whatsapp-shopping-mvp.test.ts:146-151`).

---

## 4. Filtros de variante (chip/SSD/tela/usado/open box)

`offer-specs.ts:9` define `NAO_NOVO` cobrindo usado/seminovo/recondicionado/refurbished/renewed/reembalado/mostruário/vitrine/open-box/unsealed/desembalado/caixa aberta/embalagem aberta/lacre rompido/segunda mão/pré-owned. `compativel()` (linhas 27-38) recusa por padrão quando há ambiguidade: título com múltiplas telas/SSD/RAM nunca é aceito (linha 31, comentário "nunca adivinhar"); falta de evidência no título recusa quando a busca pede o atributo (linhas 33-37, "RAM/SSD/Tela: sem evidência → recusa", conforme comentário de `compativel`, linha 27). Em `serpapi-shopping.ts:72-95`, `parseOffers` aplica, nesta ordem: validações básicas → filtro de usado via `NAO_NOVO`/`second_hand_condition` (ignorado quando `wantsUsed=true`) → `matchesVariant` (que chama `compativel`) → deduplicação por `loja|preço` → ordenação por preço → `slice(0,3)`. Confirmado por `tests/whatsapp-shopping-real-fixes.test.ts:23-27` (recusa "Shopee 13 e 15", recusa "caixa aberta", mantém variante 13"/512GB) e `tests/whatsapp-shopping-mvp.test.ts:90-94` (até 3 ofertas, descarta usado/link suspeito/variante errada).

Quando as ofertas mostradas têm tela/SSD divergentes ou não informados, `variantesMisturadas()` (`offer-specs.ts:50-54`) é usado tanto em `formatOffers` (`shopping-assistant.ts:40`) quanto no cálculo de orçamento (`shopping-assistant.ts:82-84`, que some os cenários de parcelamento e pede para o usuário especificar tela/SSD antes de simular) — confirmado por `tests/whatsapp-shopping-real-fixes.test.ts:56-65`.

---

## 5. Google vs. link direto da loja; até 3 ofertas

`serpapi-shopping.ts:81-83`: a URL preferida é a do lojista (`safeUrl(r.link)`/`safeUrl(r.product_link)`, filtrando `isGoogleHost`), caindo para o link do Google só se não houver alternativa segura. `rotuloLink()` (`offer-specs.ts:58`) rotula "Ver no Google Shopping" vs. "Link direto da loja" conforme o host. `safeUrl()` (`serpapi-shopping.ts:36-44`) recusa URLs não-HTTPS, com credenciais embutidas, host IP/localhost, porta explícita, ou encurtadores conhecidos (bit.ly/tinyurl/t.co/goo.gl/cutt.ly/encurtador). `formatOffers()` (`shopping-assistant.ts:35-43`) sempre corta para `offers.slice(0,3)` e nunca inclui a URL no corpo principal (só textoCurto, que remove `https?://` e `www.`) — URL só aparece quando o usuário pede um link específico (`responderFollowupLocal`, `shopping-followup.ts:95-98`). Confirmado por `tests/whatsapp-shopping-real-fixes.test.ts:29-40` e `tests/whatsapp-shopping-mvp.test.ts:92-96` (safeUrl rejeita IP/porta/credenciais/encurtador).

---

## 6. `shopping_link_1..3` nunca cai no menu de Gastos

`whatsapp-interactive.server.ts:228-229`: `shopping_link_N` é convertido para o texto `link N` em `replyIdToTexto`, **antes** do padrão genérico `opt_(\d{1,2})` (linha 230) ser avaliado — o comentário na linha 227 é explícito: "IDs dedicados (nunca opt_N, que cairia no menu principal)". O botão correspondente é criado em `whatsapp-interactive.server.ts:453-459`, só quando o corpo contém o emoji `🛍️` e o padrão exato de 1 a 3 ofertas numeradas com "Para abrir, responda" — se o formato não bater (`ok` falso, linha 456), retorna `null` (cai para texto puro, sem botões). Confirmado por `tests/whatsapp-shopping-botoes.test.ts:15-28` (IDs `shopping_link_1..3`, nunca contém `opt_`) e `:35-41` (`replyIdToTexto("shopping_link_4", "x")` cai no fallback do título, não interpreta como compras; `opt_1` continua mapeando para `"1"` do menu normal, preservando o fluxo de Gastos).

**Confirmado, sem defeito**: a separação de namespace de IDs é sólida — não há colisão entre `shopping_link_N` e `opt_N` do menu principal.

---

## 7. Contexto 20 min, isolado por usuário+telefone

`shopping-context.ts:10` define `CONTEXT_TTL_MS = 20 * 60 * 1000`. A chave de persistência é sempre `(user_id, phone_hash)` — tanto na implementação em memória (`shopping-context.ts:55-67`, chave `` `${u}|${p}` ``) quanto na baseada em RPC (`createDbContextStore`, chamando `whatsapp_shopping_context_get/save` com `p_user_id`/`p_phone_hash`). O hash do telefone é SHA-256 dos dígitos (`whatsapp-shopping.server.ts:80-82`). No candidato SQL, a tabela `whatsapp_shopping_contexts` tem `PRIMARY KEY (user_id, phone_hash)` e a RPC de leitura filtra por ambos (`whatsapp-shopping-quota.sql:131-138, 162-168`), e a RPC de escrita grava `expires_at = now() + interval '20 minutes'` (linha 153) — TTL consistente entre app e SQL candidato. Confirmado por `tests/whatsapp-shopping-mvp.test.ts:146-151` (outro telefone/usuário não reaproveita), `tests/whatsapp-shopping-followup-dedupe.test.ts:45-50` (isolamento + TTL) e teste SQL `Q17`/`Q18`/`Q19` em `tests/sql/whatsapp-shopping-quota/10-tests.sql`.

Expirado (mas ainda dentro de 1 dia no SQL) volta como marcador sem ofertas (`whatsapp-shopping-quota.sql:165`, comentário "Expirado (até 1 dia) volta só como marcador, SEM ofertas"), o que o app trata pedindo nova pesquisa (`MSG_CONTEXTO_EXPIRADO`, `shopping-followup.ts:115-116`). Isso é consistente com `parseOffersJson` em `shopping-context.ts:18-28`, que revalida o JSON vindo do banco e descarta silenciosamente qualquer formato inesperado.

---

## 8. Cota: 10/usuário/mês, 200 global/mês

Limites definidos em `shopping-quota.ts:11-12` (`USER_MONTHLY_LIMIT=10`, `GLOBAL_MONTHLY_LIMIT=200`) e replicados como constantes fixas **dentro da função SQL** (`whatsapp-shopping-quota.sql:45-47, 91-92` — `c_user_limit`/`c_global_limit`), não recebidos como parâmetro do chamador (`shopping-quota-db.ts:18-19`: `rpc("whatsapp_shopping_reserve", { p_user_id, p_external_id })`, sem limites). Isso impede que um bug no app altere os limites remotamente — ponto positivo de defesa em profundidade.

Reserva/finish/retry/expiry:
- **Reserva**: bloqueio `pg_advisory_xact_lock` (linha 55) serializa concorrência; expira reservas `pending` com mais de 15 min **contando as 2 chamadas reservadas** (linhas 56-58, comentário explícito "conservador: nunca subconta, pode sobrecontar" na linha 8-9 do arquivo); idempotência por `(user_id, external_id)` com `UNIQUE` (linha 22) e checagem explícita de duplicata (linhas 66-70).
- **Finish**: aceita `0..2` chamadas (`CHECK` na tabela, linha 17, e validação na função, linha 97); 0 chamadas libera (`state='released'`, linha 102) e não é contado como busca consumida — confirmado em `shopping-quota.ts:38-39` (mesma regra na store em memória) e teste `Q3` (SQL) e `tests/whatsapp-shopping-mvp.test.ts:180-187` ("falha que não chamou a API não desconta; falha que chamou desconta").
- **Idempotência do finish**: um segundo `finish` para o mesmo `(user_id, external_id)` não altera o estado já fechado (`whatsapp-shopping-quota.sql:101-111`, `WHERE ... state='pending'` não casa mais; retorna `finished=false` preservando os valores gravados) — teste `Q4`/`Q4b`.
- **Retry de rede**: `searchShopping` tenta no máximo 2 vezes só em 5xx/429 (`serpapi-shopping.ts:104,114`), e `MAX_CALLS_PER_SEARCH=2` casa exatamente com `reserved_calls` no SQL.
- **Limite por usuário**: conta linhas com `state='pending' OR api_calls>0` no mês corrente (`whatsapp-shopping-quota.sql:64-65`); bloqueia em `>=10` (linha 75). Teste `Q6` cobre 1..10 e a 11ª recusada.
- **Limite global**: soma `reserved_calls` (pendentes) + `api_calls` (concluídas) do mês, bloqueia se a próxima reserva (2 chamadas) ultrapassar 200 (linha 71) — nunca permite que o total realmente gasto exceda 200 (teste `Q10`, que insere 150 reservas concorrentes de usuários distintos e confere `tot <= 200`).
- **Nova variante consome cota**: `resolverVariante` gera uma nova busca (`shopping-followup.ts:44-55`) que entra em `handleShoppingMessage` como `searchIntent` (`whatsapp-shopping.server.ts:136-138`), passando de novo por `deps.quota.reserve` — confirmado por `tests/whatsapp-shopping-followup.test.ts:125-133` ("'e o Pro' é nova busca com nova cota, sem preço do Air", `9/10`→`8/10`) e pelo teste de limite acumulado em variantes (`tests/whatsapp-shopping-followup.test.ts:166-172`, "limite de 10 vale para variantes").

**Confirmado, sem defeito**: a aritmética de cota é coberta por 21 asserções SQL dedicadas (`tests/sql/whatsapp-shopping-quota/10-tests.sql`) e espelhada fielmente na store em memória usada em testes de unidade do app.

---

## 9. Dedupe "mesma mensagem" (sem claim específico)

Compras **não fazem parte do webhook-level dedupe por conteúdo**: a reserva usa diretamente `external_id` (wamid) — se o mesmo wamid chega duas vezes, `reserve` retorna `duplicate` com a resposta anterior gravada (`previous_reply`, `shopping-quota-db.ts:23`, coluna `reply` em `whatsapp_shopping_searches`). Confirmado:
- `tests/whatsapp-shopping-mvp.test.ts:155-163` — webhook duplicado não chama a API de novo e devolve a resposta anterior.
- `tests/whatsapp-shopping-followup.test.ts:157-165` — "webhook repetido da busca não chama de novo; continuação repetida não desconta".

---

## 10. O fix do "qual loja?" duplicado — `shopping-followup-claim.server.ts` — e a pergunta sobre reply perdida

### 10.1 O que o fix faz

Antes deste módulo, uma continuação (`loja`/`link`/`parcelas`/`guardar`) recalculada **a partir do contexto salvo** não tinha nenhum registro de dedupe próprio (compras não gravam `gastos`, então o dedupe por `gasto_id`/`status=salva` do pipeline financeiro não se aplica). `dbClaimFollowup` (`shopping-followup-claim.server.ts:6-16`) resolve isso inserindo uma linha em `whatsapp_messages` com `external_id = wamid`, aproveitando o índice único já existente nessa tabela; `error.code === "23505"` (violação de unicidade) é tratado como `"dup"` (linha 13).

Esse claim é inserido **antes** de montar a resposta: `whatsapp-shopping.server.ts:124-134` — a ordem é `claim()` → se `"dup"` retorna resposta vazia com `duplicate:true` → se `"error"` retorna `MSG_FOLLOWUP_FALHA` → só então chama `loadFinance` e `responderFollowupLocal` para montar o texto final. **A linha gravada no claim não contém a resposta** (`resposta_sugerida: null`, `shopping-followup-claim.server.ts:11`) — ao contrário da cota de busca nova (`whatsapp_shopping_searches.reply`), que grava o texto final para reentregas.

### 10.2 O que acontece se o claim tiver sucesso mas o envio da resposta falhar — **Achado S-P1 (confirmado)**

Fluxo reconstituído lendo os três arquivos em conjunto:

1. `processarMensagemWhatsApp` (`whatsapp.server.ts:2822-2829`) primeiro consulta `whatsapp_messages` por `external_id`; na **primeira** chegada da mensagem de follow-up esse SELECT não encontra nada (a linha ainda não existe), então o fluxo segue normalmente até `handleWhatsAppShopping` (`whatsapp.server.ts:4482`).
2. Dentro de `handleWhatsAppShopping`, o claim é inserido com sucesso (`"ok"`) e a função retorna `{ resposta: responderFollowupLocal(...) }` — **sem** ainda ter enviado nada ao usuário.
3. De volta em `processarMensagemWhatsApp`, o retorno é `{ status: "consulta", resposta }` (não é `"duplicada"`).
4. O envio real acontece só no chamador HTTP, `src/routes/api/public.whatsapp.expense.ts:1165-1228`: tenta `sendWhatsAppInteractiveCtaUrl`/`sendWhatsAppInteractiveReply`/`buildInteractiveFromReply`, e se tudo isso falhar cai em `sendWhatsAppReply` (linha 1224); **se até essa chamada de fallback falhar** (lançar exceção ou devolver falha sem lançar — fallback cobre só `sentOk=false`, mas `sendWhatsAppReply` propagando erro cai no `catch (replyErr)` da linha 1226-1233, que **apenas loga** `wa_reply_failed` e não re-lança nem agenda retry).
5. Resultado: a linha de claim em `whatsapp_messages` **já existe** (passo 2), com `resposta_sugerida: null`. Se o WhatsApp/Meta reentregar o mesmo `wamid` (comportamento normal de webhook em caso de timeout) ou se o próprio app rodar `processarMensagemWhatsApp` de novo para esse `external_id`, o dedupe de topo (`whatsapp.server.ts:2855-2857`) **intercepta antes de chamar `handleWhatsAppShopping`**, porque `parsed.kind === "shopping_followup"`, retornando imediatamente `{ status: "duplicada", resposta: "Mensagem já processada anteriormente." }`.
6. O chamador HTTP trata `status === "duplicada"` como "não deve gerar resposta visível" (comentário explícito em `public.whatsapp.expense.ts:1166-1174`, "WA-3.27"): `if (out.resposta && msg.telefone && out.status !== "duplicada")` — como o status é `"duplicada"`, **nenhum envio é tentado na reentrega**, nem mesmo o texto genérico "Mensagem já processada anteriormente.".

**Conclusão**: se o claim de follow-up (`shopping_followup`) grava com sucesso mas o envio da resposta falha (rede, erro da Graph API, timeout), **a resposta ao usuário é perdida definitivamente** — nem a resposta original chega, nem uma reentrega subsequente do mesmo wamid produz qualquer saída visível, porque (a) o claim não armazena o texto para reenvio (diferente da cota de busca nova, que grava `reply`), e (b) o dedupe de nível superior suprime deliberadamente qualquer envio para `status="duplicada"`. Esse comportamento é *assimétrico* em relação à pesquisa nova: `whatsapp_shopping_searches.finish` grava o `reply` final (`shopping-quota-db.ts:30-37`) e uma reentrega de busca devolve esse texto salvo (`reserve` retorna `previousReply`, `shopping-assistant.ts:72`), então buscas novas **não têm** esse problema — só as continuações (`loja`/`link`/`parcelas`/`guardar`) via `dbClaimFollowup` é que o têm.

Não há teste no repositório que cubra esse cenário específico (claim ok + falha de envio); `tests/whatsapp-shopping-followup-dedupe.test.ts:58-62` testa apenas falha do **claim em si** (`claimMode:"error"`), que corretamente retorna `MSG_FOLLOWUP_FALHA` sem deixar rastro — cenário diferente do aqui descrito, em que o claim teve sucesso.

**Severidade**: S-P1 — não é perda financeira nem vazamento de dados (compras são read-only e não geram efeitos colaterais em gastos/saldo), mas é uma falha de UX real e reprodutível: o usuário pode ficar sem resposta a um "qual loja?"/"e em 10x?" sem qualquer sinalização, e não há como reenviar manualmente porque o wamid já está "gasto" no dedupe. HIPÓTESE de mitigação (não implementada, não verificada): gravar o texto de resposta junto com o claim (como já é feito na cota de busca) e, no caminho de dedupe por `shopping_followup`, devolver esse texto salvo em vez de uma resposta vazia suprimida.

---

## 11. Orçamento (`capacidade-compra.ts` + `finance-snapshot.ts`)

### 11.1 Renda — 3 meses completos
`ultimosMesesCompletos()` (`capacidade-compra.ts:46-57`) calcula os 3 meses civis anteriores ao mês de `hoje`, nunca incluindo o mês corrente (teste `tests/whatsapp-shopping-finance-safety.test.ts:58-60`: "receita do mês atual ignorada"; `tests/whatsapp-shopping-mvp.test.ts:110`: `ultimosMesesCompletos("2026-01-05")` cruza o ano corretamente). A renda considerada é só receitas operacionais: `NAO_RENDA` (`finance-snapshot.ts:37`) exclui transferência/resgate/estorno/reembolso/devolução "entre contas" por regex no texto da descrição/origem/tipo — mas essas linhas **ainda marcam o mês como ativo** (`finance-snapshot.ts:63`, soma de `ativos` antes do filtro `NAO_RENDA`), evitando que um mês com só transferências pareça "sem histórico" (teste `tests/whatsapp-shopping-finance-safety.test.ts:63-66`).

### 11.2 Mês sem renda vs. mês sem histórico
Quando `mesesAtivos` é explicitamente informado (fluxo real via `buildFinanceSnapshot`), um mês ativo sem receita conta como **zero observado** (não reduz a confiança por si só, mas entra na média); um mês totalmente sem registro é excluído do array `meses` e reduz a confiança (`capacidade-compra.ts:64-68`, comentário "mês ativo sem renda = 0"). Isso é testado em `tests/whatsapp-shopping-finance-safety.test.ts:28-31` (0/0/0 com uso → sem folga, mensagem seguraa) e `:33-36` (só 1 mês com registro → insuficiente, não assume zeros).

### 11.3 Confiança
- 3 meses completos → `"ok"`.
- 2 meses ativos (regime "com histórico") ou 1-2 meses com renda (regime legado) → `"baixa"`, nunca afirma que a compra cabe (`capacidade-compra.ts:111`: `cabeAVista = confianca === "ok" ? ... : null`), mensagem explícita "não afirmo que cabe" (`shopping-followup.ts:83`) e "Histórico parcial (N/3 meses)" (`capacidade-compra.ts:129-131`). Confirmado em `tests/whatsapp-shopping-finance-safety.test.ts:37-44`.
- 0 meses ou soma ≤ 0 ou `inconclusivo=true` → `"insuficiente"`, `folgaCents=null`, nunca expõe número de folga (`capacidade-compra.ts:80-89`). Confirmado em `tests/whatsapp-shopping-finance-safety.test.ts:24-32` e `tests/whatsapp-shopping-pilot... ` — teste correto: `tests/whatsapp-shopping-mvp.test.ts:126-132`.

### 11.4 Fixos/assinaturas/faturas/contas vencidas, sem contagem dupla
- Fixos do mês atual (`fixoAtual`, `finance-snapshot.ts:111-112`) e histórico médio de fixos (`fixoMedio`) nunca se somam diretamente: o código usa `max` implícito via `fixoMedio > fixoAtual ? diferença extra : nada` (`finance-snapshot.ts:141`, comentário na linha 11: "Nunca soma os dois"). Teste `tests/whatsapp-shopping-finance-safety.test.ts:71-86` (aluguel pago no mês atual conta 1x; aluguel pago todos os meses — contas e gastos ligados — não duplica).
- Faturas de cartão: conta com "fatura" no nome é sempre excluída (`finance-snapshot.ts:90`); conta com nome de cartão/banco só é excluída se houver gastos de cartão no período (`finance-snapshot.ts:91-101`), senão é mantida por segurança e gera alerta — testes 20/21 em `tests/whatsapp-shopping-finance-safety.test.ts:115-126`.
- Assinaturas/recorrências ativas convertidas por fração exata (`FREQ`, `finance-snapshot.ts:43-46`); frequência desconhecida tratada como mensal + alerta (`finance-snapshot.ts:80`), testado (`tests/whatsapp-shopping-finance-safety.test.ts:100-111`).
- Contas vencidas e não pagas de meses anteriores entram como `tipo:"divida"` pelo valor cheio, sem diluir (`finance-snapshot.ts:114-116`), e a mensagem final soma uma linha explícita "Contei N conta(s) vencida(s)..." (`capacidade-compra.ts:103`). Testado em `tests/whatsapp-shopping-finance-safety.test.ts:88-96`.
- Parcelas: uma entrada por grupo de parcelamento (`grupo_parcelamento_id ?? id`), usando a parcela mais avançada vista, e só soma se ainda há parcelas restantes (`finance-snapshot.ts:117-126, 143-146`). Teste 22/23, `tests/whatsapp-shopping-finance-safety.test.ts:131-146`.
- Gasto de cartão nunca é somado junto com a fatura (regra documentada no cabeçalho do arquivo, linhas 10-13, e no comportamento de `tipoConta`/`contaConta`).

### 11.5 Dinheiro guardado e limite de cartão excluídos
`CapacidadeInput.guardadoCents`/`limiteCartaoCents` são tipados mas **nunca usados** no cálculo de `folgaCents` (`capacidade-compra.ts:91`: `folgaCents = rendaMediaCents - compromissosCents`, sem referência a guardado/limite). Teste direto: `tests/whatsapp-shopping-finance-safety.test.ts:157-163` ("guardado/limite não alteram folga": folga idêntica com e sem esses campos preenchidos com valores enormes).

### 11.6 Regra dos 30%
`LIMITE_PCT_FOLGA = 30` (`capacidade-compra.ts:10`). Cenários de parcelamento marcam `aperta: true` quando `parcelaCents*100 > 30*folgaCents` (`capacidade-compra.ts:95`), com teste de fronteira exata: 30,0% não alerta, 30,0006% alerta (`tests/whatsapp-shopping-mvp.test.ts:122-126`).

### 11.7 Confiança baixa / sem promessa de parcelamento real
Toda simulação de parcelas usa o rótulo fixo `ROTULO_SIMULACAO_SEM_JUROS`/`ROTULO_SIMULACAO` = "simulação matemática sem juros, não é oferta de parcelamento da loja" (`capacidade-compra.ts:12`, `shopping-followup.ts:58`), presente em toda mensagem de parcelamento (`capacidade-compra.ts:117`, `shopping-followup.ts:66-67`). Nunca afirma "cabe" com confiança baixa/insuficiente (`capacidade-compra.ts:111-113`, e teste de regressão de regex `expect(c.mensagem).not.toMatch(/: cabe na folga/)` em `tests/whatsapp-shopping-finance-safety.test.ts:43`).

### 11.8 Isolamento de usuário e tamanho de leitura
`buildFinanceSnapshot` recusa com `inconclusivo:true` se qualquer linha pertencer a outro `user_id` (`finance-snapshot.ts:55-58`), fail-closed total (nenhuma folga exposta, teste 24). O loader real (`loadFinanceReadOnly`, `whatsapp-shopping.server.ts:43-62`) usa só `SELECT`, filtra `deleted_at`/`user_id`, e lança `finance_too_many_rows` se qualquer tabela atingir o limite de 2000 linhas (`"sem análise parcial"`, linha 61) — nenhuma query de escrita é feita, confirmado por teste de regex negativo em `tests/whatsapp-shopping-finance-safety.test.ts:171-180` (`not.toMatch(/from\("[a-z_]+"\)\s*\.(insert|update|delete|upsert)\(/)`) e repetido em `tests/whatsapp-shopping-mvp.test.ts:75-78` ("módulos de compras não escrevem em tabelas").

**Conclusão da seção 11**: todas as regras de orçamento pedidas no escopo estão implementadas e cobertas por testes unitários específicos; nenhuma divergência entre código e comportamento esperado foi encontrada.

---

## 12. Pesquisa legada (Wikimedia / `whatsapp-research-*`)

- `whatsapp-research-provider.server.ts:1-3` tem comentário explícito: "Historical paid-provider prototype. Not imported by the webhook or free research handler. Do not connect it to production". Busca confirmada: nenhum import desse arquivo em `whatsapp.server.ts` ou `whatsapp-research.server.ts` (os únicos usos são nos próprios testes, não lidos aqui por não constarem no escopo pedido — NÃO VERIFICADO se há testes residuais o importando fora do padrão `whatsapp-shopping-*`). Achado informativo S-P2: esse arquivo usa um `model: "gpt-6-luna"` (`whatsapp-research-provider.server.ts:44`) — nome de modelo não documentado/inexistente publicamente; como o próprio arquivo não é importado em produção, não representa risco operacional atual, mas indica código morto/experimental mantido no repositório sem uso.
- `whatsapp-research.server.ts:16-17` mantém a flag própria `WHATSAPP_RESEARCH_ENABLED`, com cota separada (`whatsapp_claim_research`, contando linhas/mensagens, não chamadas de API) — o comentário em `shopping-quota.ts:5-7` avisa explicitamente que essa RPC "conta LINHAS... e não chamadas — não serve para esta regra" (a de compras). Confirma que as duas features são propositalmente desacopladas e não compartilham cota.
- Separação clara: pesquisa legada não consulta SerpApi nem qualquer provedor pago em produção — só Wikimedia (`wikimediaSource`, `whatsapp-research.server.ts:8`) e preços **informados pelo próprio usuário** (nunca pesquisados) — `NO_PRICE` em `whatsapp-research-mvp.ts:11` é a mensagem padrão quando o usuário pede preço atual.
- No roteador principal, `handleWhatsAppShopping` é chamado **antes** de `handleWhatsAppResearch` (`whatsapp.server.ts:4482-4486`), e o comentário na linha 4481 documenta essa prioridade ("antes da pesquisa antiga"). Isso significa que, para usuários do piloto de compras, uma frase que dispare ambos os detectores de intenção é resolvida pelo Assistente de Compras primeiro — correto e intencional, mas **se o flag de compras estiver ligado para um usuário fora do piloto** (`WHATSAPP_SHOPPING_ENABLED=true` mas `WHATSAPP_SHOPPING_PILOT_USER_IDS` não contém o userId), `handleWhatsAppShopping` retorna `null` rapidamente (linha 91) e o fluxo cai para `handleWhatsAppResearch` normalmente — sem overlap incorreto.

---

## 13. Resumo de achados (IDs)

| ID | Severidade | Resumo | Evidência |
|---|---|---|---|
| S-P1 | Alta (UX, sem impacto financeiro/dados) | Se o claim de dedupe de follow-up (`shopping_followup`) grava com sucesso mas o envio da resposta ao WhatsApp falha, a resposta é perdida: a linha de claim não armazena o texto, e o dedupe de topo suprime qualquer envio para mensagens já marcadas como `shopping_followup`/`"duplicada"`. | `shopping-followup-claim.server.ts:9-11`, `whatsapp-shopping.server.ts:124-134`, `whatsapp.server.ts:2855-2857`, `public.whatsapp.expense.ts:1166-1234` |
| S-P2 | Informativa | Falha da RPC de contexto (`whatsapp_shopping_context_get`) é absorvida silenciosamente como "sem contexto", sem log/alerta de que o recurso está indisponível por schema ausente. | `whatsapp-shopping.server.ts:109-112` |
| S-P2 | Informativa | `whatsapp-research-provider.server.ts` é código morto (não importado em produção) referenciando um modelo (`gpt-6-luna`) não documentado; risco nulo hoje, mas é dívida técnica. | `whatsapp-research-provider.server.ts:1-3,44` |
| NÃO VERIFICADO | — | Aplicação real do `docs/migrations-candidate/whatsapp-shopping-quota.sql` em produção (dono do produto afirma que já ocorreu). O repositório não tem a migration correspondente em `supabase/migrations`, e o próprio arquivo se autodeclara "NÃO APLICADO". Esta auditoria não consultou o banco real. | `docs/migrations-candidate/whatsapp-shopping-quota.sql:1`; busca em `supabase/migrations` sem resultado |

Nenhum outro desvio entre código e comportamento esperado (intenção, cota, filtros de variante, Google vs. loja, até 3 ofertas, roteamento `shopping_link_N`, TTL 20 min, isolamento por usuário+telefone, e todas as regras de orçamento do item 11) foi encontrado — todos os pontos pedidos no escopo têm teste automatizado específico e o código lido bate com o comportamento testado.

---

## 14. Tabela de cobertura

| Arquivo | Linhas totais | Linhas lidas | Status |
|---|---|---|---|
| `src/server/shopping/capacidade-compra.ts` | 141 | 141 | Integral |
| `src/server/shopping/finance-snapshot.ts` | 149 | 149 | Integral |
| `src/server/shopping/offer-specs.ts` | 61 | 61 | Integral |
| `src/server/shopping/serpapi-shopping.ts` | 124 | 124 | Integral |
| `src/server/shopping/shopping-assistant.ts` | 96 | 96 | Integral |
| `src/server/shopping/shopping-context.ts` | 69 | 69 | Integral |
| `src/server/shopping/shopping-followup-claim.server.ts` | 18 | 18 | Integral |
| `src/server/shopping/shopping-followup.ts` | 118 | 118 | Integral |
| `src/server/shopping/shopping-intent.ts` | 50 | 50 | Integral |
| `src/server/shopping/shopping-quota-db.ts` | 43 | 43 | Integral |
| `src/server/shopping/shopping-quota.ts` | 61 | 61 | Integral |
| `src/server/shopping/whatsapp-shopping.server.ts` | 150 | 150 | Integral |
| `src/server/whatsapp-research-core.ts` | 165 | 165 | Integral |
| `src/server/whatsapp-research-mvp.ts` | 149 | 149 | Integral |
| `src/server/whatsapp-research-provider.server.ts` | 109 | 109 | Integral |
| `src/server/whatsapp-research.server.ts` | 131 | 131 | Integral |
| `docs/SHOPPING_PILOTO.md` | 15 | 15 | Integral |
| `docs/migrations-candidate/whatsapp-shopping-quota.sql` | 174 | 174 | Integral |
| `tests/whatsapp-shopping-botoes.test.ts` | 46 | 46 | Integral |
| `tests/whatsapp-shopping-finance-safety.test.ts` | 180 | 180 | Integral |
| `tests/whatsapp-shopping-followup-dedupe.test.ts` | 67 | 67 | Integral |
| `tests/whatsapp-shopping-followup.test.ts` | 201 | 201 | Integral |
| `tests/whatsapp-shopping-integration.test.ts` | 142 | 142 | Integral |
| `tests/whatsapp-shopping-mobile-ux.test.ts` | 96 | 96 | Integral |
| `tests/whatsapp-shopping-mvp.test.ts` | 200 | 200 | Integral |
| `tests/whatsapp-shopping-pilot.test.ts` | 74 | 74 | Integral |
| `tests/whatsapp-shopping-real-fixes.test.ts` | 94 | 94 | Integral |
| `tests/sql/whatsapp-shopping-quota/00-stub.sql` | 7 | 7 | Integral |
| `tests/sql/whatsapp-shopping-quota/10-tests.sql` | ~70 | ~70 | Integral |
| `src/server/whatsapp.server.ts` | 6185 | ~220 (trechos citados: 2822-2870, 4460-4520, grep de `msg.external_id`/`shopping`) | Parcial — arquivo enorme, fora do escopo lê-lo integralmente; lidos todos os trechos relevantes ao escopo de compras (dedupe, chamada ao assistente, posição no pipeline) |
| `src/server/whatsapp-interactive.server.ts` | 538 | ~140 (trechos 190-260, 420-470, mais grep) | Parcial — lidos os trechos de `replyIdToTexto`, construção de botões `shopping_link_N` e confirmação por grep de que não há outras ocorrências de "shopping" no arquivo |
| `src/routes/api/public.whatsapp.expense.ts` | 1271 | ~90 (trechos 1140-1271) | Parcial — lido o trecho de envio de resposta/erro necessário para investigar o achado S-P1; não fazia parte do escopo original mas foi essencial para responder à pergunta sobre reply perdida |
| `scripts/serpapi-shopping-smoke.mjs` | — | 0 | Não lido — fora do escopo solicitado; citado apenas como espelho standalone nos testes (`tests/whatsapp-shopping-real-fixes.test.ts:8,78-89`) |
