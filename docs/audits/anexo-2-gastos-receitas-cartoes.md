# Anexo 2 — Auditoria: Gastos / Receitas / Cartões via WhatsApp

Escopo lido integralmente (citações `arquivo:Lstart-Lend` referem-se ao caminho real no repo):

- `src/server/whatsapp.server.ts` (6185 linhas)
- `src/server/expense-button-token.server.ts` (88)
- `src/server/whatsapp-financial-idempotency.server.ts` (18)
- `src/server/whatsapp-cartao-flow.ts` (167)
- `src/server/whatsapp-cartao-messages.ts` (115)
- `src/server/cartao-cadastro.server.ts` (151)
- `src/server/cartao-parcelamento.server.ts` (182)
- `src/server/cartao-limite.server.ts` (146)
- `src/server/whatsapp-fatura-escolha.server.ts` (174)
- `src/server/whatsapp-cycle-resolver.server.ts` (97)
- `src/server/whatsapp-mes-nomeado.ts` (234)
- `src/server/whatsapp-consultas.server.ts` (1483)
- `src/server/whatsapp-short-context.server.ts` (379)
- `src/server/whatsapp-merchant-memory.server.ts` (268)
- `src/server/whatsapp-contas-editar.server.ts` (1501)
- `src/server/whatsapp-finance-brief.server.ts` (188)
- `src/lib/whatsappParser.ts` (410) — lido porque é a origem real do parsing de valor/data/forma citado no pedido (importado em `whatsapp.server.ts:29-35`).

Arquivos importados pelo pipeline mas **não lidos integralmente** (fora do orçamento desta rodada — ver tabela de cobertura): `whatsapp-receitas.server.ts`, `whatsapp-parcelamento.server.ts`, `whatsapp-contas-criar.server.ts`, `whatsapp-contas-pagar.server.ts`, `whatsapp-faturas.server.ts`, `whatsapp-limites.server.ts`, `whatsapp-cartao-cadastro.server.ts`, `whatsapp-comprovantes.server.ts`, `cartao-fatura.server.ts`, `contas-vencimento.server.ts`, `whatsapp-audio-lote.ts`, `whatsapp-pix-*`, `whatsapp-boleto-*`, `whatsapp-agenda.server.ts`. Qualquer afirmação sobre esses arquivos está marcada **NÃO VERIFICADO**.

---

## 1. Resumo executivo

O pipeline principal (`whatsapp.server.ts`) é um roteador de estados grande e cuidadosamente comentado, com boas práticas visíveis: idempotência determinística em inserts financeiros (`financialIdForWhatsAppMessage`), botões HMAC com *timing-safe compare* e *revision binding* à sessão, TTL de 30 min para sessões pendentes, e múltiplas guardas para nunca "vazar" dado de outro usuário. Apesar disso, foi encontrado **um defeito financeiro grave confirmado por teste reproduzível** no parser de valor usado por todo o fluxo de texto (G-P0-1): valores digitados no formato BR com ponto de milhar e sem vírgula decimal (ex.: `"aluguel 1.950 pix"`) são interpretados como `R$ 1,95` em vez de `R$ 1.950,00`. Isso é agravado pelo fato de o parser de valor dos *botões/edição de contas* (`whatsapp-contas-editar.server.ts`) já tratar esse caso corretamente, confirmando que a omissão é um bug pontual e corrigível, não uma ambiguidade inerente.

Também foram identificadas inconsistências de UX/segurança menores (G-P1/G-P2): código morto de confirmação de "data futura" em edição de contas, e uma divergência de comportamento entre o fluxo principal de gasto (onde "não" cancela a confirmação) e o fluxo de edição de conta a pagar (onde "não" apenas repete a pergunta, exigindo a palavra literal "cancelar").

---

## 2. Inventário de funções por arquivo, linhas, escritas no banco e cobertura de teste

### 2.1 `src/server/whatsapp.server.ts`

| Função | Linhas | Escreve em | Observação |
|---|---|---|---|
| `resolveUserId` | 505-527 | — (leitura `whatsapp_links`) | Candidatos de telefone com/sem `55`; exige `ativo && opt_in_em && !revogado_em`. |
| `carregarCartoes` / `carregarCategorias` | 531-550 / 676-691 | — | Sempre filtram por `user_id`. |
| `matchCartao` | 624-673 | — | Resolve cartão citado por nome/banco/últimos 4 dígitos; retorna `ambiguous` quando >1 match — nunca escolhe arbitrariamente. |
| `pickCategoriaKey` / `resolveCategoriaIdFromList` | 780-818 | — | Keyword de alimentação por voz (`ALIMENTACAO_KEYWORDS_VOICE`) só ativa quando `source==="audio"` (comentário e código condizentes, linha 788). |
| `detectCategoriaCommand` / `parseCampoAjuste` / `isAjustarCommand` | 948-982, 1355-1367 | — | Parsers estritos (âncoras `^...$`), reduzem falso-positivo de comandos soltos. |
| `classificarResposta` | 984-990 | — | `CONFIRM_TOKENS`/`CANCEL_TOKENS` fixos; "não"/"n"/"errado" tratados como `cancel`, não como reset. |
| `persistirGasto` | 2034-2203 | `gastos` (insert) | Gate de quota primeiro (2046-2053); bloqueia descrição genérica pós-limpeza (2061-2063); resolve categoria com prioridade manual > memória > automática (2064-2094); grava com **id determinístico** `financialIdForWhatsAppMessage(userId, actionId, "expense")` (2125); trata `23505` revalidando que a linha prévia pertence ao mesmo usuário e `origem='whatsapp'` antes de reusar o id (2155-2166) — proteção real contra reprocessamento/duplicidade. |
| `aplicarMemoriaEstabelecimento` | 2216-2283 | — (lê/decide, grava via `recordMerchantMemory` só depois do insert do gasto) | Nunca sobrescreve categoria forte por keyword nem escolha manual (2241-2249). |
| `gravarSessao` / `atualizarSessao` / `atualizarSessaoOuFalhar` | 2447-2577 | `whatsapp_messages` (insert/update) | Retornam `ok:false` explícito em erro de RLS/insert, e `atualizarSessaoOuFalhar` propaga uma resposta neutra em vez de deixar o pipeline seguir como se tivesse sucesso (2564-2577) — mitigação correta contra "sessão fantasma". |
| `buscarSessaoAtiva` | 1767-1794 | — | Janela de `PENDING_TTL_MS` = 30 min (`const PENDING_TTL_MS = 30 * 60 * 1000;`, linha 1369) aplicada via `.gte("recebida_em", desde)`. |
| `buscarVinculoBotaoGasto` | 1741-1766 | — | Só retorna vínculo quando exatamente **1** linha bate por `external_id` OU por `resposta_sugerida` — evita amarrar o botão à sessão errada em corrida. |
| Bloco de validação de botão `exp1:` | 3136-3155 | — | `v.ok && alvo.id===v.rowId && expenseSessionRevision(alvo.session)===v.rev && status==="aguardando_confirmacao" && sessaoEhGasto(alvo)` — todas as 5 condições são obrigatórias; falha cai em `EXPENSE_BUTTON_STALE` (1725-1726), nunca em ação silenciosa. |
| `processarMensagemWhatsApp` | 2822-5848 | múltiplas (via sub-rotas) | Função única e enorme (~3000 linhas) que concentra: dedupe por `external_id` (2823-2872), opt-out (2880-2925), roteamento de ~30 estados de sessão em ordem de prioridade fixa. Rotas de leitura (consultas, faturas, limites, vencimentos) **antes** do parser de criação, documentado e confirmado no código (ex.: 4654-4725). |
| `iniciarLoteAudio` / `processarLoteAudio` | 6077-6184 | `gastos` (insert em loop) | Cada item do lote usa id determinístico `` `${sessao.id}:${i}` `` (linha 6168) — reenvio do "confirmar" não duplica itens já salvos; se `salvos.length < n` responde parcial sem perder os já gravados (6175-6179). |
| `sendWhatsAppRaw` | 5992-6065 | `whatsapp_outbound_log` (via import dinâmico) | Fail-closed se faltar token/phone-id/versão Graph (5996-6003). |

**Verificado (confirmações positivas):**
- Botões de gasto usam HMAC com `timingSafeEqual` e derivação HKDF (ver §3.1) — nenhuma falha encontrada.
- TTL de 30 minutos para sessões pendentes é real e aplicado em toda consulta de sessão ativa (`PENDING_TTL_MS`, `buscarSessaoAtiva`, `buscarSessaoComprovanteAtiva`).
- "Cancelar" durante ajuste de gasto (`AJUSTE_GASTO_STATES`) fecha a sessão corretamente (3367-3370).
- Double-click / corrida no botão "Confirmar" do gasto principal: o id determinístico usa `session:<sessao.id>` como `actionId` (linha ~5204, `persistirGasto(userId, sessao.session, msg.external_id, sessao.id)`), então duas submissões para a mesma sessão colidem no banco (`23505`) e a segunda reaproveita o `gastoId` existente — **não duplica**.

### 2.2 `src/server/expense-button-token.server.ts`

| Função | Linhas | Observação |
|---|---|---|
| `canon` / `expenseSessionRevision` | 20-30 | Hash canônico (chaves ordenadas) do `parsed` da sessão — qualquer alteração de sessão muda a `rev` e invalida botões antigos. |
| `key()` | 44-48 | Deriva subchave via `hkdfSync("sha256", master, "gi-expense", "gi-expense-button-v1", 32)`. Fail-closed: `master.length < 16` → `null` (nenhum botão assinado nem verificado). Reaproveita segredo `WHATSAPP_BOLETO_FINGERPRINT_SECRET` com domínio separado via `info="gi-expense-button-v1"` — mitiga reuso cruzado entre o HMAC de boleto e o de botão de gasto. |
| `mac` | 50-55 | `HMAC-SHA256("exp1|<ação>|<userId>|<telefone>|<rowId>|<rev>")`, truncado a 22 chars base64url (~132 bits) — amarra ação **e** identidade **e** linha **e** revisão. |
| `signExpenseButton` | 57-68 | Valida formato da `rev` (regex `^[A-Za-z0-9_-]{12}$`) antes de assinar. |
| `verifyExpenseButton` | 74-82 | Usa `timingSafeEqual` sobre buffers; checa `got.length !== want.length` antes (não é um "side channel" real porque o formato do token já fixa o tamanho via regex, mas é defesa em profundidade correta). |

**Conclusão de segurança (§3.1):** a implementação de HMAC está correta e não apresenta falha identificável no código lido. Nenhum ponto do pipeline aceita o botão sem recarregar a sessão do banco e revalidar `rowId`+`rev`+`status`+`tipo de sessão` — ou seja, o token por si só nunca basta para disparar a ação.

### 2.3 `src/server/whatsapp-financial-idempotency.server.ts`

`financialIdForWhatsAppMessage` (linhas 4-17): gera UUID v5-like determinístico via SHA-256 de `` `gasto-inteligente:whatsapp-financial:v1:${kind}:${userId}:${externalId}` ``. Correto: mesmo usuário + mesmo `externalId` + mesmo `kind` ⇒ mesmo id de linha, portanto reenvio do webhook da Meta (re-tentativa comum) não duplica gasto/receita. **Risco residual NÃO VERIFICADO:** se dois `kind` diferentes (`"expense"` vs `"income_single"`) puderem ser aplicados à mesma `externalId` em fluxos que mudam de intenção no meio da conversa, o id seria diferente (correto) — não encontrei caminho de código que reusasse o mesmo `externalId` para dois `kind`s diferentes, mas não revisei todos os call sites fora do escopo lido.

### 2.4 Cartões

- **`cartao-cadastro.server.ts`** (`criarCartaoViaWhatsApp`, linhas 70-150): reproduz manualmente as 8 verificações do site (vínculo ativo do número **para este `userId`**, linhas 83-92; feature flag `cartoes_basico` via RPC, 95-100; validação compartilhada `validarCartao`, 103; **idempotência** por `cartaoIdParaPedido(userId, requestKey)`, 85/106-116; **duplicidade por nome normalizado** via `encontrarCartaoDuplicado`, 118-120; tratamento de `23505` com fallback de leitura, 136-147). Isso cobre diretamente o pedido "cadastro de cartão duplicado" — a dedução por nome e por `requestKey` evita duas linhas para o mesmo cartão em reenvio/corrida.
- **`cartao-parcelamento.server.ts`**: `calcularParcelasCentavos` (61-79) distribui o resto de centavos nas primeiras parcelas e lança exceção se `totalCentavos < n`; `criarPlanoParcelamento` (126-177) faz *sanity check* explícito (`somaCent !== totalCentavos` lança erro, linhas 166-169) — **soma das parcelas sempre bate com o total**, sem perda de centavos.
- **`cartao-limite.server.ts`**: `getResumoLimiteCartao` (71-115) soma fatura atual + próxima fatura + parcelas futuras **estritamente posteriores** ao próximo ciclo, evitando dupla contagem (comentário e código condizentes, linhas 86-98).
- **`whatsapp-cartao-flow.ts`** (WhatsApp Flow nativo): nunca pede número do cartão/CVV/senha (texto fixo linha 33); resposta do Flow validada com Zod (`FlowResponse`, 150-157) e `parseCardFlowResponse` nunca lança (160-166).
- **`whatsapp-cartao-messages.ts`**: só textos, sem lógica de persistência — nenhum achado.

### 2.5 Fatura / competência / ciclo

- **`whatsapp-fatura-escolha.server.ts`** (`tratarEscolhaFatura`, 140-174): só atualiza um gasto quando a **última mensagem** desse telefone/usuário foi exatamente a pergunta de fatura (`buscarGastoPendente`, 98-133, checa `resposta_sugerida` contendo o texto exato da pergunta + janela de 2h + `cartao_id is null` + `fatura_competencia is null`); o `UPDATE` final exige `.is("fatura_competencia", null)` e confere `upd.length === 1` (158-166) — **não é possível** sobrescrever a competência de um gasto já resolvido ou de um gasto de outra conversa.
- **`whatsapp-cycle-resolver.server.ts`**: `resolveCycleForPlan` (87-96) cai para mês calendário de São Paulo quando o ciclo de billing é inválido, e retorna `source:"invalid"` como último fail-closed (94-95) — não há caminho que retorne um ciclo invertido (checado por `start.getTime() < end.getTime()`).
- **`whatsapp-mes-nomeado.ts`**: validação de ano (`year < 1970 || year > anoCorr + 50` → `ano_invalido`, linhas 154-157) impede both-way: ano absurdo não é silenciosamente aceito.

### 2.6 Consultas, memória curta e memória de categoria

- **`whatsapp-consultas.server.ts`**: todas as consultas (`handleResumoSemana`, `handleListarGastosMes`, etc.) usam `.eq("user_id", userId)` e `.is("deleted_at", null)` nas tabelas de origem (ex.: linhas 391-399, 405-413) — nenhuma consulta observada lê dado de outro usuário. `extractMetaTermo` (748-757) e `handleListarMetas` (762-845) replicam a mesma fórmula de progresso do site (`calcMetaProgresso`), evitando divergência de saldo "guardado" entre app e WhatsApp.
- **`whatsapp-short-context.server.ts`**: memória 100% em RAM (`Map`), nunca persiste PII, TTL de 5 min (lista/favorecido) e 24h (lembrete de conta — linha 65, justificado por cobrir a janela de 24h da Meta). Reinício do processo limpa tudo (`_resetShortContext`, 41-45) — **implicação**: em deploy/restart, atalhos como "pagar a segunda" deixam de funcionar até nova listagem; é um comportamento aceitável e documentado, não um bug de segurança.
- **`whatsapp-merchant-memory.server.ts`**: `merchantKeyFor` (90-123) rejeita entradas genéricas/curtas/numéricas antes de gerar chave; `lookupMerchantMemory` (160-196) **só** aplica categoria quando há ≥1 confirmação manual OU ≥2 confirmações, e retorna `ambiguous` (nunca decide arbitrariamente) quando mais de uma categoria é elegível (190-192) — reduz risco de categorização errada silenciosa.
- **`whatsapp-finance-brief.server.ts`**: janelas de comparação mês-a-mês (`equivalentMonthWindows`, 34-41) usam "até o mesmo dia" por padrão, evitando comparar mês corrente parcial com mês anterior completo (viés que infla "aumento de gastos"); exceção textual `fullMonths` quando o usuário pede explicitamente "mês inteiro" (verificado via `/\binteiro|completo\b/`, linha 128).

### 2.7 Edição de contas a pagar (`whatsapp-contas-editar.server.ts`)

- `detectEdicaoContaIntent` (437-544) é estrito por desenho: bloqueia termos de fatura/cartão (`hasBlocklistedTerm`, 428-435) para não confundir "editar fatura" com conta a pagar.
- `applyUpdate` (715-812): toda atualização de escopo único é condicionada a `status='pendente'` no próprio `UPDATE` (746-750) — impossível alterar conta já paga mesmo com corrida (o `WHERE` do banco garante atomicidade); escopo "esta e as próximas" usa `UPDATE ... WHERE recorrencia_id=X AND status='pendente' AND data_vencimento >= ref` (784-790), um único `UPDATE` atômico, não um laço de updates individuais — evita condição de corrida entre leitura e escrita.
- Claim de confirmação (`conta_edicao_persistindo`, 1185-1200): se a gravação da mensagem de confirmação colidir (`errorCode==="23505"`), a função retorna sem aplicar a alteração — proteção contra duplo clique.

---

## 3. Achados

### 3.1 [G-P0-1] Parser de valor trunca valores no formato BR "ponto de milhar sem vírgula" — perda financeira silenciosa

**Arquivo:** `src/lib/whatsappParser.ts:77-88` (`parseValor`), usado por `baseParseWhatsAppExpenseMessage` (`parseExpenseMessage`, importado em `whatsapp.server.ts:30`) em todo o fluxo de texto de gasto.

**Código:**
```
const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)/i;
...
if (raw.includes(",")) {
  raw = raw.replace(/\./g, "").replace(",", ".");
}
const n = Number(raw);
```

Quando o usuário digita um valor no formato brasileiro de milhar **sem vírgula decimal** (ex.: `1.950`, `2.500`), a branch `raw.includes(",")` é falsa, então o ponto **não é removido como separador de milhar** e `Number("1.950")` é avaliado como `1.95` (um ponto decimal, não um separador de milhar).

**Reprodução confirmada (Node, sandbox):**
```
parseValor("aluguel 1.950 pix")        -> 1.95   (esperado: 1950)
parseValor("Notebook 2.500 cartao")    -> 2.5    (esperado: 2500)
parseValor("Mercado 1.234,56")         -> 1234.56 (correto, tem vírgula)
```

**Impacto:** um gasto de R$ 1.950,00 é confirmado e salvo (`persistirGasto`) como R$ 1,95 — perda de ~99,9% do valor, sem qualquer alerta ao usuário (o resumo de confirmação mostra `formatBRL(1.95)` = "R$ 1,95", então o usuário vê o erro antes de confirmar **apenas se prestar atenção no valor**; não há validação cruzada). Isso é agravado pelo fato de a mesma classe de problema já ter sido corrigida em outro módulo do mesmo pipeline:

**Contraste (prova de que é corrigível):** `src/server/whatsapp-contas-editar.server.ts:404-417` (`parseAmountToCentavos`) trata exatamente esse caso:
```
} else if (/\.\d{3}/.test(raw)) {
  n = parseFloat(raw.replace(/\./g, ""));
} else {
  n = parseFloat(raw);
}
```
ou seja, o parser usado para **editar** o valor de uma conta a pagar já reconhece `\.\d{3}` como separador de milhar quando não há vírgula; o parser usado para **lançar** o gasto original (`whatsappParser.ts`) não tem essa branch.

**Quem é afetado:** qualquer gasto de texto livre cujo valor ultrapasse R$ 999 e seja digitado com ponto de milhar e sem centavos explícitos (`1.950`, `2.500`, `10.000` etc.) — um padrão de digitação plausível e comum em português. Também afeta `parseValorAjuste` (mesma função, reexportada como `parseValor` em `whatsapp.server.ts:33` e usada em "Ajustar valor", linha 3391-3402) — ou seja, mesmo o fluxo de correção manual do valor tem o mesmo bug.

**Severidade:** P0 — perda financeira real e silenciosa, sem exigir nenhuma ação maliciosa, apenas digitação normal do usuário.

---

### 3.2 [G-P1-1] "Confirmação de data futura" em edição de conta é código morto

**Arquivo:** `src/server/whatsapp-contas-editar.server.ts`

- `askFutureDateConfirm` definida em 694-700, **nunca chamada** em nenhum ponto do arquivo (confirmado via `grep`).
- `awaitingFutureDateConfirm` (campo de sessão, linha 78) é **lido** em 1156-1157 mas **nunca atribuído `true`** em nenhum lugar do arquivo.

Apenas o caso de data **passada** (`awaitingPastDateConfirm`, 1468-1484) de fato pergunta confirmação extra. O comentário do código e o nome da função sugerem que o comportamento pretendido era simétrico (confirmar tanto data futura distante quanto passada), mas a branch futura nunca é acionada — qualquer nova data futura é aceita direto na prévia final, sem o aviso extra que aparentemente foi planejado. Não é uma falha de segurança (a prévia final ainda exige "sim" explícito antes de gravar), mas é uma funcionalidade incompleta/morta que deveria ser removida ou implementada.

---

### 3.3 [G-P2-1] Divergência de comportamento de "não"/cancelamento entre o fluxo de gasto e o de edição de conta a pagar

- No fluxo principal de confirmação de gasto (`whatsapp.server.ts:5162-5202`), quando `decisao === "cancel"` (que inclui a palavra "não", ver `CANCEL_TOKENS`, linhas 914-927) a sessão **é cancelada** imediatamente.
- No fluxo de edição/cancelamento de conta a pagar (`whatsapp-contas-editar.server.ts:1163-1182`), a checagem de cancelamento "duro" (`isHardCancel`, linha 827) só dispara com as palavras literais `cancelar|cancela|cancelado|cancelada` (regex, linha 827). Se o usuário responder apenas "não" durante `conta_edicao_aguardando_confirmacao`, o código cai no bloco final (`if (decisao !== "confirm") { ... "Responda sim para confirmar ou cancelar para desistir" ... }`, linhas 1167-1181), que **não cancela** — apenas repete a pergunta. O próprio comentário no código ("qualquer outra resposta vira 'não entendi'", linha 1169 do contexto) indica que isso é intencional, não um bug de implementação, mas é uma inconsistência de UX/modelo mental entre dois fluxos do mesmo produto: o usuário que aprendeu que "não" cancela no fluxo de gasto pode ficar preso em loop no fluxo de edição de conta.

**Severidade:** P2 — inconsistência de UX documentada no próprio código como escolha deliberada; não é uma falha financeira nem de segurança, mas pode gerar confusão e sessões pendentes "presas" até o TTL expirar.

---

### 3.4 [NÃO VERIFICADO / HIPÓTESE] Valores "por extenso"

O parser de texto (`whatsappParser.ts`) e o parser de edição de conta (`whatsapp-contas-editar.server.ts`) só reconhecem dígitos — não há tratamento de números por extenso (ex.: "cento e vinte reais"). Isso não foi testado no módulo de áudio (`whatsapp-audio-lote.ts`, fora do escopo lido nesta rodada), que é o canal mais provável de receber valores por extenso (transcrição de voz). **NÃO VERIFICADO**: se `analisarGastoPorVoz` (importado de `./whatsapp-audio-lote`, linha 396 de `whatsapp.server.ts`) trata números por extenso antes de chamar o parser de texto. Caso não trate, o comportammento observável seria "Valor não identificado" (falha segura, sem perda financeira) e não um valor incorreto — mas isso é uma hipótese, não uma confirmação, pois o arquivo não foi lido.

---

## 4. Pontos fortes confirmados (não são achados, mas registro necessário para honestidade do anexo)

1. HMAC de botão de gasto: chave derivada por HKDF, comparação `timingSafeEqual`, binding a usuário+telefone+linha+revisão de conteúdo, fail-closed sem segredo (`expense-button-token.server.ts`, ver §3.1 do código, não confundir com achado 3.1 deste anexo).
2. Idempotência de gravação financeira por id determinístico (`whatsapp-financial-idempotency.server.ts`) usada tanto em gasto único, quanto em lote de áudio (`` `${sessao.id}:${i}` ``) e em receita (`financialIdForWhatsAppMessage(..., "income_single")`, confirmado por grep em `whatsapp-receitas.server.ts:496`).
3. TTL de sessão de 30 minutos real e aplicado de forma consistente (`PENDING_TTL_MS`, `whatsapp.server.ts:1369`).
4. Cálculo de parcelamento sem perda de centavos, com *sanity check* que lança exceção se a soma não bater (`cartao-parcelamento.server.ts:166-169`).
5. Cadastro de cartão com verificação de vínculo, feature flag, idempotência por `requestKey` e deduplicação por nome (`cartao-cadastro.server.ts`).
6. Escolha de fatura para cartão não cadastrado só altera a última pergunta pendente do próprio usuário, dentro de janela de 2h, com `UPDATE` condicionado a `fatura_competencia IS NULL` e checagem de `upd.length === 1` (`whatsapp-fatura-escolha.server.ts`).

---

## 5. Tabela de cobertura

| Arquivo | Linhas totais | Linhas lidas (integral/parcial) | Status |
|---|---:|---|---|
| `src/server/whatsapp.server.ts` | 6185 | 1-6185 | Integral |
| `src/server/expense-button-token.server.ts` | 88 | 1-88 | Integral |
| `src/server/whatsapp-financial-idempotency.server.ts` | 18 | 1-18 | Integral |
| `src/server/whatsapp-cartao-flow.ts` | 167 | 1-167 | Integral |
| `src/server/whatsapp-cartao-messages.ts` | 115 | 1-115 | Integral |
| `src/server/cartao-cadastro.server.ts` | 151 | 1-151 | Integral |
| `src/server/cartao-parcelamento.server.ts` | 182 | 1-182 | Integral |
| `src/server/cartao-limite.server.ts` | 146 | 1-146 | Integral |
| `src/server/whatsapp-fatura-escolha.server.ts` | 174 | 1-174 | Integral |
| `src/server/whatsapp-cycle-resolver.server.ts` | 97 | 1-97 | Integral |
| `src/server/whatsapp-mes-nomeado.ts` | 234 | 1-234 | Integral |
| `src/server/whatsapp-consultas.server.ts` | 1483 | 1-1483 | Integral |
| `src/server/whatsapp-short-context.server.ts` | 379 | 1-379 | Integral |
| `src/server/whatsapp-merchant-memory.server.ts` | 268 | 1-268 | Integral |
| `src/server/whatsapp-contas-editar.server.ts` | 1501 | 1-1501 | Integral |
| `src/server/whatsapp-finance-brief.server.ts` | 188 | 1-188 | Integral |
| `src/lib/whatsappParser.ts` | 410 | 1-410 | Integral (lido por ser a origem do achado 3.1) |
| `src/server/whatsapp-receitas.server.ts` | 702 | grep pontual (linhas 19, 496, 509) | Não lido (parcial via grep) |
| `src/server/whatsapp-parcelamento.server.ts` | 1383 | 0 | Não lido |
| `src/server/whatsapp-contas-criar.server.ts` | 1306 | 0 | Não lido |
| `src/server/whatsapp-contas-pagar.server.ts` | — | 0 | Não lido |
| `src/server/whatsapp-faturas.server.ts` | 1362 | 0 | Não lido |
| `src/server/whatsapp-limites.server.ts` | 439 | 0 | Não lido |
| `src/server/cartao-fatura.server.ts` | 802 | 0 | Não lido |
| `src/server/whatsapp-cartao-cadastro.server.ts` | 549 | 0 | Não lido |
| `src/server/whatsapp-comprovantes.server.ts` | — | 0 | Não lido |
| `src/server/contas-vencimento.server.ts` | — | 0 | Não lido |
| `src/server/whatsapp-audio-lote.ts` | — | 0 | Não lido |
| `src/server/whatsapp-pix-*.ts/.server.ts` | — | 0 | Não lido |
| `src/server/whatsapp-boleto-*.ts/.server.ts` | — | 0 | Não lido |
| `src/server/whatsapp-agenda.server.ts` | — | 0 | Não lido |

---

## 6. Lista de achados (IDs)

| ID | Severidade | Resumo | Evidência |
|---|---|---|---|
| G-P0-1 | P0 | Parser de valor trunca "1.950" → 1,95 (perda financeira silenciosa) | `src/lib/whatsappParser.ts:77-88`, reproduzido via execução Node |
| G-P1-1 | P1 | Código morto: confirmação de data futura em edição de conta nunca é acionada | `src/server/whatsapp-contas-editar.server.ts:694-700,78,1156-1157` |
| G-P2-1 | P2 | "Não" cancela no fluxo de gasto mas não no fluxo de edição de conta (inconsistência de UX documentada no código) | `src/server/whatsapp.server.ts:5162-5202` vs `src/server/whatsapp-contas-editar.server.ts:826-845,1163-1182` |
