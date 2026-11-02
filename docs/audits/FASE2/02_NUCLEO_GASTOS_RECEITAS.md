# FASE 2 — Pacote 2: Núcleo de gastos e receitas

> Gravado pelo agente principal a partir do relatório do revisor desta área (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`). Texto do revisor preservado abaixo; correções do consolidador vêm primeiro.

## Notas do consolidador

- **G2-P0-1 confirmado pelo consolidador.** `whatsapp-comprovantes.server.ts:280-293` é uma cópia local de `parseValor` com o bug de milhar: "1.950" vira 1,95. Usado nas linhas 766, 1205 e 1264, na correção manual do valor do comprovante. **É o P0 aberto desta rodada.**
- **`whatsapp.server.ts` (6.185 linhas) NÃO foi relido** por este revisor. Continua PARCIAL.
- **As 73 falhas citadas são do modo de execução**, não regressões. O revisor rodou arquivos isolados, sem a preparação comum dos testes. Na execução oficial desta rodada, `node scripts/test-whatsapp.mjs` deu 164 arquivos, 2.851 aprovados, 0 falhas.
- O arquivo `whatsapp-comprovantes.server.ts` foi lido também pelo pacote 4.

---

# Anexo — Auditoria Pacote 2: Núcleo Gastos/Receitas (Parcelamento, Receitas, Consultas Específicas, Planejamento, Pós-lançamento, Interativos, Voz)

HEAD: `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`. Builds/typecheck não executados manualmente (gerenciados pelo harness). Sem chamadas de rede/DB. Testes rodados via `bun test` local.

## 1. Cobertura por arquivo

| Arquivo | Linhas (wc -l) | Intervalos lidos | % | Status |
|---|---|---|---|---|
| `src/server/whatsapp-interactive.server.ts` | 538 | 1-538 | 100% | INTEGRAL |
| `src/server/whatsapp-parcelamento.server.ts` | 1383 | 1-1383 | 100% | INTEGRAL |
| `src/server/whatsapp-receitas.server.ts` | 702 | 1-702 | 100% | INTEGRAL |
| `src/server/whatsapp-consultas-especificas.server.ts` | 634 | 1-634 | 100% | INTEGRAL |
| `src/server/whatsapp-planning.server.ts` | 418 | 1-418 | 100% | INTEGRAL |
| `src/server/whatsapp-postlaunch.server.ts` | 362 | 1-362 | 100% | INTEGRAL |
| `src/server/whatsapp-voice-number-normalizer.server.ts` | 436 | 1-436 | 100% | INTEGRAL |
| `src/server/whatsapp-comprovantes.server.ts` | 1565 | 1-1565 | 100% | INTEGRAL |
| `src/server/expense-button-token.server.ts` | 88 | 1-88 | 100% | INTEGRAL (revalidado, consistente com anexo-1) |
| `src/lib/whatsappParser.ts` | 418 | 1-418 | 100% | INTEGRAL (revalidado, consistente com anexo-1) |
| `src/server/whatsapp.server.ts` | 6185 | — | 0% nesta rodada | NÃO RELIDO — já íntegro no Anexo 1; fatos reaproveitados sem nova verificação de linha |

Observação de honestidade: `whatsapp.server.ts` não foi relido linha a linha nesta rodada porque o Pacote 2 delimitou o foco nos módulos satélites; qualquer afirmação aqui sobre esse arquivo é **reaproveitada do Anexo 1** e citada como tal, não reverificada.

---

## 2. Inventário por arquivo

### 2.1 `whatsapp-comprovantes.server.ts` (1565 linhas)
- `parseValor` (L280-293): parser local de valor para correção manual durante o fluxo de OCR de comprovante. **Defeito confirmado (ver §3)**.
- `processarNovaImagem` (L975-1036): cria sessão a partir do OCR; nunca grava gasto sem confirmação; filtra campos faltantes (valor/descrição) antes do resumo.
- `persistirGastoComprovante` (L861-965): fail-closed sem `externalMessageId` (L867-871); gate de quota antes do insert (L872-879); id determinístico `financialIdForWhatsAppMessage(userId, externalMessageId, "expense_receipt")` (L892); trata `23505` sem segunda leitura de verificação de dono (ver §3 achado P1); grava `origem: "whatsapp"`, `confirmado: true`.
- `avancarAposConfirmacao` (L1043-1091): categoria obrigatória → confirmação de data → forma de pagamento → persistência, cada etapa com estado pendente próprio; nunca pula etapa.
- `processarRespostaImagem` (L1184-1426): roteia por `status`; usa `parseValor` local (bug) em 3 pontos (`detectAjuste` direto L766, `img_aguardando_ajuste` L1205, `img_aguardando_valor` L1264).
- `carregarCategoriasDespesa` (L357-368) e `loadCategoriaHistory` (L468-504): sempre `eq("user_id", userId)`; histórico usa `gastos` com `.is("deleted_at", null)` (L477) — exclui soft-deleted corretamente.
- Export compartilhado do picker de categoria (`buildCategoriaListBody`, `resolveCategoriaPickerInput`, `loadCategoriasParaPicker`, L1493-1564) reaproveitado por parcelamento — nenhuma duplicação de lógica de categoria.
- Testes associados: `whatsapp-comprovantes.test.ts`, `whatsapp-comprovante-categoria-manual.test.ts`, `whatsapp-comprovante-data-2026-10-12.test.ts` — **não executáveis no sandbox** (dependem de OCR externo; ver §4).

### 2.2 `whatsapp-parcelamento.server.ts` (1383 linhas)
- `detectInstallmentIntent` (L193-227): só aceita dígitos explícitos; bloqueia "dia X vence" (L199); exige pista de cartão para `Nx` solto (L220-226) — evita falso positivo.
- `extrairValor` (L304-367): parser de valor correto para formato BR, incluindo milhar sem vírgula ("1.200"→1200) — **testado e confirmado correto** (§3).
- `persistir` (L1051-1381): claim atômico em `whatsapp_messages` antes da RPC (L1150-1171, índice único em `external_id` evita corrida); quota financeira entre claim e RPC (L1180-1199); RPC `create_installment_purchase` SECURITY DEFINER (L1219-1230); readback obrigatório confere `rbRows.length === plano.totalParcelas` e `categoriaMismatch` (L1265-1310) antes de responder sucesso — aborta com mensagem clara se a leitura pós-insert não bater.
- Precedência de categoria manual "hardened" (L1093-1124): só aceita `manualCategoriaId` quando `categorySelectionSource==="manual"` **e** a categoria ainda existe (`cats.some`) — nunca cai silenciosamente em sugestão automática.
- Dependências injetadas via `WhatsAppParcelamentoDeps` (sem import direto de `whatsapp.server.ts`) — evita ciclo e facilita teste/mocking.
- Testes: `whatsapp-parcelamento*.test.ts`, `parcelamento-centavos.test.ts` — não executáveis neste sandbox (falha por ausência de API key de OCR em import compartilhado via `whatsapp-comprovantes.server.ts`; ver §4), portanto **NÃO TESTADO** nesta rodada apesar de existirem.

### 2.3 `whatsapp-receitas.server.ts` (702 linhas)
- `parseValor` (L164-193): parser de valor local, com suporte explícito a milhar BR (`brGrouped`, L172-178) — **testado e confirmado correto**, ao contrário do que a tarefa supunha.
- `isReceitaIntent` (L128-137): bloqueia por `GASTO_HINT_PATTERNS` antes de aceitar keyword de receita — evita "paguei... recebi o troco" virar receita indevidamente (mitigação razoável, mas dependente de regex simples — risco residual de frases compostas; SUSPEITO, não testado com corpus adicional).
- `persistirReceita` (L357-531): fail-closed sem `externalMessageId` (L365-369); quota ANTES da escrita (L387-394); teto `validateFinancialAmount` (L402-404); recorrente via RPC `whatsapp_create_recurring_income_once` com **readback duplo** (`receitas`+`recorrencias`, L441-480) confirmando `recorrencia_id` cruzado e `status==="ativa"`; única via insert com id determinístico e tratamento de `23505` revalidando `user_id`+`origem==="whatsapp"` (L509-525) — mesmo padrão de proteção do `persistirGasto` do Anexo 1.
- `contarReceitasMesAtual` (L327-336): `.is("deleted_at", null)` aplicado — quota não conta receitas soft-deleted.
- Testes: `whatsapp-receitas.test.ts`, `whatsapp-receita-recorrencia-rpc.test.ts`, `receitas-soft-delete-e-teto-valor.test.ts` — não executados por falha de ambiente comum a toda a suíte (§4).

### 2.4 `whatsapp-consultas-especificas.server.ts` (634 linhas)
- Todas as leituras (`loadGastos` L237-245, `loadReceitas` L247-260, `loadCategoriasDespesa` L270-273) filtram `eq("user_id", userId)`; gastos/receitas aplicam `.is("deleted_at", null)` — leituras nunca vazam linhas soft-deleted nem de outro usuário.
- `detectConsultaEspecifica` (L68-150): âncoras amplas mas com proteção dupla contra falso positivo de lançamento (ex.: "gastei hoje 30 no mercado" exige ausência de dígito, L85-93) — boa discriminação consulta-vs-lançamento.
- `handleGastoPorDescricaoOuCategoria` (L502-543): quando termo bate em categoria E em descrição simultaneamente, pergunta ao usuário (ambiguidade explícita, L513-522) em vez de escolher arbitrariamente — correto; porém faz **duas leituras separadas de `loadGastos`** para a mesma janela (L511 dentro de `hasDescription` e L551 dentro de `respostaCategoriaGrupo`/`respostaDescricao`) — ineficiência sem impacto funcional (P2).
- `agruparCategorias` (L347-363): agrupa por nome normalizado+singularizado — protege contra duplicata visual de categoria, mas pode agrupar indevidamente categorias de nomes parecidos mas semanticamente distintos (ex. "Saúde" vs "Saúde Animal" normalizados diferentes, ok); risco baixo.
- Sem testes dedicados localizados no diretório `tests/` com esse nome exato — **lacuna de cobertura automatizada** (§5).

### 2.5 `whatsapp-planning.server.ts` (418 linhas)
- `parseMoney` (L25-33): parser de valor com suporte a milhar BR e multiplicador "mil/milhão" — **testado e confirmado correto** (mesmo padrão positivo do `extrairValor` de parcelamento).
- `allowed()` (L117-119) usa RPC `has_feature_access` por feature/plano antes de qualquer escrita — gate de plano centralizado no banco.
- `findEntities` (L121-128) sempre `eq("user_id", userId)`; "ativa" filtra recorrências `status not in (cancelada, excluida)`.
- `handlePlanning` fluxo de rascunho (`whatsapp_planning_actions`) com `expires_at` e estados `draft/ready/applied/cancelled`; RPC `whatsapp_apply_planning_action` final (L307) — aplica mudança com checagem de concorrência via `result?.status`.
- `goalSummary`/`recurrenceSummary`/`cardLimitSummary`: somatórias e "mais perto"/"mais cara" sempre com `eq("user_id", userId)`.
- Testes: `whatsapp-1_3-planning.test.ts` — não executado nesta rodada (ambiente, §4).

### 2.6 `whatsapp-postlaunch.server.ts` (362 linhas)
- `checkUndoSoftDelete` (L68-78): lê `gastos` **sem** filtrar `deleted_at` de propósito (soft-delete-exceção documentada) para recusar "Desfazer" sobre linha já excluída — proteção contra DELETE físico duplo.
- `readFinancial` (L47-53): sempre filtra `eq("user_id")`, `eq("origem","whatsapp")`, `.is("deleted_at", null)`.
- `postlaunchReceipt` (L114-145): recusa gerar recibo/editar quando o gasto já é parcelado ou recorrente (L124-126) — evita abrir atalho de edição simples sobre entidade composta.
- Lookup de edição em andamento sem token (L250-256): janela de **60 minutos** (`created_at >= now-1h`) — **maior que o `PENDING_TTL_MS` de 30 min do fluxo principal** documentado no Anexo 1. Potencial inconsistência de UX/segurança de sessão (§3, P1).
- `handlePostlaunchInput`: token HMAC-livre, é apenas `TOKEN` regex `wa12_...:<uuid>:<campo?>` validado por posse de linha em `whatsapp_recent_actions` filtrada por `user_id`+`telefone` (L31-35) — sem assinatura HMAC como no `expense-button-token.server.ts`; a autenticação depende inteiramente de `user_id` (derivado da sessão autenticada do telefone) e do UUID ser imprevisível. Diferente do padrão HMAC do Anexo 1 — **inconsistência de padrão de segurança entre módulos** (§3, P1, SUSPEITO — não há evidência de exploração, mas о desenho diverge do golden-standard do próprio sistema).
- Testes: `whatsapp-1_2-postlaunch.test.ts` — não executado (§4).

### 2.7 `whatsapp-interactive.server.ts` (538 linhas)
- `replyIdToTexto` (L213-233): converte todo ID de botão para o MESMO texto que o pipeline textual entenderia — garante paridade botão=texto (princípio declarado e cumprido).
- `buildInteractiveFromReply` (L245-267): ao detectar botão de gasto legado (`expense_confirm` etc.), **exige** `bind` (vínculo HMAC) para assinar; sem vínculo retorna `null` e o webhook cai no texto puro — fail-closed correto, consistente com Anexo 1.
- `expenseTokenToTexto`/`verifyExpenseButton` não são chamados aqui — a validação completa acontece no pipeline (`whatsapp.server.ts`, já coberto no Anexo 1).
- Sem testes dedicados localizados — comportamento validado indiretamente pelos testes de parcelamento/comprovante que usam listas/botões.

### 2.8 `whatsapp-voice-number-normalizer.server.ts` (436 linhas)
- `normalizeVoiceMoney`: só converte números por extenso/dígito quando há gatilho monetário explícito adjacente (`real/reais/centavo/centavos` ou `R$`, L352-378); blockers à esquerda/direita (`dia`, `cartão`, `parcela`, `horas`, L256-277) evitam falso positivo. Não persiste nada (comentário L10-12, código consistente). Testado com sucesso nesta rodada (15/15 passando).

### 2.9 `expense-button-token.server.ts` / `src/lib/whatsappParser.ts`
Revalidados (não divergem do Anexo 1): HMAC com HKDF, `timingSafeEqual`, fail-closed sem segredo (`key()` L44-47); `parseValor` do lib (L77-96) **correto** para "1.950" → 1950 (confirmado por execução).

---

## 3. Achados

| ID | Severidade | Confiança | Local | Descrição | Reprodução (dados fictícios) | Sugestão |
|---|---|---|---|---|---|---|
| **G2-P0-1** | **P0** | **CONFIRMADO** | `src/server/whatsapp-comprovantes.server.ts:280-293` (usado em L766, L1205, L1264) | `parseValor` local do fluxo de comprovante trunca valores BR com separador de milhar e SEM vírgula decimal: "1.950" → 1,95; "12.500" → 12,5. Mesmo bug de classe já corrigido no `src/lib/whatsappParser.ts` (Anexo 1, G-P0-1), mas **não corrigido nesta cópia paralela**. Afeta: (a) correção manual de valor após leitura de OCR ("valor 1.950"); (b) resposta direta "valor 1.950" durante ajuste do resumo do comprovante. | Usuário fotografa nota fiscal, OCR não lê o valor; bot pergunta "qual o valor?"; usuário digita "1.950" (mil novecentos e cinquenta reais); sistema grava gasto de R$ 1,95. Comando reproduzido: `parseValor("1.950")` com a função extraída literalmente do arquivo → retorna `1.95`. | Substituir a implementação local por `parseValor` de `src/lib/whatsappParser.ts` (já corrigido) ou aplicar a mesma lógica de detecção de grupo de milhar (`^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$`) antes do fallback genérico. |
| **G2-P1-1** | P1 | SUSPEITO | `src/server/whatsapp-postlaunch.server.ts:250-256` vs. `PENDING_TTL_MS=30min` (Anexo 1, `whatsapp.server.ts:1369`) | A janela de "edição em andamento sem token" do pós-lançamento usa 60 minutos, o dobro do TTL de sessão do fluxo principal de gasto/receita. Em tese, uma mensagem livre do usuário mandada entre 30 e 60 min após iniciar uma edição de recibo pode ainda ser interceptada por esse fluxo de edição "esquecido", em vez de iniciar um lançamento novo — comportamento não verificado ponta-a-ponta nesta rodada (não há teste de integração cobrindo esse cenário específico de limite de tempo). | Usuário edita um gasto pelo recibo ("Editar" → escolhe "Valor"), não responde; 40 minutos depois manda "Uber 25 pix" pretendendo lançar um gasto novo; se a mensagem casar com `fieldFromText`("uber 25 pix") → nenhum campo reconhecido → cai em `fieldMenu` em vez de iniciar o parser de gasto (necessita teste dirigido para confirmar). | Unificar a janela de TTL de ações pendentes (30 min) com o padrão do fluxo principal, ou documentar explicitamente a divergência intencional. |
| **G2-P1-2** | P1 | SUSPEITO | `src/server/whatsapp-postlaunch.server.ts:31-35`, `244-249` | Os tokens `wa12_*` (editar/desfazer recibo) não usam HMAC como os tokens `exp1:` de gasto (Anexo 1, `expense-button-token.server.ts`) nem revisão de conteúdo (`rev`). A proteção depende só de (a) `user_id` da sessão autenticada do telefone e (b) o `id` ser um UUID aleatório não adivinhável, validado por `eq("user_id", userId).eq("telefone", phone)`. Isso é discutivelmente seguro (mesmo padrão de "capability URL"), mas é uma divergência de padrão de segurança em relação ao módulo irmão, sem explicação documentada no código sobre por que o HMAC não é necessário aqui. | Não há exploração demonstrável (exigiria vazamento do UUID da ação, que não trafega fora do WhatsApp); achado é de **consistência de padrão**, não de vulnerabilidade confirmada. | Documentar a decisão de design (UUID como capability) ou unificar com HMAC como no fluxo de gasto, por defesa em profundidade. |
| **G2-P2-1** | P2 | CONFIRMADO | `src/server/whatsapp-consultas-especificas.server.ts:502-543` | `handleGastoPorDescricaoOuCategoria` executa `loadGastos` duas vezes para a mesma janela de datas quando há match de categoria (uma vez dentro do cálculo de `hasDescription`, outra dentro de `respostaCategoriaGrupo`/`respostaDescricao`) — leitura redundante, sem impacto de correção, apenas custo. | — | Reaproveitar o resultado de `loadGastos` já carregado em `hasDescription` nas chamadas subsequentes. |
| **G2-P2-2** | P2 | NÃO TESTADO | `src/server/whatsapp-receitas.server.ts:128-137` | `isReceitaIntent` usa uma lista fixa de `GASTO_HINT_PATTERNS` (gastei/paguei/comprei/debitou) para bloquear falso-positivo de receita; frases compostas não cobertas por essas 4 palavras (ex.: "estornaram o valor que paguei errado") poderiam, em tese, ser mal classificadas. Não foi construído um corpus de teste para confirmar taxa de erro real. | — | Ampliar corpus de testes de `isReceitaIntent` com frases compostas gasto+estorno. |

Confirmação explícita (positivo) desta rodada: `extrairValor` (parcelamento), `parseValor` (receitas) e `parseMoney` (planning) **tratam corretamente** o formato de milhar BR sem vírgula — ao contrário da hipótese inicial da tarefa, o bug do Anexo 1 (G-P0-1) **não se repete** nesses três parsers; ele se repete apenas em `whatsapp-comprovantes.server.ts` (G2-P0-1, novo).

---

## 4. Testes rodados (números exatos)

Comando: `bun test <arquivos>` (18 arquivos de teste relacionados a parcelamento/receitas/comprovantes/postlaunch/planning/voz).

Resultado agregado reportado pelo runner: **73 testes falharam** nos arquivos de `whatsapp-comprovantes*`, `whatsapp-parcelamento*`, `whatsapp-receitas*`, `whatsapp-1_2-postlaunch`, `whatsapp-1_3-planning`. Causa raiz identificada na primeira falha inspecionada (`whatsapp-comprovantes.test.ts`): evento de log `wa_boleto_media_ocr_failed reason: "missing_api_key"` — o OCR/IA externo não está disponível no sandbox (sem rede, conforme regra de auditoria), e os testes desses módulos dependem de um mock de extrator que não foi ativado nesta execução isolada (os testes provavelmente dependem de setup global de outros arquivos de teste/ambiente não incluído na lista executada). **Classificação: falha de ambiente/infraestrutura do sandbox de auditoria, não falha de regressão confirmada do código.**

Testes que **passaram integralmente** (sem dependência de OCR externo):
- `whatsapp-voice-number-normalizer.test.ts`: **15/15 passaram**.
- `whatsapp-voice-category-suggestion.test.ts`: **10/10 passaram**.
- `whatsapp-voice-description-cleanup.test.ts`: **8/8 passaram**.
- Parte de `whatsapp-receitas-consulta-listar.test.ts` (log mostra pelo menos 1 `(pass)` antes do corte de saída: "Confirmação mostra 'Tipo de receita'").

Testes reproduzidos manualmente fora do runner (via `bun -e`, isolando a função do arquivo fonte, sem mock):
- `whatsapp.server`-lib `parseValor("aluguel 1.950 pix")` → `1950` (correto).
- `whatsapp-receitas.server.ts parseValor("recebi 1.950 de salario")` → `1950` (correto); `"4 mil"` → `4000` (correto).
- `whatsapp-comprovantes.server.ts parseValor("1.950")` → `1.95` (**bug confirmado**, G2-P0-1); `"12.500"` → `12.5` (**bug confirmado**).
- `whatsapp-parcelamento.server.ts extrairValor("Comprei um tenis de 1.950 em 3x no Nubank")` → `1950` (correto).

**Não foi possível** rodar os 18 arquivos de teste com sucesso completo nesta sessão porque dependem de infraestrutura de mock/API não disponível isoladamente; não foi feita nenhuma chamada de rede real para contornar isso (proibido pelo escopo).

---

## 5. Lacunas

1. `whatsapp.server.ts` (6185 linhas) não foi relido nesta rodada — qualquer interação específica entre os módulos deste pacote e o roteador principal (ordem de prioridade de rotas, chamada exata de `handlePostlaunchInput`/`handlePlanning`/`processarParcelamento`/`processarRespostaImagem`) foi **assumida** com base no Anexo 1 e nos próprios arquivos satélites, sem reverificação de linha do ponto de chamada.
2. Suíte de testes dos módulos financeiros centrais (comprovantes, parcelamento, receitas, postlaunch, planning) não pôde ser executada com sucesso no sandbox por ausência de mock/API de OCR — os 73 "fails" relatados **não foram individualmente auditados linha a linha** para confirmar que são 100% infraestrutura e não regressões reais; a amostra inspecionada (primeira falha) indicou causa de ambiente, mas isso não foi confirmado para os 73 casos.
3. `whatsapp-consultas-especificas.server.ts` e `whatsapp-interactive.server.ts` não possuem arquivos de teste dedicados localizados no diretório `tests/` — cobertura automatizada declarada como ausente, não verificada por execução.
4. G2-P1-1 (janela de 60 min do postlaunch vs. 30 min do fluxo principal) é uma observação estrutural; não foi construído um teste de integração reproduzindo exatamente a colisão de intenção entre os dois fluxos — fica como **SUSPEITO**, não confirmado.

