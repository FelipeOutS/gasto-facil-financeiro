# Assistente de Compras Inteligente no WhatsApp — auditoria e plano

Somente auditoria e planejamento: não implementei e não publiquei nada. Nenhum código, variável, banco, dado, configuração ou template da Meta foi alterado.

## (a) O que já existe e pode ser reaproveitado

**Entrada e permissão**
- Webhook e roteamento: `src/server/whatsapp.server.ts` (cerca de 4,4 mil linhas). A ordem é: sessão pendente (`gravarSessao` / `sessao`), depois `decisao`, comprovantes, cartões, contas, faturas, depois **pesquisa** (linha ~4398, só quando não há sessão, não há imagem ou documento, e a mensagem não tem valor com parcelas), depois `handleFinanceBrief` e o conversacional.
- Autorização: `whatsapp-authz.server.ts` (`canUseWhatsAppForSender`, `normalizePhone`) e `whatsapp-entitlement.server.ts` (`getWhatsAppEntitlement`: número vinculado, plano pago e consentimento).
- Limites: `rate-limit.server.ts` (`checkRateLimit`) e a cota atômica da RPC `whatsapp_claim_research` (migração `20261004150000_whatsapp_research.sql`, já aplicada). Essa RPC faz idempotência por `external_id`, cota mensal por usuário e cota global.
- Áudio: a transcrição marca `source="audio"` e o texto entra no mesmo roteador. O parser de valores sem "reais" (`whatsapp-audio-lote.ts`) vale só para gastos.

**Base de pesquisa (WA 2.0)**
- `whatsapp-research-core.ts` já tem intents (product, compare, general, followup), preço informado pelo usuário, parcelas (`splitInstallments`), `budgetComparison`, `safeSourceUrl` e `isCurrentPriceQuestion`.
- `whatsapp-research.server.ts` usa contexto com validade de 20 minutos em `whatsapp_research_requests`, guarda só nome, preço e link, e fica atrás da flag `WHATSAPP_RESEARCH_ENABLED` (desligada).
- `whatsapp-research-mvp.ts` e `whatsapp-wikimedia.server.ts` buscam só informação enciclopédica, sem preços.
- `whatsapp-research-provider.server.ts` é um protótipo antigo de provedor pago. Não está conectado e deve continuar assim.

**Leitura financeira (somente leitura)**
- Gastos: tabela `gastos`. Receitas: tabela de receitas, usada pelo `handleFinanceBrief`. Orçamento: `limites` (`tipo="total"`, mês e ano).
- Cartões e faturas: `cartao-fatura.server.ts` (`getFaturaAtualPorCartao`, `getItensFaturaAtualPorCartao`) e `whatsapp-faturas.server.ts` (`handleFutureFaturaIntent`, `resolveTargetInvoiceMonth`), com `fatura_competencia`.
- Contas a pagar e vencimentos: `whatsapp-contas.server.ts` e `contas-vencimento.server.ts`. Limite do cartão: `cartao-limite.server.ts`.
- Agenda: `agenda.server.ts`. Metas, guardado e assinaturas são lidos hoje pelo site em `src/lib/*`; o servidor tem acesso parcial pelo `handleFinanceBrief`.
- Fuso: America/Sao_Paulo (`nowInAppTz`, `todayLocalISO`).

**O que o usuário tem ou não tem cadastrado**
- Disponível quando cadastrado: lançamentos de receitas e gastos, faturas por competência, parcelas futuras, contas a pagar e a receber, orçamento total do mês, metas e guardado.
- Não disponível: saldo bancário real (não há integração bancária), renda garantida (só a média histórica), juros reais de cada loja, e reserva de emergência como campo próprio (só o "guardado").

## (b) De onde vêm os preços

| Opção | Custo gratuito | Uso comercial | Preços no Brasil | Observações |
|---|---|---|---|---|
| SerpApi Google Shopping | 250 buscas por mês hoje (confirmar no ato) | Sim | Sim (`gl=br`, `hl=pt-br`) | Traz loja, preço, link e às vezes frete e parcelas. Chave fica no servidor. |
| Google Custom Search JSON | Fechado para novos clientes | — | — | Descartado |
| Mercado Livre (API pública de itens) | Gratuito com regras próprias | Precisa conferir os termos atuais | Só o Mercado Livre | Pode ser a fonte secundária; precisa de autorização |
| Raspagem de lojas ou Buscapé | — | Arriscado e contra os termos | — | Descartado |
| Wikimedia (já existe) | Grátis | Sim | Não traz preço | Só para especificações e conceitos |

**Recomendação:** SerpApi como fonte principal. Para o provedor vai só o texto da busca, mais `gl` e `hl`. Nunca vão nome, telefone, e-mail ou valores do usuário.

**Proteções da busca**
- Cache curto conforme os termos do provedor; proposta de 30 a 60 minutos por busca normalizada, sem dados do usuário.
- Cota por usuário (proposta: 10 por mês) e teto global abaixo da franquia (proposta: 200 de 250). Throttle via `checkRateLimit`.
- Tempo limite de 8 segundos. Mensagens específicas para "sem resultados" e "cota esgotada".
- Monitoramento: contar chamadas e falhas em `whatsapp_research_requests`.
- Chave: o proprietário cadastra `SERPAPI_API_KEY` em Segredos. Não peço nem uso a chave agora.

## (c) Arquitetura e fases

```text
texto/áudio -> autorização -> sessão pendente? -> fluxo financeiro existente
                                     \-> não: intent compra_assistida
                                            -> Fase A: ofertas (provedor, cache, cota)
                                            -> Fase B: capacidade (somente leitura)
                                            -> Fase C: resposta + contexto 20 min
```

**Prioridade do novo intent `shopping_assist`**
- Entra no lugar do bloco de pesquisa atual: depois de sessões, comprovantes, cartões, contas e faturas.
- Só é acionado com verbo de desejo ("quero comprar", "pensando em comprar", "vale a pena comprar", "onde está mais barato", "cabe no meu bolso") **e** sem marcador de fato consumado ("gastei", "comprei", "paguei", "recebi").
- Qualquer valor com parcelas já lançado continua indo ao fluxo financeiro (`financialInstallment`). Lembretes ("me lembra") e fotos ficam de fora.
- Áudio só entra depois da transcrição, com a mesma regra.

**Fase A — ofertas, sem finanças.** Complexidade média, risco médio.
- `whatsapp-shopping-provider.server.ts`, com interface e adaptador SerpApi.
- `whatsapp-shopping-core.ts` (funções puras): normalizar a busca; extrair variantes (linha Air ou Pro, chip/geração, RAM, SSD, tamanho, novo ou usado); pedir esclarecimento quando faltar um atributo que muda o preço; filtrar ofertas incompatíveis.
- Anti-fraude:
  - descartar preço menor que 40% da mediana;
  - aceitar só `https` e domínio de loja;
  - descartar usado ou recondicionado salvo se o usuário pedir;
  - aceitar só moeda BRL.
- Até 3 ofertas, cada uma com loja, modelo, preço, link, horário da consulta e "via Google Shopping". Frete e parcelas aparecem só se o provedor informar.
- Nunca dizer "menor preço do mercado"; dizer "melhores preços encontrados nesta consulta".
- Pronto quando: os testes com fixtures passam, inclusive variantes, divergências, links suspeitos, sem resultado, cota, timeout e repetição pelo mesmo `external_id` sem nova chamada.

**Fase B — capacidade, somente leitura.** Complexidade alta, risco alto (cálculo).
- Função pura `estimarCapacidadeCompra(snapshot)` e um leitor `shopping-finance-snapshot.server.ts` que só faz SELECT.
- Renda confiável: mediana das receitas dos últimos 3 meses fechados. Se tiver menos de 2 meses de dados, a confiança é baixa.
- Despesas fixas: contas recorrentes e assinaturas. Despesas variáveis: média de gastos fora do cartão nos últimos 3 meses, mais faturas por competência, sem contar o cartão duas vezes.
- Obrigações dos próximos 12 meses: parcelas futuras por `fatura_competencia` e contas a pagar.
- Folga mensal = renda − fixas − variáveis − parcelas já existentes.
- Reserva = guardado. Não comprometer o guardado à vista, salvo pedido do usuário.
- Cenários: à vista, 6x, 10x e 12x sem juros, mês a mês contra a folga. Juros só se o usuário ou a loja informarem a taxa ou o total.
- O limite do cartão aparece só como "limite disponível no cartão", nunca como dinheiro.
- Classificação: "cabe nos dados cadastrados", "pode apertar seu orçamento", "não cabe na folga estimada" ou "dados insuficientes" (nesse caso pergunta a renda ou avisa a baixa confiança). Nunca "pode comprar".
- Pronto quando: há testes com usuários fictícios isolados para dados completos, sem renda, só cartão, parcelas acumuladas, guardado zero, juros conhecidos e desconhecidos, e prova de que nenhuma escrita acontece.

**Fase C — juntar tudo e follow-ups.** Complexidade média, risco médio.
- Resposta em texto simples, sem botões, com:
  - até 3 ofertas;
  - aviso de que preço, frete e estoque podem mudar;
  - resumo financeiro com a ressalva de que é estimativa;
  - simulação de parcelas e quanto guardar por mês até a data citada;
  - oferta de criar meta só se o usuário pedir, com confirmação explícita e usando o fluxo de metas que já existe.
- Contexto de 20 minutos em `whatsapp_research_requests.context`. Guarda só a busca, as ofertas (preço, loja, link, horário) e a variante; **nenhum número financeiro**, que é recalculado a cada pergunta.
- Follow-ups previstos: "e em 12 vezes?", "se eu esperar até dezembro?", "e o Pro?" (gasta mais uma busca).
- Ofertas com mais de 60 minutos de contexto saem como "consultado às HH:MM", sem "agora".
- Pronto quando: há testes de ponta a ponta com provedor falso cobrindo follow-up, contexto expirado, sessão financeira concorrente sem colisão, repetição idempotente e áudio transcrito.

**Persistência:** a tabela `whatsapp_research_requests` e a RPC de cota já existem. Uma migration só seria necessária se:
- a constraint de `intent` não aceitar `shopping`; ou
- precisar de uma tabela de cache sem `user_id`.

Vou conferir isso e justificar antes de pedir autorização.

## Conflitos reais e mitigações
- **Pesquisa atual (Wikimedia):** "quanto custa" e "onde está mais barato" já caem em `detectResearchIntent` com resposta "em preparação". O novo intent substitui o bloco `product` com preço; conceitos continuam no Wikimedia.
- **Lançamento de compras:** "comprei um MacBook por 8 mil em 10x" precisa continuar indo para gasto. Ficam testes de regressão para "comprei", "gastei", "paguei" e "recebi".
- **Áudio e números por extenso:** "oito mil" pode não ser reconhecido. Nesse caso o assistente pergunta em vez de supor. O parser de áudio para gastos não muda.
- **Receitas com mês nomeado:** o fluxo atual não foi verificado. A Fase B usa só o mês dos lançamentos, sem interpretar texto.
- **Lembretes automáticos:** o assistente não usa a fila `whatsapp_notifications` nem `agenda_items`, então não há colisão.
- **Cota global:** uma contagem separada evita que a pesquisa conceitual consuma as buscas de preço.
- **Fora desta iniciativa:** Mercado web, integrações bancárias e pagamentos.

## (d) Ordem de prioridades combinada
1. P0 — estabilização de notas e do loop: concluída no código.
2. P1 — áudio e confirmações: implementados e publicação solicitada. A flag `WHATSAPP_AUDIO_ENABLED` em produção e um áudio real **ainda não foram verificados**.
3. P1 — próximo pacote: lembretes automáticos, recorrência, fila, status enviado/entregue e prova na Meta.
4. P2 — botões Confirmar/Ajustar/Cancelar, exclusão de meses com confirmação, cadastro conversacional de cartões e ajustes.
5. **Novo: Assistente de Compras**, como pacote separado. Posição recomendada: depois do P1 de lembretes. A Fase A pode começar em paralelo ao P2 se o proprietário quiser, porque não toca nos mesmos arquivos de lembretes.
6. Templates da Meta: só depois de concluídas as melhorias do WhatsApp.
7. Demais módulos avançados do WhatsApp: etapa futura.

## (e) O que preciso antes de construir
1. Aprovação da SerpApi (ou outra fonte) e cadastro de `SERPAPI_API_KEY` em Segredos pelo proprietário.
2. Valores de cota: busca por usuário por mês e teto global.
3. Se a pesquisa de compras é só para planos pagos, como o WhatsApp atual.
4. Regras do cálculo: meses usados para a renda, se o guardado conta como reserva intocável, e o limiar para "pode apertar" (proposta: parcela acima de 30% da folga).
5. Autorização para uma eventual migration pequena (constraint de intent ou cache), depois da conferência.
6. Confirmação de que a fase começa após o P1 de lembretes.

## (f) Status
Não implementei, não publiquei, não ativei nada e não usei nenhuma chave ou API.

## (g) Créditos
Não consigo confirmar o consumo real de créditos desta interação.
