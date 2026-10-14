# Estabilização WhatsApp — 14/10/2026 (rodada 1, NÃO PUBLICADO)

Nada foi publicado. Nenhuma migração foi aplicada. Banco real, dados, flags, segredos e Meta não foram alterados. Nenhum WhatsApp real foi enviado.

## 1–3. Problemas desta rodada

| ID | Problema | Status |
|---|---|---|
| F-05 / B1 | `handlePagarPessoaIntent` gravava `gastos.valor` em centavos, ou seja, 100× o valor. É código inalcançável: em `whatsapp.server.ts` aparece só como `void`, e o fluxo ativo é `whatsapp-pagar-pessoa-flow`. | CONCLUÍDO: agora grava `valorCentavos / 100`. O teste que confirmava o erro (5000) agora espera 50 |
| TPL-P0→P1 / C1 | Indicava sucesso mesmo quando a gravação local falhava | CONCLUÍDO: retorna `persist_failed` com `provider_template_id` e o aviso "sincronize, não reenvie" |
| TPL-P1-01 | Chamada à Meta sem tempo limite | CONCLUÍDO: limite de 15 s (`AbortSignal.timeout`), retorno `timeout` |
| TPL-P1-02 | Log gravava o corpo bruto da Meta; `res.json()` falhava com HTML | CONCLUÍDO: o log guarda só status e código; parse tolerante; resposta sem `id` é tratada como erro |
| QA-P1-01 / C2 | Duas edições de cota ao mesmo tempo: a última vencia | CONCLUÍDO: controle otimista por `updated_at`; retorno `conflict`. Não precisou de SQL |
| A1, A2, A3, B2, B3, C3, D1–D3, E | Itens restantes da missão | NÃO INICIADO nesta rodada |

## 4. Arquivos alterados
- `src/server/whatsapp-pix-intents.server.ts` (L478–479)
- `src/server/whatsapp-meta-template-submission.server.ts` (tipo de resultado, timeout, logs, persistência)
- `src/server/whatsapp-quota-admin.server.ts` (erro `conflict`, leitura de `updated_at`, update condicional)
- `tests/whatsapp-pix-favorecidos.test.ts` (asserção do valor)
- `tests/whatsapp-estabilizacao-c1-c2.test.ts` (novo, 5 testes)

## 5. Testes
- Novo arquivo: 5/0. `whatsapp-pix-favorecidos` isolado: 23/0.
- Suíte oficial `node scripts/test-whatsapp.mjs`: **167 arquivos, 2.912 aprovados, 0 falhas**, rc=0, 71,9 s.
- Build automático: OK (14:19:40Z). Typecheck manual: não executado.
- Rodar vários arquivos juntos fora do runner oficial gera falhas por conflito de mocks (F-07, já conhecido). Isso não é regressão.

## 7. Riscos restantes
- `persist_failed` e `conflict` são novos retornos. A tela de admin mostra o código, mas não tem mensagem própria para eles.
- Resposta não entregue após gasto salvo (A1) continua sem recuperação.

## 8. Migrações
F2, UNDO e F4 continuam só como candidatas. O SQL de Compras continua sem versionamento. Nada foi aplicado.

## 9. Cobertura
Sem mudança em relação à FASE 2: faltam `whatsapp.server.ts` (6.185 linhas) e `whatsapp-agenda.server.ts` (577 linhas).

## 11. Próximo pacote sugerido
1. A1: reenvio controlado de respostas não entregues.
2. B2: versão da sessão nos botões.
3. D1: comparar os candidatos com o HEAD.
4. Etapa E: leitura do que falta.

## 12. Créditos
Não consigo confirmar o consumo exato de créditos.

| Área | Antes | Depois | Testes | Pronto para publicar? |
|---|---|---|---|---|
| Pix legado 100× | bug latente | corrigido | 23/0 | Sim, após revisão (CONCLUÍDO) |
| Template Meta | sucesso falso, sem timeout | corrigido | 4/0 | Sim, flag continua OFF (CONCLUÍDO) |
| Cotas admin | última edição vence | conflito detectado | 1/0 | Sim, após revisão (CONCLUÍDO) |
| Reenvio de respostas (A1) | sem recuperação | igual | — | NÃO INICIADO |
| Botões/sessão (B2) | — | — | — | NÃO INICIADO |
| F2/UNDO/F4 (D1) | candidatos | igual | — | BLOQUEADO (autorização) |
