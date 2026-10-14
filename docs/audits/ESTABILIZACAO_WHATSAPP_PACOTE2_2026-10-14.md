# Estabilização WhatsApp — Pacote 2 (14/10/2026, NÃO PUBLICADO)

- **Base:** HEAD 8b9a9b44.
- **O que não foi feito:** nada publicado; nenhum SQL executado em banco real; nenhuma consulta a dados reais. Flags, segredos, Meta e cron não foram alterados.
- **Preservado:** P0 1.950, Pix 100×, C1/C2, comunicação do site e falha fechada da reversão de extrato.

## Resumo

| Item | Status |
|---|---|
| A — resposta não entregue após gasto salvo | **PARCIAL**: recuperação imediata segura implementada. Recuperação durável BLOQUEADA (precisa de tabela nova) |
| B — botões antigos após Ajustar | **CONCLUÍDO (já existia; verificado, sem mudança de código)** |
| C — tempos limite e limite de tamanho de mídia | **CONCLUÍDO** |

## A — Entrega da resposta

**Causa encontrada:** em `public.whatsapp.expense.ts`, o resultado do envio final em texto (`sendWhatsAppReply`) era **ignorado**. Uma recusa 5xx/429 da Meta deixava o usuário sem confirmação, e o webhook mesmo assim respondia 200. Além disso:
- o envio à Meta não tinha tempo limite;
- um botão interativo com resultado incerto caía no texto, com risco de mensagem duplicada.

**Feito:**
- `src/server/whatsapp-reply-delivery.server.ts` (novo) classifica o resultado do envio:
  - `accepted`: 2xx;
  - `transient`: 429/5xx com resposta;
  - `permanent`: outros 4xx ou configuração;
  - `ambiguous`: timeout ou erro de rede.
- `deliverReplyWithRetry` reenvia **só a mesma resposta**, no máximo 2 tentativas, e **somente** em `transient`. A mensagem nunca é reprocessada, então não há gasto novo. `ambiguous` nunca é reenviado.
- `src/server/whatsapp.server.ts:6019`: tempo limite de 15 s no envio à Meta (`sendWhatsAppRaw`). `AbortError` passa a ser tratado como `TimeoutError`.
- `src/routes/api/public.whatsapp.expense.ts:1168-1236`:
  - interativo ambíguo → não manda o texto por cima;
  - texto entregue via retry;
  - falha final gera o evento `wa_reply_undelivered` (só classe, tentativas e status; sem PII).
- **Coberto pelo próprio desenho:**
  - Janela de 24h, vínculo e opt-in: a resposta é ao próprio usuário que acabou de escrever, depois dos gates que já existem.
  - Replay do webhook: continua barrado pelo dedupe e pelos ids determinísticos, sem resposta visível (`duplicada`).
  - "Aceito" ≠ "entregue": a entrega real continua vindo dos callbacks de status.

**Bloqueado:** reenviar depois que o webhook termina exige armazenamento durável. Preparei `docs/migrations-candidate/whatsapp-reply-outbox.sql` como **candidato inativo**: nenhum código depende dele e ele não foi aplicado. O worker, o reconciliador de `ambiguous` e o teste em Postgres descartável ficam para depois da autorização.

## B — Botões antigos
Verificado no HEAD; não houve mudança de código:
- `src/server/expense-button-token.server.ts`: o id assinado prende ação + usuário + telefone + linha da sessão + **revisão** (hash do conteúdo da sessão). Qualquer Ajuste muda a revisão.
- `src/server/whatsapp.server.ts:3136-3155`: o botão só vale se a linha for a sessão ativa, de gasto, em `aguardando_confirmacao`, com a mesma revisão. Fora disso, recebe a mensagem amigável `EXPENSE_BUTTON_STALE`.
- Duplo clique ou dois workers: o gasto usa um id determinístico (`financialIdForWhatsAppMessage`, `whatsapp.server.ts:2125`), então a chave primária impede uma segunda linha.

**Testes existentes** (`tests/whatsapp-botoes-contexto-2026-10-12.test.ts`): 14 aprovados, 0 falhas. Cobrem:
- Confirmar→Ajustar→Confirmar;
- Cancelar antigo;
- botão de outra sessão ou de outro telefone;
- botão legado recusado;
- "sim" digitado continua funcionando.

**Não testado separadamente nesta rodada:** os botões de cartão, boleto, compras e Agenda. Esse código não foi alterado e passa na suíte oficial.

## C — Tempos limite e limites de tamanho
- `src/server/whatsapp-bounded-fetch.server.ts` (novo):
  - `fetchWithTimeout`;
  - `readBodyLimited`: corta durante o streaming, recusa Content-Length acima do limite, ignora Content-Length falso e limita o tempo total da leitura;
  - `downloadWhatsappMediaBounded`: lookup em 8 s e no máximo 16 KB; download em 20 s; exige url https.
- `src/routes/api/public.whatsapp.expense.ts:437-458`: `downloadWhatsappMedia` passa a usar o download limitado. O log registra só o motivo; os callers continuam recebendo `null` e já mostram mensagem amigável.
- Transcrição: 30 s (`whatsapp-transcription.server.ts:82`, retorna `failed`).
- OCR de boleto: 45 s (`whatsapp-boleto-ocr.server.ts:160`, retorna `gateway_error`).
- OCR de comprovante: 45 s (`ocr-comprovante.server.ts:162`). Antes um erro de rede lançava exceção; agora devolve 504 amigável. O log do erro da IA passa a registrar só o tamanho do corpo, não o conteúdo.
- O transporte Meta que já tinha timeout (`whatsapp-meta-transport.server.ts`) não foi duplicado.

## Testes (fixtures locais, sem rede)
- `tests/whatsapp-estabilizacao-pacote2.test.ts`: **19/0**. Casos:
  - corpo infinito; Content-Length acima do limite ou falso;
  - corpo pendurado; conexão pendurada; stream interrompido; corpo vazio;
  - 404 e 503; mídia permitida; url inválida;
  - classificação do envio; retry temporário; ambíguo e permanente sem reenvio; limite de 2 tentativas; exceção.
- Suíte oficial `node scripts/test-whatsapp.mjs`: **168 arquivos, 2.931 aprovados, 0 falhas**, rc=0, 69,9 s.
- `bunx tsgo --noEmit`: rc=0.
- Build: automático da plataforma; ver o log de build.
- Os mocks não provam o comportamento real da Meta, da IA nem da mídia.

## Para publicar
1. Revisão do diff pelo dono.
2. Monitorar `wa_reply_undelivered` e `[whatsapp] media download failed:<motivo>` depois de publicar.
3. A outbox durável só depois de: aprovar o SQL candidato, testar em Postgres descartável, ter backup e implementar o worker.

## Riscos
- Os tempos limite (8/20/30/45/15 s) podem cortar mídias muito lentas. Calibrar pelos logs.
- O retry acrescenta até cerca de 0,7 s + 15 s no pior caso. Isso vale só para 5xx/429 com resposta.

Não consigo confirmar o consumo exato de créditos.


---

## Revisão corretiva (14/10, após o commit 4fbc10de, NÃO PUBLICADO)

O dono apontou dois riscos de confirmação duplicada. Os dois foram corrigidos e o reenvio automático ficou **desativado por segurança**.

1. **5xx e 429 eram reenviados.** Agora os dois são `ambiguous`: o provedor pode ter enviado a mensagem antes de responder com erro, e o sistema só recebe o status HTTP, sem o código de erro da Meta. Nenhum resultado é classificado como `transient`. `deliverReplyWithRetry` existe, mas na prática faz **uma única tentativa**.
   **A afirmação anterior de "recuperação de falha temporária" está retirada.** Falhas temporárias não são recuperadas automaticamente.
2. **Exceção no interativo levava ao texto (`catch { sentOk = false }`).** Removido. Os três ramos — CTA Pix, `graphInteractive` (Flow) e os botões Confirmar/Ajustar/Cancelar — passam por `deliverReplyPlan` (`src/server/whatsapp-reply-delivery.server.ts`), que usa `safeSend`: qualquer exceção é `ambiguous`. O texto só é enviado quando não há interativo, ou quando o interativo foi recusado explicitamente (4xx exceto 429). Webhook: `src/routes/api/public.whatsapp.expense.ts:1168-1211`.
3. **Conferências:**
   - `sendWhatsAppRaw` tem `AbortSignal.timeout(15_000)` (`whatsapp.server.ts:6020`). Exceção, timeout e `AbortError` voltam sem `status` e são classificados como `ambiguous`.
   - HTTP 2xx (com ou sem id) é `accepted` **somente no sentido HTTP**. Entrega ao usuário só pode ser afirmada pelo callback de status.
   - Não há reenvio financeiro: a mensagem nunca é reprocessada.

**Testes**
- `tests/whatsapp-estabilizacao-pacote2.test.ts`: **28/0**. Casos novos:
  - 503, 500 e 429 → 1 tentativa;
  - exceção no interativo → texto não enviado (casos rotulados para os dois ramos);
  - 5xx no interativo → texto não enviado;
  - 400 → fallback em texto, 1 vez;
  - interativo aceito → sem texto.
- Esses testes exercitam o helper que o webhook passou a usar, não o handler HTTP completo. Ligação no webhook conferida por leitura: as 2 chamadas a `deliverReplyPlan` e nenhum `sentOk` restante.
- Suíte oficial: **168 arquivos, 2.940 aprovados, 0 falhas**, rc=0, 71,9 s.
- `bunx tsgo --noEmit`: rc=0.
- Build: automático da plataforma.

**GO/NO-GO (código atual, para revisão do dono)**

| Item | Status | Publicar? |
|---|---|---|
| A — resposta: classificação conservadora, sem confirmação dupla | CONCLUÍDO | GO após revisão |
| A — recuperação automática de falha temporária | BLOQUEADO por segurança | — |
| A — recuperação durável (outbox) | BLOQUEADO (SQL candidato inativo, não aplicado) | NO-GO até autorização |
| B — botões antigos | CONCLUÍDO (já existia) | GO |
| C — tempos limite e limites de mídia | CONCLUÍDO | GO após revisão; calibrar pelos logs |

**Consequência aceita:** quando a Meta devolve 5xx, 429 ou timeout, o usuário pode ficar sem confirmação. O gasto continua salvo uma única vez e o caso fica registrado no evento `wa_reply_undelivered`.

Não consigo confirmar o consumo exato de créditos.
