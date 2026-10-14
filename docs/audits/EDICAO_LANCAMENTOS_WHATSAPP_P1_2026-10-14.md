# P1 — Edição de gastos e receitas antigos pelo WhatsApp (14/10/2026)

Não publicado. Sem migração, sem SQL em banco real, sem mudança em dados, flags, segredos ou Meta.

## Implementado
- `src/server/whatsapp-editar-antigo.server.ts` (novo): detector, filtro (mês/ano, hoje/ontem/anteontem, dia da semana, dd/mm, termo), busca (até 40 resultados, páginas de 8, lista interativa + número), seleção, menu de campos, comparação antes/depois, Confirmar/Ajustar/Cancelar.
- `src/server/whatsapp.server.ts`: chamada logo após as ações rápidas 1.2; início só sem sessão ativa; guarda antiga "edição indisponível" removida.
- Removidos `whatsapp-editar-lancamento.server.ts` e seu teste (substituídos).

## Segurança
- Leitura/escrita sempre por `user_id` do vínculo validado + `deleted_at IS NULL`.
- Estado em `whatsapp_messages.parsed` (kind `wa_edit_old`), uma linha por passo, `external_id` único (replay = dedupe).
- `nonce` novo a cada passo; botões antigos recusados; TTL 15 min; seleção guarda o ID real.
- Confirmar: grava passo `applying` antes do UPDATE (consome estado); UPDATE condicional `updated_at = snapshot` → alteração no site depois da seleção não é sobrescrita.
- Sucesso só depois do UPDATE retornar a linha.

## Editáveis
- Gasto simples (pix/débito/dinheiro/etc.): valor, descrição, data (atualiza mes/ano/invoice_month), categoria.
- Gasto no cartão de crédito: descrição e categoria.
- Receita (inclusive ocorrência de recorrência, só aquela linha): valor, descrição, data.

## Bloqueados (explicação + site/app)
Parcelados, gastos recorrentes, ligados a bens/financiamentos, valor/data de cartão de crédito, transferências, contas a pagar (fluxo próprio), lançamentos de contas conectadas.

## Testes
tests/whatsapp-editar-antigo-p1.test.ts: 20/0. Suíte oficial: 171 arquivos, 2.993 aprovados, 0 falhas. tsgo OK.

## Riscos
- Simulações não substituem teste no WhatsApp real.
- Controle otimista depende do gatilho `set_updated_at` (existe em gastos e receitas).
- Conta conectada não edita por aqui (restrição intencional).
