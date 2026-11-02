# Anexo 3 — Auditoria: Comprovantes, Fotos, PDFs, NFC-e/QR e Áudio

Escopo: leitura/OCR de comprovantes (foto), boletos (imagem/PDF/texto), NFC-e via QR/URL pública,
pipeline de áudio (validação, duração, transcrição, lote de gastos por voz).

**Aviso obrigatório do owner**: a foto real do comprovante Sam's Club (R$ 1.107,71, 11/10/2026) **NÃO
estava disponível localmente** nesta sandbox. Toda a verificação do fluxo "data 2006 vs 2026" foi feita
com a fixture **fictícia** já presente no repositório (`tests/whatsapp-comprovante-data-2026-10-12.test.ts`,
comentário explícito "Cenário fictício (sem dados reais)"), não com a imagem real. Da mesma forma, o
**teste de áudio real está pendente** — toda a cobertura de transcrição usa fixtures OGG/WAV sintéticas
geradas em teste e um `__setTranscriberForTests`/mock de rede; nenhum teste chama o Lovable AI Gateway de
verdade. Essas duas lacunas são **NÃO VERIFICADO** nesta auditoria e precisam de validação manual com o
arquivo/áudio reais do owner antes de qualquer alegação de "testado com dado real".

---

## 1. Visão geral do pipeline

```
Foto (comprovante) → ocr-comprovante.server.ts (Gemini Vision via Lovable AI Gateway)
                    → whatsapp-comprovantes.server.ts (sessão, confirmação, persistência)
Boleto (imagem/PDF) → whatsapp-boleto-ocr.server.ts (Gemini) + whatsapp-pdf-text-extract.server.ts (sem IA)
                     → whatsapp-boleto-parser.ts (validação determinística por DV) → whatsapp-boleto-ocr-cache
NFC-e (QR/URL)      → nfce-url-guard.ts (SSRF guard) → nfce-fetch.functions.ts → nfce-html-parser.ts
                     → nfce-items-parser.ts → nfce-to-gasto.ts
Áudio               → whatsapp-audio.server.ts (MIME/magic bytes) → whatsapp-audio-duration.server.ts
                     → whatsapp-transcription.server.ts → whatsapp-audio-lote.ts (lote de gastos por voz)
```

Tudo roteado por `src/server/whatsapp.server.ts` (fora do escopo de arquivos pedidos, mas consultado
pontualmente para confirmar como os módulos acima são chamados — citado como NÃO coberto integralmente).

---

## 2. Reconhecimento real vs. mocks — [C-P0-01]

**Achado**: Nenhum teste do repositório chama rede real (Lovable AI Gateway, Meta Graph API, OpenAI
Whisper). Confirmado por varredura (`grep` em `tests/*.ts`) — todos os arquivos de teste de OCR/boleto/
áudio usam `mock.module(...)`, `__setOcrExtractorForTests`, `__setBoletoOcrExtractorForTests`,
`__setTranscriberForTests` ou Supabase fake (`tests/_whatsapp-fake.ts`).

Evidência:
- `src/server/ocr-comprovante.server.ts:296-311` — hook de teste `__setOcrExtractorForTests` /
  `runExtractor`, comentado como "Nunca usar fora de testes".
- `src/server/whatsapp-boleto-ocr.server.ts:240-243` — em `NODE_ENV === "test"` sem extractor
  registrado, o pipeline **força** `missing_api_key` (nunca toca rede real em teste).
- `src/server/whatsapp-transcription.server.ts:115-131` — hook `__setTranscriberForTests`/`runTranscriber`.
- `tests/whatsapp-comprovante-data-2026-10-12.test.ts:1-109` — todo o Supabase é mockado
  (`mock.module("@/integrations/supabase/client.server", ...)`), incluindo a tabela `gastos` e
  `categorias`; não há acesso a banco real.

**Conclusão**: a suíte de testes valida **lógica determinística** (parsers, regras de data, dedupe,
máquina de estados) com muita qualidade, mas **não prova** que o Gemini Vision real extrai corretamente
valores/datas de fotos reais, nem que o Whisper (`openai/gpt-4o-mini-transcribe` via Lovable Gateway)
transcreve áudio real do WhatsApp com qualidade aceitável. Isso é esperado (não dá para testar IA
externa deterministicamente), mas deve ficar **explícito como risco operacional**, não como "coberto".

ID: **C-P1-01** — Documentar formalmente (ex.: checklist de QA manual) que todo o pipeline de IA (OCR de
imagem, OCR de boleto por imagem/PDF, transcrição de áudio) depende de testes manuais periódicos com
mídia real, pois a suíte automatizada não cobre a qualidade de extração do modelo.

---

## 3. MIME / magic bytes / tamanho

### 3.1 Imagem (comprovante) — `ocr-comprovante.server.ts:148-156`
Validação é fraca comparada a PDF/áudio: apenas checa prefixo de string `data:image/` e tamanho da
string base64 (`imageBase64.length > 20*1024*1024`). **Não há verificação de magic bytes reais** (JPEG/
PNG/WebP) neste arquivo — ao contrário do que é feito rigorosamente para áudio
(`detectAudioMimeFromBytes`) e PDF (`detectPdfFromBytes`). Um atacante pode enviar qualquer payload com
prefixo `data:image/x;base64,` (MIME arbitrário, até inexistente) e o texto ainda será repassado como
`image_url` ao Gemini. O impacto prático é baixo (o próprio Gateway de IA validará/rejeitará), mas é uma
inconsistência de postura de segurança em relação aos outros dois pipelines (áudio e PDF) do mesmo
produto, que são defensivos por padrão.

ID: **C-P2-01** — Adicionar verificação de magic bytes reais (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP
`RIFF....WEBP`) em `extrairDadosComprovante`, espelhando `detectAudioMimeFromBytes`/`detectPdfFromBytes`.

### 3.2 PDF de boleto — `whatsapp-pdf-validation.server.ts:19-86`
Robusto: `detectPdfFromBytes` varre até 1024 bytes à procura de `%PDF-`; `MAX_PDF_BYTES = 10MB`;
`estimatePdfPageCount` heurístico com `MAX_PDF_PAGES = 10`; `validateDownloadedPdf` consolida tudo e
ainda valida o MIME declarado quando presente (`whatsapp-pdf-validation.server.ts:76-81`). Bom.

### 3.3 Extração de texto de PDF (bomb de descompressão) — `whatsapp-pdf-text-extract.server.ts`
Múltiplos limites explícitos e comentados: `MAX_SCAN_BYTES`, `MAX_PDF_INPUT_BYTES`, `MAX_STREAMS=24`,
`MAX_COMPRESSED_PER_STREAM=2MB`, `MAX_INFLATED_PER_STREAM=2MB`, `MAX_INFLATED_TOTAL=6MB` (linhas 30-35).
`inflateFlateStream` tenta `deflate` depois `deflate-raw`, com cancelamento de reader e cap de bytes
lidos por chunk (linhas 62-122). Falha silenciosa documentada ("Nunca trava o handler"). Esta é a parte
mais robusta do módulo 3 contra decompression-bomb.

### 3.4 Áudio — `whatsapp-audio.server.ts:64-165`
Validação em duas camadas: (1) MIME declarado contra allowlist (`ALLOWED_AUDIO_MIME`, linha 49-63); (2)
bytes mágicos reais via `detectAudioMimeFromBytes` (OGG/WAV/FLAC/WebM/MP4/MP3, linhas 73-110); (3)
`compatibleMime` reconcilia apelidos (ex.: `audio/mp3`↔`audio/mpeg`). `validateDownloadedAudio` rejeita
vazio, grande demais (`getMaxAudioBytes()` default 10MB), tipo não suportado e **divergência entre MIME
declarado e bytes reais** (`mime_mismatch`). Isto é o padrão mais rigoroso dos três (bom modelo a copiar
para imagem — ver C-P2-01).

### 3.5 Download de mídia da Meta sem timeout — **[C-P1-02]**
`src/routes/api/public.whatsapp.expense.ts:437-466` (`downloadWhatsappMedia`): o segundo `fetch` (linha
454, download do binário) **não usa `AbortController`/timeout**, ao contrário do fetch de NFC-e
(`nfce-fetch.functions.ts:52-69`, que usa `AbortController` + `TIMEOUT_MS=8000`). Além disso, o corpo é
lido inteiro com `await dl.arrayBuffer()` (linha 457) **antes** de checar `maxBytes` (linha 458) — ou
seja, a validação de tamanho é pós-leitura, não streaming. Um host malicioso/lento controlado via `meta.url`
(que é uma URL assinada retornada pela própria Meta, portanto com superfície de ataque menor, mas ainda
assim) pode manter a conexão aberta por tempo indefinido, não há timeout de rede nessa chamada nem para
a mídia de imagem nem para a de áudio. Isso contraria o comentário do pipeline de áudio, que alega
("Áudios só existem em memória durante o processamento" — `whatsapp-audio.server.ts:14-16`) um cuidado de
segurança que não é acompanhado de limite de tempo no download em si.

ID: **C-P1-02** — Adicionar `AbortController` com timeout (ex.: 10-15s) ao `fetch(meta.url, ...)` em
`downloadWhatsappMedia`, e preferencialmente trocar `arrayBuffer()` por leitura em streaming com corte
no limite de bytes (como já é feito em `nfce-fetch.functions.ts:73-101`, `readLimitedText`).

---

## 4. Totais e valores

- `ocr-comprovante.server.ts:280-301` (SYSTEM_PROMPT) orienta o modelo a priorizar valores perto de
  "Total/Valor/Pago" e evitar "Desconto/Cashback/Troco/Juros/Taxa/Parcelas/Limite" — mas isso é só prompt
  de IA, não validação determinística; o `tool_choice` força uso da function, e o server filtra
  `valoresEncontrados` para só números finitos > 0 (linhas 219-223). Não há validação cruzada
  "soma dos itens == total" no comprovante de foto (diferente da NFC-e via QR, ver abaixo).
- `nfce-html-parser.ts:244-262` faz validação cruzada: soma dos itens vs. total declarado, com tolerância
  relativa de 15% e absoluta de R$0,50; se divergir, soma `warnings.push("total_mismatch")` — mas o valor
  final usado em `nfce-to-gasto.ts:57-60` sempre prioriza `totalDeclared` quando presente (não a soma),
  e só usa a soma como *fallback* quando não há total declarado. Correto e documentado em comentário.
- `nfce-items-parser.ts:271-281` e `nfce-html-parser.ts:200-212` calculam `confianca` por item comparando
  `quantidade*unitário` vs `total` (tolerância 10%/R$0,05) — rebaixam para "baixa" quando diverge. Boa
  prática de granularidade (não assumem corretude cega do parser regex).

---

## 5. Data de emissão vs. 2006 — `escolherDataComprovante` / `interpretarRespostaData`

### 5.1 `escolherDataComprovante` — `ocr-comprovante.server.ts:276-295`
- Prioridade: `dataEmissao ?? dataAutorizacao ?? data` (linha 286).
- `anoMin` por tipo de documento: `{ nfce: 2012, nfe: 2006, sat: 2015, pix: 2020 }` (linha 270).
- Marca `incerta: true` quando (a) as três datas lidas divergem entre si, OU (b) o ano é menor que o
  mínimo plausível para o `tipoDocumento` informado (linha 293: `anoImpossivel`).
- **Nunca troca o ano "adivinhando"**: se o OCR leu `2006` para uma NFC-e, o valor retornado em `data`
  continua `2006-...` (não substitui por `2026`); apenas sinaliza `incerta`, deixando o usuário decidir.
  Isso é consistente com o comentário do arquivo ("Nunca troca o ano por palpite", linha 273-276) e com o
  teste `tests/whatsapp-comprovante-data-2026-10-12.test.ts:143-169`, que prova exatamente esse
  comportamento com a fixture fictícia baseada no caso real relatado pelo owner.

### 5.2 `interpretarRespostaData` — `whatsapp-comprovantes.server.ts:255-277`
- Aceita variantes "Essa", "essa", "Usar essa", "essa data", "a da nota", "data da nota", "manter",
  "Sim"/"sim" **apenas quando `dataIncerta === false`** (linha 266-269: `afirmativo && !dataIncerta`).
- Quando `dataIncerta === true` (ex.: NFC-e lida como 2006), um "Sim" sozinho retorna `{ kind: "indefinida" }`
  (linha 271) — ou seja, **"Sim" não é suficiente para confirmar uma data incerta**; o usuário precisa
  dizer algo que contenha explicitamente "essa/nota/cupom/comprovante/indicada" ou informar uma data
  concreta. Confirmado por teste: `tests/whatsapp-comprovante-data-2026-10-12.test.ts:203-209` (`"Sim" é
  ambíguo quando a data é incerta`) e pela bateria `describe("2006 incerta (NFC-e) nunca é gravada por
  confirmação genérica")` (linhas 240-261), que testa exatamente as variantes "Essa", "Sim", "Usar essa",
  "a da nota", "manter" contra a sessão com `dataIncerta: true` e comprova que **nenhuma delas salva
  2006** — só uma data explícita (`11/10/2026`) ou "hoje" resolve o impasse.
- Datas explícitas são extraídas por `parseData` (`whatsapp-comprovantes.server.ts:295-312`, regex
  `DD/MM/YYYY`) e passam por validação de calendário (`isoValida`, `ocr-comprovante.server.ts:257-266`
  — testa `getUTCFullYear/Month/Date` para rejeitar datas inválidas como 31/02).

**Conclusão**: a lógica está correta e bem testada com a fixture fictícia equivalente ao caso relatado
(Sam's Club, R$ 1.107,71, NFC-e lida como 2006 em vez de 2026). **Porém, isso não é o mesmo que testar
com o arquivo real** — o Gemini pode se comportar de forma diferente diante da imagem real (ex.: outra
posição do ano na imagem, reflexo, corte da nota) e isso só pode ser confirmado rodando o pipeline de
verdade com a foto. Está marcado como **NÃO VERIFICADO**.

---

## 6. Variantes de confirmação (Essa/Sim/Usar essa)

Cobertas no item 5.2 e nos testes `tests/whatsapp-comprovante-data-2026-10-12.test.ts:172-181` (loop sobre
`["Essa", "Usar essa", "essa data", "a da nota", "Sim", "USAR ESSA!"]`) e `:226-231` (loop maior incluindo
"sim", "manter", "data da nota"). Todas resultam em `kind: "nota"` quando `dataIncerta=false`. A
implementação normaliza acentos/maiúsculas (`normalize`, `whatsapp-comprovantes.server.ts:149-156`) e
remove pontuação final (linha 256), tornando a interpretação tolerante a variações reais de digitação do
WhatsApp.

Fora do escopo de data, a confirmação principal da sessão de comprovante (resumo → "sim"/decisão
`confirm`) é tratada em `processarRespostaImagem` (`whatsapp-comprovantes.server.ts:1358-1413`), que só
avança para `avancarAposConfirmacao` quando `decisao === "confirm"` (linha 1408) — a decisão em si
(classificação "confirm"/"cancel"/"outro" do texto livre) é calculada fora deste arquivo (no roteador
`whatsapp.server.ts`, fora do escopo pedido) e passada como parâmetro; **não foi possível auditar aqui a
lista completa de palavras aceitas como "confirm" genérico** (fora dos arquivos pedidos) — **NÃO
VERIFICADO** nesta rodada.

---

## 7. "33 itens → 1 gasto" (NFC-e)

- `nfce-to-gasto.ts` tem o princípio explícito no cabeçalho: "UMA compra = UM gasto. Itens são apenas
  informação auxiliar" (linha 7). `mapNfceResultToExtracao` sempre retorna um único `valor` (o total) e
  um array `itens` (até 60, linha 64) apenas para exibição (`NotaItemAuxiliar[]`).
- Teste dedicado: `tests/whatsapp-comprovante-data-2026-10-12.test.ts:264-272`
  (`describe("NFC-e 33 itens = 1 gasto; replay não duplica")`) — monta 33 itens fictícios
  (`Array.from({ length: 33 }, ...)`), injeta na sessão de comprovante e confirma que **um único**
  `insert` em `gastos` é gerado, inclusive em replay do mesmo `external_id` (`wamid.33` chamado duas
  vezes, linha 268-269, `insertedGastos` permanece com 1 elemento).
- Isso usa a sessão de **comprovante por foto** com um campo `itens` extra, não exatamente o caminho de
  NFC-e via QR (`nfce-to-gasto.ts`) ponta a ponta integrado ao WhatsApp — **não há**, nos arquivos lidos,
  um teste de integração que vá de `fetchNfceFromUrl` real até `whatsapp-comprovantes.server.ts` /
  `whatsapp.server.ts` salvando o gasto. O fluxo de NFC-e por QR no WhatsApp (se existir) está fora dos
  arquivos pedidos — **NÃO VERIFICADO** se o caminho "QR Code recebido no WhatsApp → consulta SEFAZ →
  1 gasto" está de fato ligado ao `whatsapp.server.ts`, ou se o `nfce-to-gasto.ts`/`nfce-fetch.functions.ts`
  é usado apenas pela UI web do site (sinalizado por `createServerFn` + `requireSupabaseAuth`, típico de
  rota web, não de webhook do WhatsApp).

ID: **C-P2-02** — Confirmar (fora desta auditoria, com o time) se o fluxo de NFC-e por QR está de fato
acessível via WhatsApp ou é exclusivo do site; se for exclusivo do site, a cobertura "33 itens → 1 gasto"
testada é por **sessão de comprovante de foto**, não pelo pipeline de QR/NFC-e.

---

## 8. Retry / dedupe

- **Comprovante (foto)**: `persistirGastoComprovante` (`whatsapp-comprovantes.server.ts:861-935`) usa
  `gastoId = financialIdForWhatsAppMessage(userId, externalMessageId, "expense_receipt")` — ID
  determinístico por (usuário, mensagem) — e trata `error?.code === "23505"` (colisão de PK/unique) como
  sucesso idempotente, retornando a mesma resposta de "salvo" sem inserir de novo (linhas 917-927).
  Testado em `tests/whatsapp-comprovante-data-2026-10-12.test.ts:213-224` (retries da mesma mensagem não
  duplicam; usuários diferentes não compartilham lançamento, com IDs diferentes).
- **Lote de áudio**: `tests/whatsapp-audio-lote-2026-10-12.test.ts:155-161` — "retry do mesmo 'confirmar'
  e um segundo 'confirmar' não duplicam": dois replays do `external_id` `conf-1` + um novo `conf-2` do
  usuário resultam em exatamente 2 gastos inseridos (não 4, não 6) — dedupe por idempotência também
  presente no fluxo de lote (implementação de persistência de lote está em `whatsapp.server.ts`, fora do
  escopo de arquivos pedidos — **NÃO VERIFICADO** a implementação linha a linha, só o comportamento via
  teste).
- **Boleto**: `whatsapp-boleto-ocr-cache.server.ts` não é dedupe de gasto, é cache de resultado de OCR
  por `(userId, sha256, kind)` com TTL de 10 min e LRU de 200 entradas (linhas 24-69) — existe para
  evitar reprocessar a mesma mídia reenviada, não para idempotência financeira. A idempotência financeira
  de boleto está fora dos arquivos lidos nesta rodada (ex.: `whatsapp-boleto-intents.server.ts`, 1479
  linhas, **não lido integralmente** — ver tabela de cobertura). `tests/whatsapp-boleto-c10a.test.ts:269`
  tem um teste chamado "retry do mesmo external_id não cria conta duplicada", o que indica que a garantia
  existe, mas a implementação completa não foi auditada linha a linha aqui.

ID: **C-P1-03** — `whatsapp-boleto-intents.server.ts` (1479 linhas) é o maior arquivo do domínio de
boleto e **não foi lido integralmente** nesta auditoria (apenas indiretamente via grep). Como ele
provavelmente contém a lógica de confirmação/persistência final do boleto (análogo a
`persistirGastoComprovante`), recomenda-se auditoria dedicada antes de considerar o fluxo de boleto
coberto no mesmo nível de rigor que o de comprovante/áudio.

---

## 9. Sessões expiradas

- `whatsapp.server.ts:1369`: `PENDING_TTL_MS = 30 * 60 * 1000` (30 minutos) — constante de TTL para
  sessões pendentes (comprovante, boleto, lote de áudio, etc., todas usam a mesma tabela
  `whatsapp_messages`/status). Fora do escopo de arquivos pedidos para leitura integral, mas a constante e
  os pontos de uso (`fecharSessoesAnteriores(..., "expirada")`, múltiplas ocorrências entre linhas 2710 e
  6102) confirmam que sessões antigas são marcadas como `"expirada"` antes de abrir uma nova, e que o
  status `"expirada"` está listado em `COMPROVANTE_PENDING_STATES`-adjacent machinery (linha 1428).
- Dentro do escopo auditado, `whatsapp-comprovantes.server.ts` não implementa o TTL em si (ele confia no
  caller para não repassar uma sessão expirada); o módulo trata apenas o *conteúdo* da sessão ativa. Isso é
  esperado pela separação de responsabilidades do projeto, mas significa que **a garantia de expiração não
  está no arquivo auditado em profundidade** — está em `whatsapp.server.ts`, fora do escopo total.

ID: **C-P2-03** (informativo) — Documentar explicitamente, dentro de `whatsapp-comprovantes.server.ts`,
que a expiração de 30 min é responsabilidade do caller (`whatsapp.server.ts`), para evitar que uma futura
refatoração do módulo de comprovantes assuma TTL próprio inexistente.

---

## 10. "Nunca re-ler a foto" / "nunca salvar sem confirmação"

- `whatsapp-comprovantes.server.ts:16-17` (comentário de topo): "Nunca cria gasto automaticamente —
  sempre passa por confirmação." Confirmado pelo fluxo: toda transição para `"salva"` passa por
  `avancarAposConfirmacao` (linha 1043), que exige, em ordem: categoria obrigatória (linha 1050),
  confirmação de data quando incerta/fora da janela (linha 1061), forma de pagamento (linha 1074), e só
  então `persistirGastoComprovante` (linha 1082). Não há atalho de "owner"/admin que pule a categoria
  obrigatória — o comentário em `processarRespostaImagem` (linhas 1323-1327) é explícito: "Sem atalho por
  papel... Um 'bypass' aqui devolvia um valor fora do contrato... e deixava a sessão pendente presa" —
  indicando que um bug desse tipo já existiu e foi corrigido.
- "Nunca re-ler a foto": a imagem **não é persistida** em nenhum momento — `ImageAttachment.base64` só
  existe em memória durante `processarNovaImagem` (chamada única a `runExtractor`, linha 988); a sessão
  salva em banco (`ComprovanteSession`) guarda apenas `imageSha256`/`imageMimeType` (linhas 68-70), nunca
  o base64. Isso é consistente com o comentário de privacidade do topo do arquivo (linhas 9-14). Logo,
  mesmo que o usuário troque de ideia sobre valor/categoria durante a sessão, **a imagem nunca é re-OCRed**
  — o sistema trabalha só com os campos já extraídos e com os ajustes manuais do usuário
  (`detectAjuste`/`AjusteIntent`, linhas 725-783). Isso é uma garantia correta de design, mas também
  significa que, se o OCR errou um valor e o usuário não perceber/corrigir manualmente, o erro persiste
  até a confirmação — não há segunda chance automática de releitura.

---

## 11. Áudio — Whisper: download, timeout/limite, confirmação de ações de risco

### 11.1 Download/timeout/limite
- MIME + bytes mágicos + tamanho validados por `validateDownloadedAudio` (`whatsapp-audio.server.ts:
  144-165`), com `getMaxAudioBytes()` (default 10 MB, `envInt`, linha 24-37).
- Duração real (não confia na Meta) extraída por parsing binário puro em
  `whatsapp-audio-duration.server.ts` (OGG/WAV/FLAC/MP4/MP3/WebM) — fail-closed: qualquer formato não
  suportado ou falha de parsing retorna `duration_unavailable` e o áudio **não é enviado para
  transcrição** (comentário linhas 17-21, reforçado pela política em `measureAudioDuration`, linhas
  383-420). `getMaxAudioSeconds()` default 120s (linha 44-46 de `whatsapp-audio.server.ts`); duração acima
  do limite → `"too_long"` (linha 416-418 de `whatsapp-audio-duration.server.ts`).
- **Download em si sem timeout**: como relatado no item 3.5 (**C-P1-02**), o `fetch` que baixa o binário
  da Meta não tem `AbortController`/timeout, e o corpo é lido inteiro antes da checagem de tamanho. Isso
  vale igualmente para a mídia de áudio quanto para imagem/documento — é uma lacuna transversal, não
  exclusiva de áudio, mas relevante aqui porque o comentário de `whatsapp-audio.server.ts` (linhas 14-16)
  dá a entender que o "processamento em memória" é inteiramente controlado, quando na prática falta
  limite de tempo de rede.
- Transcrição (`whatsapp-transcription.server.ts:57-112`): usa `fetch` simples sem `AbortController`
  também — nenhum timeout explícito para a chamada ao Lovable AI Gateway
  (`https://ai.gateway.lovable.dev/v1/audio/transcriptions`). Erros de rede são capturados por `try/catch`
  (linha 104-111), mas uma resposta pendurada (sem erro, sem fechar conexão) poderia travar a requisição
  indefinidamente — mesma classe de problema do item 3.5.

ID: **C-P1-04** — Adicionar timeout (`AbortController`, ex. 20-30s) à chamada
`fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", ...)` em
`transcribeWhatsAppAudio` (`whatsapp-transcription.server.ts:78-82`).

### 11.2 Áudio não pode confirmar ações de risco
- Confirmado por código e teste: `whatsapp.server.ts:2744-2750` — quando há uma sessão de **comprovante**
  pendente e a mensagem chega por áudio, o sistema **recusa processar a resposta por voz** e devolve
  aviso pedindo confirmação por texto ("sim, ajustar ou cancelar"), sem tocar a sessão. Testado em
  `tests/whatsapp-audio-lote-2026-10-12.test.ts:163-187` ("comprovante pendente: 'confirmar' por áudio não
  salva a foto" — asserts `gastosInserts()` com `toHaveLength(0)`).
- Para o próprio fluxo de **lote de áudio** (múltiplos gastos detectados na mesma fala), a confirmação
  final de "Confirmar" é aceita tanto por texto quanto implicitamente pelo próprio áudio que gerou o lote
  — mas a sequência observada nos testes sempre envia o "pix"/"confirmar" subsequente via **texto**
  (`texto(...)`, não `audio(...)`), nunca por áudio novo (`tests/whatsapp-audio-lote-2026-10-12.test.ts:
  139-152`). Isso sugere, mas **não prova explicitamente**, que a confirmação de salvar múltiplos gastos
  também exigiria texto; não há teste que envie um **segundo áudio** dizendo "confirmar" para o lote
  pendente e verifique rejeição/aceitação explícita — **NÃO VERIFICADO** esse caso específico (lote
  pendente + confirmação por um segundo áudio, em vez de por texto).

ID: **C-P1-05** — Adicionar teste explícito: lote de áudio pendente de confirmação + **segundo áudio**
dizendo "confirmar" → deve ser rejeitado/pedir texto (mesma política aplicada a comprovante de foto), ou
documentar por que seria seguro aceitar (ex.: o próprio texto transcrito do áudio é tratado como "texto"
dali em diante, o que tornaria a frase "confiável" por já ter passado pela extração de intenção
novamente — mas isso não está provado em teste).

---

## 12. SSRF / segurança adicional (NFC-e)

- `nfce-url-guard.ts` é uma função pura e abrangente: exige HTTPS (linha 87), rejeita credenciais na URL
  (linha 88), porta diferente de 443 (linha 89), bloqueia hosts de metadata cloud (linha 93), loopback
  (linha 94-96), IPv6 literal (linha 97), IPv4 literal — público ou privado (linhas 98-104), sufixos
  internos (`.local/.internal/.lan/.home/.test`, linha 105-107), e por fim exige
  `isAllowedNfceHost` (sufixo `.gov.br` **E** uma pista fiscal tipo "sefaz/fazenda/receita" no hostname,
  linhas 69-73). `nfce-fetch.functions.ts` revalida **cada hop de redirect** pela mesma guarda (linhas
  144-166), com limite de 3 redirects, timeout de 8s e leitura limitada a 2 MB em streaming
  (`readLimitedText`, linhas 73-101). Esta é a parte do módulo 3 com a melhor postura de segurança de
  rede observada — e, em contraste direto, reforça por que a ausência de timeout no download de mídia do
  WhatsApp (C-P1-02) é uma inconsistência a corrigir.

---

## 13. Lista de IDs

| ID | Severidade | Resumo |
|---|---|---|
| C-P1-01 | P1 | Suíte de testes nunca toca IA real (Gemini Vision/Whisper); qualidade de extração real não é verificada automaticamente — exige checklist de QA manual periódico. |
| C-P2-01 | P2 | `ocr-comprovante.server.ts` não valida magic bytes reais de imagem (só prefixo string `data:image/`), inconsistente com o rigor aplicado a áudio/PDF. |
| C-P1-02 | P1 | Download de mídia da Meta (`downloadWhatsappMedia`) sem `AbortController`/timeout e sem leitura em streaming — lê corpo inteiro antes de checar tamanho. Vale para imagem, PDF e áudio. |
| C-P1-03 | P1 | `whatsapp-boleto-intents.server.ts` (1479 linhas) não foi lido integralmente nesta auditoria; é provável concentrador de lógica de confirmação/persistência de boleto e carece de auditoria dedicada. |
| C-P2-02 | P2 | Não confirmado se o pipeline de NFC-e via QR (`nfce-fetch.functions.ts`/`nfce-to-gasto.ts`, que exigem `requireSupabaseAuth`/server function web) está de fato acessível via WhatsApp ou é exclusivo do site. |
| C-P2-03 | P2 (doc) | TTL de sessão pendente (30 min) vive em `whatsapp.server.ts`, fora de `whatsapp-comprovantes.server.ts`; documentar a dependência explicitamente no módulo de comprovantes. |
| C-P1-04 | P1 | Chamada de transcrição (`transcribeWhatsAppAudio`) sem timeout/`AbortController` para o Lovable AI Gateway. |
| C-P1-05 | P1 | Falta teste explícito cobrindo "lote de áudio pendente + segundo áudio dizendo 'confirmar'" — comportamento real não verificado nesta auditoria. |
| — | HIPÓTESE | A separação "áudio nunca confirma comprovante pendente" (comprovada) provavelmente foi desenhada para cobrir também boletos/lotes pendentes por simetria, mas isso só foi comprovado para comprovante de foto; para boleto não foi verificado nos arquivos lidos. |

---

## 14. Tabela de cobertura

| Arquivo | Linhas totais | Linhas lidas | Status |
|---|---|---|---|
| src/server/whatsapp-comprovantes.server.ts | 1565 | 1-1565 | Integral |
| src/server/ocr-comprovante.server.ts | 311 | 1-311 | Integral |
| src/server/whatsapp-boleto-ocr.server.ts | 270 | 1-270 | Integral |
| src/server/whatsapp-boleto-ocr-cache.server.ts | 74 | 1-74 | Integral |
| src/server/whatsapp-boleto-banco.ts | 60 | 1-60 | Integral |
| src/server/whatsapp-boleto-secret.server.ts | 59 | 1-59 | Integral |
| src/server/whatsapp-pdf-text-extract.server.ts | 224 | 1-224 | Integral |
| src/server/whatsapp-pdf-validation.server.ts | 86 | 1-86 | Integral |
| src/server/whatsapp-media-attachment.ts | 37 | 1-37 | Integral |
| src/server/whatsapp-audio.server.ts | 237 | 1-237 | Integral |
| src/server/whatsapp-audio-lote.ts | 238 | 1-238 | Integral |
| src/server/whatsapp-transcription.server.ts | 135 | 1-135 | Integral |
| src/server/whatsapp-audio-duration.server.ts | 430 | 1-430 | Integral (lido para complementar duração/Whisper) |
| src/server/whatsapp-boleto-parser.ts | 335 | 1-335 | Integral (lido para complementar validação de boleto) |
| src/lib/nota/nfce-to-gasto.ts | 88 | 1-88 | Integral |
| src/lib/nota/nfce-url-guard.ts | 111 | 1-111 | Integral |
| src/lib/mercado/nfce-fetch.functions.ts | 230 | 1-230 | Integral |
| src/lib/mercado/nfce-html-parser.ts | 273 | 1-273 | Integral |
| src/lib/mercado/nfce-items-parser.ts | 371 | 1-371 | Integral |
| src/lib/mercado/nfce-parser.ts | 206 | 1-206 | Integral |
| src/routes/api/ocr-gasto.ts | 55 | 1-55 | Integral |
| src/routes/api/public.whatsapp.expense.ts (consultado, fora do escopo pedido) | 1271 | ~420-470 | Parcial (apenas `downloadWhatsappMedia` e cabeçalho da rota) |
| src/server/whatsapp.server.ts (consultado, fora do escopo pedido) | 6185 | trechos pontuais (grep + ~2735-2790, 5660-5695) | Parcial (poucas dezenas de linhas, referência a TTL/sessão/áudio-comprovante) |
| src/server/whatsapp-boleto-intents.server.ts | 1479 | 0 | **Não lido** (apenas grep pontual) — ver C-P1-03 |
| tests/whatsapp-comprovante-data-2026-10-12.test.ts | 272 | 1-272 | Integral |
| tests/whatsapp-audio-lote-2026-10-12.test.ts | 244 | 1-244 | Integral |
| tests/nota-nfce-extracao.test.ts | 73 | 1-73 | Integral |
| tests/whatsapp-audio.test.ts | 563 | ~1-80 + grep de nomes de `test(...)` | Parcial |
| tests/whatsapp-audio-duration.test.ts | 491 | grep de nomes (`it(...)` não encontrado — arquivo usa outro padrão não investigado a fundo) | Parcial/não lido em detalhe |
| tests/whatsapp-comprovantes.test.ts | 1776 | 0 (apenas inventariado por `wc -l`) | **Não lido** |
| tests/whatsapp-comprovante-categoria-manual.test.ts | 261 | 0 | **Não lido** |
| tests/whatsapp-boleto-c10a.test.ts | 350 | grep pontual (retry/fingerprint) | Parcial |
| tests/whatsapp-boleto-c10a-1.test.ts | 242 | 0 | **Não lido** |
| tests/whatsapp-boleto-c10b.test.ts | 233 | grep pontual (dedupe fingerprint) | Parcial |
| tests/whatsapp-boleto-c10b2.test.ts | 276 | 0 | **Não lido** |
| tests/whatsapp-boleto-c10b-hardening.test.ts | 197 | 0 | **Não lido** |
| tests/whatsapp-boleto-c10b-integration.test.ts | 180 | grep pontual | Parcial |
| tests/whatsapp-boleto-rate-limit-3-36.test.ts | 295 | 0 | **Não lido** |
| tests/whatsapp-boleto-wa-c10-3.test.ts | 188 | 0 | **Não lido** |
| tests/whatsapp-c11-f3b2d-boleto-mutex.test.ts | 129 | grep pontual | Parcial |
| tests/whatsapp-boleto-banco-emissor-c10-4.test.ts | 81 | 0 | **Não lido** |
| tests/whatsapp-boleto-c10a-1.test.ts.bak.sh | — | 0 | Não lido (arquivo `.bak.sh`, aparenta ser resíduo, fora do escopo de teste ativo) |

**Resumo de lacunas de cobertura**: o núcleo determinístico de comprovante/áudio/NFC-e/PDF foi lido
**integralmente** nos arquivos de produção listados no enunciado. As maiores lacunas são: (1)
`whatsapp-boleto-intents.server.ts` — arquivo de produção de 1479 linhas não lido; (2) a maior parte dos
testes de boleto (`c10a-1`, `c10b2`, `c10b-hardening`, `rate-limit`, `wa-c10-3`, `banco-emissor`) e o
maior teste de comprovante (`whatsapp-comprovantes.test.ts`, 1776 linhas) não foram lidos linha a linha —
apenas inventariados por tamanho e, em alguns casos, varridos por `grep`. Recomenda-se uma segunda rodada
de auditoria focada nesses arquivos antes de considerar o domínio "boleto" no mesmo nível de confiança
que "comprovante por foto" e "NFC-e".
