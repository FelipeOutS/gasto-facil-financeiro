# Validação final P0 — confirmação do WhatsApp (2026-10-14)

Somente mocks/testes locais. Sem publicação, migração, dados reais, flags ou Meta.

## Resultado: APTO COM RESTRIÇÕES

## Verificações
1. Webhook → persistência → resposta: `src/routes/api/public.whatsapp.expense.ts:1155-1218`. A resposta só sai depois de `processarMensagemWhatsApp`; uma falha no envio não desfaz nem refaz o gasto.
2. Matriz 200/400/429/500/503/timeout/rede: `tests/whatsapp-validacao-final-p0.test.ts` (novo, 29 testes). Só o 400 leva ao texto alternativo, e o envio acontece uma única vez.
3. Duplicação financeira: os ids são determinísticos (`src/server/whatsapp-financial-idempotency.server.ts`). Em `tests/whatsapp-financial-once.test.ts`, dois processos ao mesmo tempo, Confirmar duas vezes e nova tentativa depois de salvo gravam uma linha só. Quando a Meta reenvia a mesma mensagem, o status é `duplicada` e nenhuma resposta sai (`public.whatsapp.expense.ts:1162`, teste `whatsapp-webhook-replay-3-27`).
4. Pix (CTA), Flow do cartão e botões passam pelo mesmo `deliverReplyPlan`. Quando o resultado é incerto, nada é enviado por cima.
5. Consultar um gasto lê o que está salvo, sem depender de a confirmação ter chegado. A consulta segue os testes de consultas já existentes.
6. Logs: `wa_reply_undelivered` registra apenas classe, canal e status. `wa_reply_failed` registra só o código HTTP ou o nome do erro. O registro de saída guarda hash, últimos 4 dígitos e tamanho, nunca o texto.
7. Reenvio automático: `deliverReplyWithRetry` nunca reenvia, porque nenhum caso é classificado como `transient`. O dispatcher, os lembretes e os alertas usam a fila `whatsapp_notifications` e não reenviam respostas de confirmação. Os alertas proativos continuam desligados.
8. HTTP 2xx significa "aceito pela Meta" (`accepted`). A entrega real só se sabe pelos callbacks de status.

## Testes
- 4 arquivos direcionados: 64 aprovados, 0 reprovados.
- Suíte oficial: 169 arquivos, 2.969 aprovados, 0 reprovados.
- Build automático: OK (2026-10-14T17:10:14Z).

## Correções
Nenhuma correção P0 foi necessária. Foi adicionado apenas o teste da matriz.

## Riscos restantes (restrições)
- Quando o resultado é incerto, o usuário pode ficar sem confirmação. O gasto continua salvo e pode ser consultado. A recuperação durável depende da tabela candidata (`docs/migrations-candidate/whatsapp-reply-outbox.sql`), que ainda não foi aplicada.
- Os avisos que saem antes do processamento (bloqueio, áudio desligado) usam um envio único, sem efeito financeiro.
- Os testes são simulações e não provam o comportamento real da Meta.
