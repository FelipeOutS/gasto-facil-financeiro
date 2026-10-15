# Cartões e faturas pelo WhatsApp: revisão P1 (15/10/2026)

Nada publicado e nenhuma migração aplicada. Nenhum dado, flag ou segredo de produção foi alterado. Nenhuma chamada real à Meta.
`LOTE_MES_RELEASE_AUTHORIZED=false` e `SHOPPING_RELEASE_AUTHORIZED=false` foram conferidos. F2 e F4 continuam NÃO aplicadas (ver `LIBERACAO_LOTE_F4_CARTOES_2026-10-15.md`).

## Caminho real de cada comando
`src/routes/api/public.whatsapp.expense.ts` (webhook) → `processarMensagemWhatsApp` (`whatsapp.server.ts`), que despacha para:
- **Cadastro (conversa e Flow):** `whatsapp-cartao-cadastro.server.ts` → grava via `cartao-cadastro.server.ts`. Faz checagem de vínculo, plano `cartoes_basico`, validação compartilhada, nome duplicado e id determinístico por pedido. Os dados do Flow são revalidados.
- **Fatura atual, por cartão, futura e detalhe:** `whatsapp-faturas.server.ts` → `cartao-fatura.server.ts`. Só leitura; filtra `user_id` e `deleted_at IS NULL`.
- **Limite:** `cartao-limite.server.ts`. Só leitura.
- **Escolha de fatura ao lançar compra:** `whatsapp-fatura-escolha.server.ts` e `whatsapp-cycle-resolver.server.ts`.
- **Parcelamento:** `whatsapp-parcelamento.server.ts` e `cartao-parcelamento.server.ts`. RPC atômica, centavos distribuídos nas primeiras parcelas.
- **Resposta:** `deliverReplyPlan`. O interativo (inclusive o Flow) com 429/5xx/timeout/exceção é tratado como incerto: sem texto por cima e sem reenvio. Só o 400 cai para texto. 2xx = aceito pela Meta, não "entregue".

## Defeitos P1 corrigidos
1. **Vínculo do telefone (cadastro):** `cartao-cadastro.server.ts` usava `limit(1)` entre as variantes com e sem 55, então uma linha antiga revogada podia recusar um usuário válido. Agora exige um vínculo ativo do próprio usuário e falha fechado se o número estiver ativo para outro usuário.
2. **Nome exato perdia para "contém":** "Itaú Visa" ficava ambíguo com "Itaú" (`cartao-fatura.server.ts: selecionarCartoesPorTermo`, `whatsapp.server.ts: matchCartao`). Agora o nome exato decide, mas só se nenhum outro nome contiver o termo. "Nubank" x "Nubank Ouro" continua ambíguo, de propósito.
3. **Cartões com o mesmo nome criavam um laço sem saída:** a resposta "digite o nome de um deles" nunca resolvia. Agora a mensagem explica que é preciso dar nomes diferentes no app. Não escolhe nenhum cartão sozinha nem mostra valores.

## Verificado sem mudança
- Cadastro sem PAN/CVV: só nome, limite, fechamento e vencimento.
- Consultas não gravam nada. Ações exigem confirmação e são idempotentes: cadastro por id determinístico, parcelamento via RPC.
- Cartão de outro usuário nunca entra na resposta.

## Limitações e riscos (sem correção, de propósito)
- **Contas conectadas:** o WhatsApp consulta e grava só os cartões do próprio titular do número. O site permite contas conectadas. É uma diferença conservadora: nada vaza, mas o compartilhado não aparece no WhatsApp.
- **Não existe "cartão cancelado"** no banco (`cartoes` não tem status). Todo cartão cadastrado é tratado como ativo.
- **Fechamento no dia 29 a 31 em meses curtos:** o ciclo segue a regra do site (`cicloFatura`, mesma do store), que pode passar para o mês seguinte. Mantida por paridade com o site; revisar junto com o site, nunca só no WhatsApp.
- **Fuso:** é usado America/Sao_Paulo fixo, não o fuso do perfil.
- **Reembolso ou estorno de compra no cartão:** não existe tratamento específico. Valores negativos só entram se já estiverem gravados.

## Testes
- Novos: `tests/cartao-cadastro-vinculo-p1.test.ts` 3/0 e `tests/whatsapp-cartoes-faturas-p1-2026-10-15.test.ts` 16/0. Cobrem nome exato x contido, homônimos, outro usuário, fechamento no dia e no dia seguinte, virada de ano, 100,00/3 = 33,34+33,33+33,33, Meta 429/500/503/exceção/400/200.
- Antigos: 354 de cartões e faturas continuam passando. Dois testes antigos de ambiguidade obrigaram a deixar a regra 2 mais conservadora.
- Suíte oficial: 261 arquivos, 3.840 aprovados, 0 falhas. Um teste do cofre falhou numa rodada com a máquina carregada; isolado passou e a rodada seguinte ficou toda verde. tsgo OK.
- Não executados: simultaneidade real com o site em banco de verdade e Flow real da Meta.

## Roteiro de teste real (depois de publicar, só com cartões de teste)
1. Cadastrar "Teste A" por conversa; repetir "cadastrar cartão Teste A" e conferir que avisa duplicado.
2. Cadastrar "Teste A Visa"; perguntar "fatura do Teste A Visa" → resposta direta; "fatura do Teste A" → pede para escolher.
3. Lançar 100,00 em 3x no Teste A Visa e conferir 33,34/33,33/33,33 no site.
4. Lançar uma compra no dia do fechamento e outra no dia seguinte; conferir em qual fatura cada uma cai, no site e no WhatsApp.
5. Tocar duas vezes em Confirmar: só um lançamento.
6. Apagar os dados de teste pelo site.

## Pendências fora deste escopo
- Lote mensal travado; migração `whatsapp-lote-mes.sql` aguarda autorização.
- F4 aguarda autorização; F2 incompatível, não aplicar.
- A cópia de segurança antiga nunca teve a restauração testada.

## Adendo — fechamento 29/30/31 em meses curtos (2026-10-15)

Regra de negócio (fonte da verdade, `src/lib/fatura-competencia.ts`): uma compra pertence ao ciclo do mês anterior se `dia da compra ≤ dia de fechamento` (comparação por NÚMERO de dia). Logo, com fechamento 31 todo o mês de abril fica num ciclo só: o fechamento efetivo é o último dia do mês (clamp). Totais/itens do site e do WhatsApp e a persistência (`fatura_competencia`, parcelas) já seguiam essa regra — corretos.

Defeito comprovado (só datas, não classificação): `cicloFatura`, `proximoFechamentoData`, `proximoVencimentoFaturaAberta`, `statusEfetivoFatura` e cálculos de vencimento do painel/página de cartões/alertas usavam `new Date(ano, mes, 31)`, que transborda (30/04 → 01/05; 31/02 → 03/03). Efeitos: fechamento exibido "01/05" em vez de 30/04; status "fechada" 1–3 dias atrasado; vencimento dia 29–31 jogado para o mês seguinte; e no WhatsApp a janela por data do ciclo fev/2026 (fech 31) começava em 04/03 — compras antigas sem `invoice_month`/`fatura_competencia` de 01–03/03 sumiam do total no WhatsApp, divergindo do site.

Correção: helpers únicos `periodoCiclo`, `fechamentoNoMes`, `vencimentoDoFechamento`, `proximoFechamento` (clamp ao último dia; vencimento pela mesma regra de `offsetVencimento`), usados em store.ts, cartao-fatura.server.ts, DashboardCartoesInsights, cartoes.index e alerts/generator. Sem migração; nenhum dado histórico alterado (valores gravados não dependiam dessas datas). Teste: tests/fatura-ciclo-meses-curtos-2026-10-15.test.ts (fech 28–31 × 12 meses × 2024/2026/2027, fusos São Paulo e UTC).

## Adendo 15/10/2026 — listagem de cartões por frases naturais
- Falha: "Quais cartões tenho cadastrados?" não casava com a regex exata e caía no aviso "consulta indisponível" (query guard).
- Correção: `isListarCartoesIntent` (lista fechada de palavras; recusa dígitos e verbos de ação) substitui a regex em whatsapp.server.ts; mesma consulta `carregarCartoes(userId)`, mesmas condições (sem sessão, decisão "outro"), só nomes. Aviso de cartões no query guard deixou de dizer "indisponível" e orienta "meus cartões".
- Testes: tests/whatsapp-listar-cartoes-p1-2026-10-15.test.ts (6 testes: 8 frases naturais, 12 não-listagens, 1/2/0 cartões, outro usuário, cadastro/fatura, sessão pendente). Suíte oficial 265 arquivos, 4.010/0; tsgo OK.
- Teste real pós-publicação: enviar "Quais cartões tenho cadastrados?" e "Que cartões eu tenho?".
