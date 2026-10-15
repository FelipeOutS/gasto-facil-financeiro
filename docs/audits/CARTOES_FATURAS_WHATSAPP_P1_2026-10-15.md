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
