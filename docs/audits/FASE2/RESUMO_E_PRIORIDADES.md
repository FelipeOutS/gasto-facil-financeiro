# FASE 2 — Resumo e prioridades (14/10/2026)

| Item | Valor |
|---|---|
| HEAD | `f22e1eab7f9ca93be780b71bfeba71a0ab59c707` |
| Modo | só análise e documentação. Nada no app, banco, SQL, segredos, flags ou Meta foi alterado. Nada publicado |
| Pacotes | 01–06 nesta pasta. Cobertura em `00_COBERTURA.md` |
| Base | `docs/audits/AUDITORIA_WHATSAPP_COMPLETA_2026-10-13.md`, `anexo-0..6`, `docs/release-candidates/PREFLIGHT_F2_UNDO_F4_2026-10-13.md` (preservados) |

## 1. Cobertura (111 arquivos, 46.557 linhas, inventário inalterado)

| Status | Arquivos | Linhas | % |
|---|---:|---:|---:|
| Revisado integralmente nesta rodada | 39 | 25.284 | 54,3% |
| Integral só autodeclarado na 1ª rodada | 70 | 14.511 | 31,2% |
| Parcial (`whatsapp.server.ts`) | 1 | 6.185 | 13,3% |
| Não lido (`whatsapp-agenda.server.ts`, conflito entre anexos) | 1 | 577 | 1,2% |

Na 1ª rodada, 32.046 linhas não tinham leitura integral. Desta vez foram lidas integralmente 25.284 linhas; ainda faltam **6.762 linhas em 2 arquivos**.

"Integral" é declaração do revisor de cada pacote, não prova independente.

**Fora do inventário**
- `store.ts`: PARCIAL, cerca de 66%.
- SQL: das 37 + 5 migrações que citam WhatsApp/Agenda, só 1 foi lida integralmente.

## 2. Achados

Confiança:
- **CONFIRMADO**: visto no código, e reproduzido quando indicado;
- **SUSPEITO**: plausível, mas não provado;
- **NÃO TESTADO**: sem teste que comprove.

### P0

| ID | Confiança | Local | Problema | Reprodução fictícia |
|---|---|---|---|---|
| **G2-P0-1 / F-01b** | CONFIRMADO (código lido pelo consolidador + `bun -e` do revisor) | `src/server/whatsapp-comprovantes.server.ts:280-293`, usado em L766, L1205 e L1264 | Cópia local de `parseValor` **sem a correção de milhar**: "1.950" vira 1,95. O revisor também mostrou "1950" virando 195 | Foto de nota com valor ilegível. O bot pede o valor, o usuário digita "1.950" e a confirmação mostra **R$ 1,95** |
| **F-01 (pacote 4)** | CONFIRMADO (revisor, `bun -e`) | `src/server/whatsapp-boleto-intents.server.ts:207-216` (`parseValorFromText`) | Mesmo bug na correção do valor do boleto | "R$ 1.950" vira R$ 1,95 na conta a pagar |

A correção publicada em 13/10 cobriu só `src/lib/whatsappParser.ts`. Leem "1.950" corretamente: receitas, parcelamento, planejamento, Pix, áudio em lote e contas a pagar.

### P1

| ID | Confiança | Local | Problema |
|---|---|---|---|
| F6-02 | CONFIRMADO | `src/lib/store.ts:4875` + banco | O site chama `reverter_extrato_atomic`, que **não existe no banco**. Reverter extrato falha fechado, sem apagar nada. Se esse código já está publicado: NÃO VERIFICADO |
| TPL-P0→P1 | CONFIRMADO | `whatsapp-meta-template-submission.server.ts:94-109` | Diz sucesso mesmo quando a gravação no banco falha, com risco de reenviar o template à Meta. Só Admin Master, atrás de flag |
| TPL-P1-01/02 | CONFIRMADO | `whatsapp-meta-template-submission.server.ts:70-82` | Envio à Meta sem tempo limite. O log grava o erro da Meta sem tratamento |
| QA-P1-01 | CONFIRMADO | `whatsapp-quota-admin.server.ts:220-254` | Duas edições de cota ao mesmo tempo: a última vence, sem trava (painel admin) |
| F6-01 | CONFIRMADO (9 pontos lidos) | `store.ts:553,1839,2517,2570,4350,4451,5324,5423,5452` | Alterações de gastos sem filtro de excluídos. Inofensivo hoje; precisa ajuste **antes** de ligar a exclusão por período (F2) |
| F-02 (contas) | CONFIRMADO | `whatsapp-contas-pagar.server.ts` | Baixa de conta pelo WhatsApp não pode ser desfeita pelo WhatsApp |
| F-03 (contas) | CONFIRMADO | `contas-vencimento.server.ts:184-210` | Busca carrega todas as contas pendentes e filtra em memória (desempenho) |
| F-05 (Pix) | CONFIRMADO, código morto | `whatsapp-pix-intents.server.ts:478` | Grava centavos como reais (100×) se for reativado |
| G2-P1-1/2 | SUSPEITO | `whatsapp-postlaunch.server.ts:31-35, 250-256` | Edição pós-lançamento: janela de 60 min (contra 30 min do resto) e tokens sem assinatura HMAC |
| Q-P1-01 / F6-03 | CONFIRMADO | `docs/migrations-candidate/whatsapp-shopping-quota.sql` | SQL de Compras aplicado no banco, mas não versionado |

### P2 (resumo; detalhes nos pacotes)

| ID | Problema |
|---|---|
| P1-01 → SUSPEITO (01) | Reentrega de texto: a rota não chama a checagem de mensagem já processada. Mitigado pelo dedupe interno e por ids determinísticos; teste pendente |
| P1-02 → P2 (01) | Falha ao enviar a resposta não é tentada de novo; o usuário pode ficar sem confirmação de um gasto salvo. A Meta não reentrega depois de receber 200 |
| P2-01..05 (01) | Download de mídia lê tudo antes do corte, `?.` mascara import, guarda duplicada, log condicional |
| F-02/F-03/F-04 (04) | Boleto manual sem conferência pós-gravação; cota gasta sem gasto criado; janela da chave Pix |
| F-06 (04) | Três parsers de valor duplicados (raiz do P0) |
| TPL-P2, PH-P2, WM-P2, QA-P2-02 (05) | Erro técnico ao admin, divergência de template, CPF/telefone heurístico, tempo limite delegado, erro de plano engolido |
| F6-04..09 (06) | Desfazer atual sem soft-delete; corrida teórica; trust_foundation não lido; CSP cleanup; memória otimista |
| F-07 (04) | Rodar `bun test` com todos os arquivos juntos dá cerca de 1.008 falhas por conflito de mocks. O runner oficial passa |

### Achados descartados nesta rodada

| Afirmação | Resultado |
|---|---|
| F-01 (pacote 3): "`gastos.deleted_at` não existe, faturas fora do ar" | **Falso.** A coluna existe (hotfix `drizzle/migrations/0007`, conferida no catálogo em 13/10) |
| F-04 (pacote 3): "`extrairValor` herda o bug" | **Falso.** O pacote 2 reproduziu: "1.950" vira 1950 |
| 73 falhas (pacote 2) / 17 falhas (pacote 4) | Testes rodados fora do runner oficial; não são regressões |

## 3. GO/NO-GO por recurso (código atual, sem publicar)

| Recurso | Situação |
|---|---|
| Webhook, assinatura, status e cotas | GO (sem P0) |
| Gasto por texto e áudio | GO |
| Correção do valor de comprovante (foto/NFC-e) | **NO-GO até corrigir G2-P0-1** |
| Correção do valor de boleto | **NO-GO até corrigir F-01** |
| Receitas, parcelamento, planejamento e Pix | GO |
| Contas, cartões, faturas e limites | GO (P1 de desempenho e de desfazer) |
| Reverter extrato no site | **NO-GO no código atual** enquanto F4 não estiver instalada (falha fechada) |
| Exclusão por período (F2) / Desfazer com soft-delete / F4 | NO-GO: preflight pendente (B1–B3) |
| Submissão de templates Meta | GO condicionado: flag OFF até corrigir o P1 |
| Assistente de Compras | GO no piloto; versionar o SQL |

## 4. Mapa SQL × produção

| Objeto | Repositório | Banco real |
|---|---|---|
| `gastos.deleted_at` | `drizzle/0007` | existe |
| F2 / UNDO-soft / F4 | só candidatos | **não aplicados** |
| Compras (2 tabelas + 6 funções) | só candidato | aplicado, sem versionamento |
| `whatsapp_undo_recent_action` | `supabase/20261004130000` | versão antiga (sem checar `deleted_at` de gastos) |

## 5. Testes rodados AGORA (14/10, sem rede)

| Teste | Resultado |
|---|---|
| `node scripts/test-whatsapp.mjs` | **164 arquivos, 2.851 aprovados, 0 falhas**, rc=0, 84,05 s |
| `bunx tsgo --noEmit` | rc=0, sem erros |
| Build | nenhum log de build nesta sessão; não executado |

Rodados pelos revisores (bun test por grupo):
- 01: 308/0.
- 03: 452 aprovados, 2 pulados, 0 falhas.
- 05: 174/0.
- 04: data do comprovante 35/0 e categoria manual 7/0, rodados isolados.
- 02: voz 33/0. Os demais falharam por terem sido rodados fora do runner oficial.

SQL local do pacote 6: 39 + 34 + 22, com 0 FALHOU (forma de contagem diferente da do preflight, que mediu 45 e 35).

**Sem teste com mídia, Meta ou banco reais.**

## 6. Sugestões para autorizar depois (nada foi corrigido)

1. **P0:** trocar os parsers locais de comprovante e boleto pelo `parseValor` já corrigido, com testes "1.950", "1950" e "R$ 2.500".
2. Decidir sobre a reversão de extrato: instalar F4 conforme o preflight, ou manter a falha fechada com aviso claro.
3. Template Meta: propagar a falha de gravação e adicionar tempo limite.
4. Remover `handlePagarPessoaIntent` (100×).
5. Versionar o SQL de Compras.
6. Fase 3:
   - ler `whatsapp.server.ts` inteiro (6.185 linhas);
   - ler `whatsapp-agenda.server.ts`;
   - ler `store.ts` nas linhas 2701–4299 e 4912–5249;
   - ler as 33 migrações não lidas e o candidato canário.
