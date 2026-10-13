# Auditoria do WhatsApp — Gasto Inteligente — 13/10/2026

**Status deste documento: AUDITORIA PARCIAL.** Não é uma certificação "linha por linha" de 100% do código. A cobertura real está no §2 e no `anexo-0-cobertura.md`.

| Item | Valor |
|---|---|
| Commit auditado | `32baac8bc973d7a131d8615f3ee8e5566d30a088` (anexos 1–5 gravados depois, em `80cfeb99…`) |
| Modo | somente diagnóstico. Nenhuma alteração em código do app, banco, migrações, segredos, flags, Meta ou cron. Nada publicado. Nenhum WhatsApp enviado, nenhuma chamada SerpApi ou IA real |
| Acesso ao banco real | só **metadados de catálogo** (funções, RLS, grants, colunas, índices). Nenhuma linha de usuário lida |

## Anexos (bibliografia interna)

| Anexo | Área |
|---|---|
| `anexo-0-cobertura.md` | Reconciliação de cobertura por arquivo (gerada por script a partir dos anexos 1–5) |
| `anexo-1-webhook-identidade.md` | Webhook Meta, assinatura, payload, dedupe, identidade, plano, vínculo, consentimento, envio/fallback, status callbacks, rate limit, logs |
| `anexo-2-gastos-receitas-cartoes.md` | Gastos texto/áudio, botões assinados, sessão, receitas, cartões, faturas, edição de contas |
| `anexo-3-comprovantes-audio.md` | Fotos, PDF, NFC-e, boletos, datas, confirmação, áudio/Whisper |
| `anexo-4-agenda-contas-softdelete.md` | Agenda, lembretes, notificações, contas, Pix, extrato, estorno, desfazer, soft-delete |
| `anexo-5-compras.md` | Assistente de Compras (SerpApi), cota, contexto, orçamento, pesquisa legada |
| `anexo-6-sql-seguranca-testes.md` | SQL versionado × candidato × banco real, RLS/grants/DEFINER, SQL local, SSRF, lacunas de teste |
| `_inventario_src.txt` | Inventário de 111 arquivos fonte (46.557 linhas) |

---

## 1. Sumário executivo

1. **Um defeito financeiro grave foi confirmado (G-P0-1).** Um valor digitado com ponto de milhar e sem centavos é lido mil vezes menor.
   - "Mercado 1.950" vira **R$ 1,95**; "Aluguel 1.500" vira **R$ 1,50**; "R$ 2.000" vira **R$ 2,00**.
   - Reproduzido no fluxo principal simulado: `processarMensagemWhatsApp` monta a confirmação com "• Valor: R$ 1,95".
   - Mitigação existente: o gasto só é salvo depois de "confirmar", e o valor aparece na tela antes. Se o usuário confirmar sem ler, o gasto fica errado no banco.
   - É o item mais urgente.
2. **A reversão de extrato não é atômica** (A-P1-01, rebaixado de P0 no anexo 4 após releitura). Ela apaga tabela por tabela; uma falha no meio deixa o lote pela metade e o status sem atualizar.
   - A correção atômica (`reverter_extrato_atomic`) existe só como candidata. Pelo catálogo, ela **não existe no banco real**.
   - Rodar a reversão de novo conclui o trabalho, então não há perda definitiva, mas há inconsistência temporária.
3. **Identidade e autorização estão corretas nos pontos lidos.** Assinatura Meta com HMAC (`public.whatsapp.expense.ts:162-173`); vínculo, consentimento e plano conferidos **antes** de qualquer download, OCR ou transcrição (anexo 1 §4). Nenhum P0 de segurança foi encontrado.
4. **Banco real (metadados):**
   - todas as funções `whatsapp_*` são executáveis só por service_role;
   - nenhuma função SECURITY DEFINER está sem `search_path`;
   - `gastos.deleted_at` existe (hotfix);
   - as funções de Compras existem, mas **não estão versionadas** no repositório (Q-P1-01);
   - as funções F2/F4 e o desfazer com soft-delete **não estão aplicados**.
5. **Testes:** 162 arquivos e 2.820 testes do WhatsApp, 0 falhas; verificação de tipos e build OK; 82 testes SQL locais, 0 falhas. Tudo com mocks e stubs: **nenhum teste prova a qualidade real de OCR, transcrição, SerpApi ou entrega Meta** (C-P1-01).
6. **Cobertura de leitura:** 31,2% das linhas do inventário com leitura integral **autodeclarada**, 22,5% parcial e **46,4% não lidas** (27,8% declaradas não lidas e 18,6% sem nenhum anexo). Há um plano de fase 2 no §7.

---

## 2. Cobertura real (reconciliada — `anexo-0-cobertura.md`)

| Status | Arquivos | Linhas | % das 46.557 |
|---|---:|---:|---:|
| Integral (autodeclarado pelo revisor) | 70 | 14.511 | 31,2% |
| Parcial | 5 | 10.457 | 22,5% |
| Não lido (declarado) | 18 | 12.930 | 27,8% |
| Sem anexo | 18 | 8.659 | 18,6% |

Regras da reconciliação:
- Quando anexos divergem, vale o status **mais baixo**. Exemplo: `whatsapp.server.ts` (6.185 linhas) foi declarado integral no anexo 2, mas outro anexo o marca parcial, então conta como **parcial**.
- `whatsapp-pagar-pessoa-flow.server.ts` (1.788 linhas) teve só as linhas 1–250 lidas linha a linha (anexo 4 §7.3).
- "Integral" não foi provado de forma independente.

SQL fica fora desse total. Das 183 + 8 migrações, só 3 arquivos foram lidos de forma estruturada; os objetos do banco foram conferidos pelo catálogo (anexo 6 §1–2).

---

## 3. Tabela única de achados

Legenda de status:
- **CONFIRMADO**: lido no código e, quando indicado, reproduzido localmente;
- **HIPÓTESE**: plausível, não provado;
- **NÃO VERIFICADO**: não lido ou sem acesso.

### 3.1 P0

| ID | Status | Arquivo:linhas | Defeito | Impacto | Reprodução local | Correção proposta | Migração? |
|---|---|---|---|---|---|---|---|
| **G-P0-1** | **CONFIRMADO + reproduzido** | `src/lib/whatsappParser.ts:77-88` (`parseValor`), usado em `whatsappParser.ts:355` (`parseWhatsAppExpenseMessage`) → `whatsapp.server.ts:30` | A regex aceita `1.950` como milhar, mas o ramo só remove pontos quando há vírgula; sem vírgula, `Number("1.950") = 1.95` | Valor 1.000× menor na confirmação; salvo errado se o usuário confirmar. Também afeta outros pontos de leitura de valor (`whatsapp-comprovantes.server.ts:766,1205,1264`, `whatsapp-receitas.server.ts:558,627`, `whatsapp-postlaunch.server.ts:197`), por herança da mesma função: **NÃO VERIFICADO caso a caso** | `bun` com `parseValor("Mercado 1.950")` → 1.95; `"R$ 2.000"` → 2; `"1.950,00"` → 1950. No fluxo principal simulado (`_whatsapp-fake`): texto "Mercado 1.950 hoje no pix" → sessão `valor: 1.95`, resposta "• Valor: R$ 1,95". Em comparação, `extrairValor` (`whatsapp-parcelamento.server.ts:314`) devolve 1950 corretamente | Sem vírgula e com grupos `\.\d{3}` exatos → remover pontos. Teste T1 (anexo 6 §5) | Não |

Nenhum P0 de segurança, autenticação ou vazamento foi confirmado (anexo 1 "Resumo").

### 3.2 P1

| ID | Status | Arquivo:linhas | Resumo | Correção | Migração? |
|---|---|---|---|---|---|
| A-P1-01 (ex-P0, anexo 4 §8.2) | CONFIRMADO (código) / NÃO EXECUTADO em falha simulada | `src/lib/store.ts:4861-4950` (`revertExtratoImportadoSeguro`), `4955+` (`revertExtratoImportado`) | DELETE sequencial em 5 tabelas fora de transação; um erro no meio retorna falha sem desfazer o que já foi apagado; o status só é atualizado no fim. O fluxo é do site, não do WhatsApp. Uma nova reversão conclui o que faltou | Aplicar a candidata F4 `reverter_extrato_atomic` (testada localmente, 15/15) | Sim (candidata pronta) |
| A-P1-02 | CONFIRMADO, código morto | `src/server/whatsapp-pix-intents.server.ts:478` (`valor: parsed.valorCentavos`); chamado só como `void handlePagarPessoaIntent;` em `whatsapp.server.ts:5670` | Grava centavos como reais (100×). Não é chamado hoje | Remover ou converter com `centavosParaReais` | Não |
| Q-P1-01 | CONFIRMADO (catálogo × repositório) | `docs/migrations-candidate/whatsapp-shopping-quota.sql` | SQL de Compras aplicado no banco real, mas não versionado | Versionar como migração idempotente | Sim (aditiva) |
| W1-P1-01 | HIPÓTESE, rebaixar para P2 | `public.whatsapp.expense.ts:796-812` | `gate.duplicate` não interrompe o processamento. Para gravação financeira, o índice único `whatsapp_messages.external_id` (confirmado no catálogo) e o id determinístico do gasto barram duplicata. O risco que sobra é **custo** (OCR ou transcrição repetidos em reentregas simultâneas), não dado duplicado | Teste T4; se houver custo real, reservar o WAMID antes da mídia | Não |
| W1-P1-02 | NÃO VERIFICADO | `whatsapp-link-verification.server.ts` | Sem limite de tentativas visível na aplicação para o código de vínculo; depende da função SQL (não lida) | Ler `whatsapp_complete_link_verification` na fase 2 | ? |
| W1-P1-03 | CONFIRMADO (desenho) | `whatsapp-runtime-config.server.ts` | `updateRuntimeConfig` não confere Admin Master internamente; depende de quem chama | Checagem interna | Não |
| W1-P1-04 | Observação | anexo 1 §20 | Toda a autorização do WhatsApp roda em service_role; o RLS não é rede de segurança nesse caminho | — | — |
| G-P1-1 | CONFIRMADO | `whatsapp-contas-editar.server.ts:694-700,78,1156-1157` | Confirmação de data futura na edição de conta nunca é acionada (código morto) | Ligar ou remover | Não |
| C-P1-01 | CONFIRMADO | anexo 3 §2 | Nenhum teste usa IA real; a qualidade de OCR e transcrição só é provada com teste manual | Roteiro de E2E real (§6) | Não |
| C-P1-02 | CONFIRMADO | `public.whatsapp.expense.ts:437-465` | Download de mídia sem timeout e sem leitura em streaming | `AbortController` + leitura com limite | Não |
| C-P1-03 | NÃO LIDO | `whatsapp-boleto-intents.server.ts` (1.479 linhas) | Lógica de confirmação de boleto não auditada | Fase 2 | — |
| C-P1-04 | CONFIRMADO | `whatsapp-transcription.server.ts:78` | Transcrição sem timeout | `AbortController` | Não |
| C-P1-05 | Lacuna de teste | anexo 3 §11.2 | Lote de áudio pendente + áudio "confirmar" sem teste | Teste T7 | Não |
| A-P1-03 | CONFIRMADO | `agenda-confirm-token.server.ts` | Token de cancelamento da Agenda usa o segredo do boleto; rotacionar esse segredo invalida os tokens | Segredo próprio | Não |
| A-P1-04 | HIPÓTESE (desempenho) | `resolveFinancialSource` (cartão) | Recalcula a fatura inteira a cada aviso | Medir | Não |

### 3.3 P2 (resumo; detalhes nos anexos)

| ID | Status | Resumo |
|---|---|---|
| S-P1→P2 | CONFIRMADO | Se o claim `shopping_followup` grava e o envio falha, a resposta se perde (`shopping-followup-claim.server.ts`, `whatsapp.server.ts:2855`, rota `1172`). A rota só registra a falha de envio (`public.whatsapp.expense.ts:1226-1233`) e isso vale para **todos** os fluxos. Como a rota responde 200 à Meta, não há reentrega automática. O agravante específico de Compras é pequeno: rebaixado para P2. Correção possível: guardar o texto curto no claim para reenvio manual, ou liberar o claim quando o envio falha. Teste T3 |
| S-P2 ×2 | CONFIRMADO | Falha de contexto silenciosa (`whatsapp-shopping.server.ts:109-112`); `whatsapp-research-provider.server.ts` é código morto |
| Q-P2-01 | CONFIRMADO (catálogo) | `whatsapp_cleanup_csp_reports` (DEFINER) executável por anon: só antecipa a limpeza de relatórios CSP com mais de 7 dias |
| Q-P2-02 | CONFIRMADO (catálogo) | Grant SELECT para anon em tabelas sem política, como `whatsapp_pix_pending_secrets`. O RLS nega, mas o grant é desnecessário |
| W1-P2-01…09 | ver anexo 1 | Formato do hex na assinatura, tipos Meta descartados sem métrica, comentário de download incorreto, sanitizadores diferentes, rate limit fail-open, "hash" que é truncamento, `hasBetaAccess` morto, log de erro do PostgREST, `stripMediaFields` por deny-list |
| G-P2-1 | CONFIRMADO | "não" cancela no gasto mas não na edição de conta |
| C-P2-01…03 | ver anexo 3 | Imagem sem checagem de magic bytes; NFC-e por QR pode ser só do site; TTL documentado em outro módulo |
| A-P2 (6–11) | ver anexo 4 | `listAgenda` filtra depois do `.limit()`; fuso duplicado; busca em memória sem paginação; canário sem trava técnica; `hashPixKey` sem conferir o segredo; preferência "agenda" ligada por padrão |

### 3.4 Achados descartados após verificação

| Afirmação bruta | Resultado |
|---|---|
| "`agenda_items` não existe em migrations" (revisor do anexo 6) | **Falso**: `drizzle/migrations/0006_agenda_items.sql:2-42` |
| "SECURITY DEFINER sem search_path" (grep) | **Falso positivo**: catálogo com 0 casos |
| "`gastos.deleted_at` talvez não exista" (anexos 4/5) | **Resolvido**: existe no banco real |

---

## 4. Implementação × teste × ativação

| Funcionalidade | Código | Teste local | Banco real (catálogo) | Meta / flag | Teste real |
|---|---|---|---|---|---|
| Webhook + assinatura + dedupe | implementado | sim (estrutural + comportamental) | índice único em `external_id` OK | publicado | NÃO VERIFICADO nesta auditoria |
| Gastos por texto | implementado | sim; **sem teste de "1.950"** | — | publicado | dono testou antes; G-P0-1 em aberto |
| Botões assinados (HMAC) | implementado | sim | — | publicado | NÃO VERIFICADO |
| Comprovante/NFC-e e datas | implementado | 35 testes de data (fixture fictícia) | — | publicado | dono testou em 13/10 (data alterada para 11/10/2026). **A foto original não foi usada localmente** |
| Áudio / Whisper | implementado | mocks | — | publicado | **teste real pendente** |
| Agenda | implementado | testes `agenda-*` incluídos no pacote | `agenda_items` + RLS OK | envio automático **OFF** (`WHATSAPP_DISPATCH_ENABLED`); templates UTILITY pendentes | NÃO |
| Soft-delete F2 / desfazer / F4 | candidatos | SQL local 45 + 15 testes | **não aplicados** (só a coluna, pelo hotfix) | — | NÃO |
| Assistente de Compras | implementado | testes de compras + 22 SQL | funções aplicadas (não versionadas) | flag e piloto (valores reais NÃO VERIFICADOS) | dono testou com o piloto |

---

## 5. Fluxo e dependências (resumo; detalhes nos anexos 1 e 2)

```text
Meta POST /api/public/whatsapp/expense
 -> HMAC X-Hub-Signature-256 (L162-173) -> Zod (L192-425)
 -> identidade: whatsapp_links (ativo, opt_in, não revogado) -> entitlement (has_feature_access) -> rollout/beta
 -> runInboundProductionGate (cota atômica, idempotente por WAMID) (L796-812)
 -> [mídia] download Graph (sem timeout) -> validação -> OCR/Whisper (Lovable AI Gateway)
 -> processarMensagemWhatsApp: dedupe whatsapp_messages.external_id (L2822+) -> sessão (TTL 30 min, L1369)
    -> gastos/receitas/contas/agenda/pix/compras (service_role) -> gravarSessao (único por external_id)
 -> resposta: interativo -> fallback texto (L1165-1233); falha de envio só é registrada no log
Externos: Meta Graph (envio/mídia), Lovable AI Gateway (OCR/transcrição), SerpApi (Compras, só com flag + piloto).
```

---

## 6. Plano de correções priorizado (nada aplicado agora)

| Ordem | Item | Impacto | Esforço | Janela |
|---|---|---|---|---|
| 1 | G-P0-1: corrigir `parseValor` + teste T1 + reconferir quem chama | evita valores 1.000× menores | pequeno, sem migração | próximo publish |
| 2 | A-P1-02: remover ou corrigir `handlePagarPessoaIntent` | elimina uma armadilha de 100× | pequeno | junto com o item 1 |
| 3 | C-P1-02/C-P1-04: timeouts de download e de transcrição | evita processamento pendurado | pequeno | junto com o item 1 |
| 4 | Q-P1-01: versionar o SQL de Compras | garante restauração e ambientes novos | pequeno, aditivo | qualquer janela |
| 5 | A-P1-01: aplicar F4 (`reverter_extrato_atomic`), com backup e teste de restauração | atomicidade | médio, migração | janela planejada |
| 6 | Q-P2-01/02: revogar EXECUTE e grants desnecessários | defesa em profundidade | pequeno, migração | janela planejada |
| 7 | S-P2 (reply perdida), W1-P1-03, A-P1-03 | robustez | pequeno | depois |

**Roteiro de E2E real controlado (para depois, numa conta de teste):**
1. Gasto "Mercado 1.950" depois da correção.
2. Foto nova de NFC-e.
3. Áudio curto de gasto.
4. "qual loja?" e toque em "Oferta 1".
5. Lembrete da Agenda, só quando o envio automático for ligado.

Para cada item, registrar o código da mensagem, o estado gravado e a resposta. Nenhum desses testes foi feito nesta auditoria.

---

## 7. Fase 2 — leitura pendente por área

| Área | Arquivos (linhas) |
|---|---|
| Envio e transporte Meta | `whatsapp-outbound-adapter` (840), `whatsapp-meta-transport` (706), `whatsapp-meta-status-callbacks` (1.179, parcial), `whatsapp-notifications` (757), `whatsapp-notification-attempts` (488), `whatsapp-outbound-quota-wire` (344), `whatsapp-messages.ts` (987) |
| Cotas | `whatsapp-quota` (396), `whatsapp-quota-admin` (364), `whatsapp-financial-quota-gate` (398), `whatsapp-query-guard` (243) |
| Gastos, contas e cartões | `whatsapp.server.ts` (6.185, parcial), `whatsapp-parcelamento` (1.383), `whatsapp-faturas` (1.362), `whatsapp-contas-criar` (1.306), `whatsapp-contas-pagar` (955), `whatsapp-contas` (629), `whatsapp-contas-lembretes` (525), `whatsapp-limites` (439), `whatsapp-cartao-cadastro` (549), `whatsapp-receitas` (702, parcial), `whatsapp-consultas-especificas` (634), `whatsapp-planning` (418), `whatsapp-postlaunch` (362), `whatsapp-voice-number-normalizer` (436) |
| Boleto e Pix | `whatsapp-boleto-intents` (1.479), `whatsapp-pagar-pessoa-flow` (1.788, parcial), `whatsapp-pix-parser` (767, parcial) |
| Templates Meta | `whatsapp-meta-template-*` (management 433, sync 216, placeholders 156, submission 114, catalog 107, mapping 78) |
| Outros | `whatsapp-interactive` (538, parcial), `whatsapp-wikimedia` (102), `whatsapp-sent-audit` (30) |
| SQL | conteúdo integral das 37 migrações que citam `whatsapp_`/`agenda_`; funções `whatsapp_complete_link_verification` e `whatsapp_consume_inbound_quota_atomic` |
| Segurança | varredura completa de `console.*`; origem de `built.url` em `whatsapp.server.ts:6012`; allowlist do `nfce-fetch` |

---

## 8. Comandos e resultados exatos

| Comando | Resultado |
|---|---|
| `node scripts/test-whatsapp.mjs` | 162 arquivos, **2.820 aprovados, 0 falhas**, 0 arquivos com falha, 76,26 s, exit 0 |
| `bunx tsgo --noEmit` | exit 0, sem erros |
| Build automático do preview | `build OK` (23:26:49Z) |
| `scripts/test-shopping-quota-sql.sh` (PG17 local) | 22 PASSOU / 0 FALHOU |
| `scripts/test-gastos-delete-atomic-sql.sh` | 15 / 0 |
| `scripts/test-gastos-soft-delete-sql.sh` | 45 / 0 |
| Reprodução G-P0-1 (script temporário, apagado em seguida) | `"Mercado 1.950"` → 1.95; `"Aluguel 1.500"` → 1.5; `"R$ 2.000"` → 2; `"1.950,00"` → 1950; pipeline simulado → "Valor: R$ 1,95" |
| Catálogo (somente leitura) | 0 DEFINER sem `search_path`; 34 funções `whatsapp_*` sem EXECUTE para anon/authenticated; F4 ausente; `gastos.deleted_at` presente |

Tudo é **simulação local**: nenhum desses resultados prova o comportamento em produção com Meta, IA ou SerpApi reais.

## 9. Créditos

A ferramenta disponível **não informa o custo exato** deste turno. O valor de 21,9 créditos citado pelo usuário para a etapa anterior não pôde ser conferido aqui.

## 10. Checklist de riscos em produção

- [ ] G-P0-1 corrigido e coberto por teste
- [ ] Código morto 100× (`handlePagarPessoaIntent`) removido
- [ ] Timeouts de download e de transcrição
- [ ] SQL de Compras versionado
- [ ] F4 aplicado com backup e teste de restauração
- [ ] Grants e EXECUTE desnecessários revogados
- [ ] Fase 2 (§7) concluída antes de declarar cobertura total
- [ ] E2E real controlado (§6) em conta de teste
