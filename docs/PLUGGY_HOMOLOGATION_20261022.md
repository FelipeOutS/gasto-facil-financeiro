# Homologação local Pluggy — validações de 22/10/2026

Fechamento e conferência dos artefatos: 23/10/2026.

Implementação e validação local concluídas nesta entrega. **Não equivale a homologação financeira em produção.** Não houve push, merge remoto, deploy, publicação, migração real, importação financeira real, ativação de automação ou alteração de segredos.

Branch: `codex/pluggy-homologation-20261021`. Diretório: `E:/Projetos/APLICATIVO GASTO INTELIGENTE/pluggy-homologation-20261021`.

## 1. Base conferida e trabalho concluído

A branch começou no PR #25, commit `058a0b9011367741f8f9aac4a780d07a6034345b`. Durante a retomada, a main remota avançou para **`7debf719894f6432856f63384afac42bc73006e3`**. Fiz fetch e fast-forward local, preservando o trabalho Pluggy. As quatro alterações recebidas são de cadastro/autenticação e documentação; não houve conflito. Outros worktrees foram preservados.

O GitHub foi conferido por Git. As alterações desta homologação permanecem locais: **ainda não são o código servido pelo Lovable**. Não confirmei independentemente o commit/build que o Preview está servindo. O endpoint de versão atual identifica o build por data, não pelo SHA Git; é necessário conferir a revisão no Lovable junto ao build após a futura sincronização.

### Instalação e compatibilidade

- Corrigido conflito real entre Zod 4 e o adapter antigo do TanStack, usando os schemas Zod diretamente nas rotas.
- Declarada `@testing-library/dom`, peer necessário aos testes React, em vez de depender de instalação avulsa.
- Corrigidas tipagens opcionais de search params expostas pela instalação limpa.
- Removidos aliases de `entities` que apontavam para arquivos inexistentes e quebravam o build.
- Regenerado o package-lock, que estava defasado em relação a várias dependências do manifest. O bun.lock foi sincronizado a partir dele. Isso envolve atualização do grafo transitivo; não foi apenas uma troca de duas linhas.
- `npm ci --no-audit --no-fund` terminou com código zero: 758 pacotes. Checagem frozen do bun.lock também passou. Nenhum uso de force/legacy-peer-deps ou alteração de segredos.

### Política contínua — exceção própria, desligada

A nova candidata `pluggy-continuous-policy.sql` prepara autorização contínua por **titular Felipe + role owner + instituição MP606 + conta individual**. A interface exige confirmação explícita; banco e código começam desligados. O consentimento expira em 90 dias. Ativar/renovar passa a considerar movimentações a partir do dia da confirmação, sem recuperar automaticamente períodos anteriores à renovação.

Categorias aceitas, somente com evidência estruturada suficiente:

- Compras no débito: operação bancária COMPRA/COMPRA_DEBITO.
- Rendimentos: RENDIMENTO/JUROS ou a combinação estrita de descrição/categoria/operação já conhecida do Mercado Pago. Resgate de principal não entra nessa exceção.
- Salário: operação SALARIO, sem indícios de empréstimo/adiantamento.
- Compras em cartão: vínculo confirmado e fatura bancária identificada, passando ainda pela validação do escritor de cartão existente.

Pix genérico, empréstimos, antecipações, reservas, transferências, câmbio, estornos, ajustes e dados ambíguos ficam em revisão. Classificação manual também bloqueia a automação. Nenhum cartão é vinculado automaticamente.

O titular escolhe categoria de despesas e limites. Tetos da candidata: R$5.000 por movimentação, R$20.000 por dia/conta e 100 movimentações diárias. Cada chamada processa no máximo 10 importações e examina até 200 candidatas. A janela de recuperação é limitada a 31 dias anteriores, respeitando o início do consentimento. Valores desfeitos não devolvem cota diária.

A RPC bloqueia concorrência por titular, trava/revalida a política, origem, consentimento, limites e vínculos, cria um grant literal transitório e chama o escritor de lote existente dentro da mesma transação. A função global `pluggy_assert_financial_release` permanece bloqueando os demais caminhos. Pausar usa o mesmo bloqueio: a confirmação da pausa aguarda uma transação já em execução; depois dela nenhum novo processamento é autorizado. Não cancela lançamentos que já foram confirmados.

Deduplicação: identidade de origem/grants/tombstones, histórico Pluggy, histórico Mercado Pago e suspeitas por valor/data nos gastos/receitas ativos de todas as origens. Uma suspeita não é automaticamente conciliada: vai para revisão. **Sem identidade bancária comum, correspondência por valor/data não constitui prova universal de duplicação**; operações ambíguas precisam de confirmação humana.

Há prévia sem escrita financeira, histórico, log de cada consentimento/revisão da política e auditoria das importações com origem/lote. O desfazer reutiliza o escritor já protegido contra edições manuais, com acesso pelo histórico da política, inclusive após sua pausa. A origem desfeita não volta a ser importada.

### Cartões, faturas, devoluções e estornos

Foram mantidos e testados os vínculos/cartões/parcelas já implementados no PR anterior. A importação usa a competência da fatura bancária e somente dados suficientes de parcelas, sem inventar parcelas futuras.

A nova candidata `pluggy-confirmed-settlements.sql` acrescenta:

- Pix adiantado vinculado explicitamente a uma Conta a Receber **já existente**, sem criar uma nova conta nem despesa.
- Devoluções parciais/totais limitadas ao principal vinculado e ao saldo pendente, sem gerar receita artificial.
- Estorno explicitamente vinculado à compra original: parcial reduz o valor; total faz soft-delete da compra, preservando o histórico.
- Baixa de fatura com cartão confirmado, competência correta, total local idêntico ao total bancário e pagamentos confiáveis. **A Pluggy informa os pagamentos da fatura anterior no ciclo seguinte**; a comparação usa essa relação, e não o total do ciclo seguinte.
- Baixa automática ambígua é recusada: cobranças/encargos diferentes de zero, pagamento parcial, moeda divergente, dados ausentes/antigos ou múltiplas faturas candidatas exigem revisão. Ajustes sem compra original confiável não são inventados nem importados como nova despesa.
- Confirmação da versão da origem e do destino; prévia antiga é rejeitada. Journal antes/depois, idempotência, bloqueio concorrente e desfazer sequencial preservando edições manuais.

A tela de conciliação permite escolher origem/destino, conferir prévia, confirmar e consultar/desfazer o histórico. Gravações estão bloqueadas. Snapshots de fatura também estão atrás de flag desligada. A lista é limitada a 300 transações recentes/300 destinos e 100 faturas/históricos; uma busca paginada maior não foi adicionada.

O caso dos **R$185 adiantados à mãe permanece somente como pendência de classificação**, sem registros reais nem fixture com esse valor. Os testes de devolução usam valores fictícios de 17, 5 e 12. Vincular esse caso exigirá escolher a movimentação real e uma Conta a Receber existente, mediante confirmação própria; esta entrega não cria essa conta.

### Webhook e worker

A fila durável, claim/lease, retry limitado, backoff e worker existentes foram preservados e testados. Corrigido o tratamento de item/deleted atrasado: consultar o provedor primeiro; item ainda existente não é apagado; somente HTTP404 confirma exclusão do item; HTTP500 provoca retry. Falhas não apagam staging nem lançamentos financeiros. Exclusões de transação continuam sendo revalidadas no provedor e preservam tombstones/histórico.

O hook contínuo foi ligado ao fim da sincronização, retornando antes de acessar escritores enquanto a flag estiver falsa. Não cadastrei webhook externo, cron ou worker remoto nem alterei tokens. A operação real desses serviços ainda precisa ser conferida no ambiente autorizado.

## 2. Testes e resultados

| Verificação | Resultado |
|---|---|
| Instalação limpa npm ci | Aprovada, 758 pacotes |
| Lock Bun frozen, sem instalar scripts | Aprovado |
| Typecheck tsc --noEmit | Aprovado |
| Build cliente/servidor | Aprovado |
| Suíte oficial isolada | **284 arquivos; 4.197 pass; 0 fail; 21 skip; 0 errors** |
| PostgreSQL nativo descartável 17.11 | **Runner completo aprovado; 42 etapas/checkpoints PASS** |
| Lint dos sete arquivos novos de aplicação, sem regra estética Prettier | 0 erros, 0 avisos |
| git diff --check | Aprovado |

Nove cenários concorrentes relevantes: claims da fila, importação genérica, desfazer genérico, lote real, política contínua, cota diária restante, worker esperando pausa, conciliação e desfazer de conciliação. São processos psql distintos, não simulação em memória. Outros testes SQL verificam permissões, release desligada, expiração, replays, origem alterada, exclusões, preservação manual e desfazer em sequência.

O runner cria um cluster novo em diretório temporário, com senha aleatória, SCRAM e porta dinâmica limitada a 127.0.0.1; ignora DATABASE_URL/PG* herdados, não conecta a Supabase e remove apenas seu próprio cluster ao terminar. O PostgreSQL portátil foi obtido da distribuição EDB e teve SHA256 conferido. Os esquemas financeiros de teste são fixtures compatíveis com as colunas usadas; não são um dump integral do banco real.

Comandos reproduzíveis, na raiz da branch:

~~~powershell
npm ci --no-audit --no-fund
npm run typecheck
npm run build
bun scripts/run-test-suite.ts
# PG_BIN deve apontar para os binários locais initdb/pg_ctl/psql.
bun scripts/test-pluggy-native.ts
~~~

Há avisos existentes de depreciação de inputValidator, empacotamento e scripts de dependências não aprovados pelo npm; não impediram os resultados acima. Lint global não foi reaprovado nem houve reformatação geral. Os 21 skips não contam como testes aprovados. A suíte E2E autenticada não foi executada: usa conta/configuração de QA e pode criar dados financeiros; não é compatível com autorização apenas local desta missão.

Logs locais: pluggy-clean-install.log, pluggy-lock-check.log, pluggy-typecheck.log, pluggy-build.log, pluggy-global.log, pluggy-native.log e pluggy-lint.log (ignorados pelo Git).

## 3. SQL candidato e hashes

**Nenhum SQL foi aplicado no banco real.** A tabela abaixo usa SHA256 do conteúdo normalizado LF, correspondente ao conteúdo Git. O manifesto `PLUGGY_SQL_MANIFEST_20261022.json` registra também SHA256 dos bytes locais, pois CRLF altera o hash do arquivo.

| Candidata | SHA256 LF |
|---|---|
| pluggy-open-finance.sql | `7aaada94111abc89de491ab408660bac83a0f85a4295b12b42b64ab1f78c29c8` |
| pluggy-webhook-claim-max-attempts.sql | `91b28f33369f7a25d979882dd238f041f660b636ac442ee899d8f728f89245de` |
| pluggy-amount-original.sql | `fa541ab04da9e3e7207b4c86c9bec096255e31a50781ce4b64787056c5585e06` |
| pluggy-import-gi.sql | `9a4816ffbb1f741f80d74e47a26fb8015af5682df7b148f32090e652f714a38a` |
| gastos-delete-atomic-f4.sql | `c74c77fd70bff15b9293fd53b2b5ca2e7f6a7f138f99454bb38d71c7cc9d7886` |
| pluggy-live-readonly.sql | `0b4058a06fe5e7575eebccc2ec530ac766a71a8d7a729c310fd572861af957d7` |
| pluggy-real-first-import.sql | `5266a5e4715035e0f1c3b79c0a0b51112daae8432c7a34440e69fe826a5899e9` |
| pluggy-real-batch-import.sql | `3038a110b183d1c5d6ca867172c0ab2eb51880a90a6dc18f0e37fe3865bdc2c0` |
| pluggy-real-batch-partial-undo.sql | `a4b76f430d28f9641f28f864e0242ba38196eb580fdbc3ed16350291b5e9514e` |
| pluggy-real-automatic-closed-batch.sql | `1cfc2afb42b9816ae518872c7f1d474d2f1dbff82f10427026116d92050469e7` |
| pluggy-real-card-links.sql | `e4ccdd6d843538887fdcc0188f530ee33d48470791a5cc94fb9a74d373d1d183` |
| pluggy-real-card-batch.sql | `26952baa5b642fbb5e02598d7183bf9be77262896e4fc402f9e88f36c670bec4` |
| pluggy-continuous-policy.sql (nova) | `fc184287e16b137e6db8e8b1c94ecaa166bcd32649feb6c8740178d9efcb8063` |
| pluggy-confirmed-settlements.sql (nova) | `e325418558e08502cf63cb0072816754e76e0c46366e4f9bce6475e2e925dd80` |

Somente as duas candidatas indicadas como novas foram criadas nesta entrega. As demais são dependências anteriores exercitadas no PostgreSQL nativo. Não reaplicar CREATE TABLEs já existentes: antes da execução autorizada, conferir o schema implantado. A proteção F4 é candidata própria e exige sua aprovação específica se ainda estiver pendente.

## 4. Código necessário para futura publicação

- Dois lockfiles, manifest, correções de rotas/search e Vite para instalação/build reproduzíveis.
- PluggyContinuous + continuous.functions/policy + hook servidor.
- PluggySettlements + settlements.functions/helpers.
- Snapshot de fatura no cliente API/store/sync, atrás das flags.
- Revalidação de item/deleted no webhook.
- Inclusão dos componentes na tela Open Finance.
- SQL candidato, runner PostgreSQL, fixtures/testes e este relatório.

Não se deve transportar apenas os componentes TSX: sem servidores, dependências e schema compatíveis, a interface fica indisponível. Código enviado ao GitHub/Lovable não aplica automaticamente as candidatas em docs.

## 5. O que depende do Preview

- Confirmar revisão Git, build servido e carregamento das duas telas com o titular logado.
- Validar middleware/owner/RLS reais, schema cache e respostas RPC, sem usar uma exceção local para assinatura/autenticação.
- Conferir payloads reais do MP606: códigos de operação, sinal, identificadores de cartão/fatura, parcelas, datas e pagamentos do ciclo seguinte. Casos fora da política devem continuar em revisão.
- Exercitar erros de rede, resposta perdida, duplo clique, expiração, pausa e desfazer em ambiente de homologação isolado; sem criar transações reais sem aprovação própria.
- Conferir Android/celular: legibilidade, seletores, consentimento, prévia, histórico, retorno do banco e reconexão.
- Verificar entrega autenticada de eventos e scheduler autorizado. Teste local de fila não comprova a configuração externa.

## 6. Aprovações específicas ainda necessárias no banco real

1. Aprovar o conjunto exato de candidatas por hash e conferir quais dependências já existem.
2. Aprovar separadamente a exceção contínua e a conciliação; ambas nascem desabilitadas.
3. Autorizar posteriormente a liberação específica no banco e as flags correspondentes no código. **Não liberar a trava global.**
4. O titular deve confirmar sua própria política por conta/categorias/limites e, separadamente, o vínculo de cada cartão/destino de conciliação.
5. Qualquer teste com dinheiro/lançamento real exige aprovação própria; nenhum ID ou caso citado neste relatório é uma autorização de escrita.

Segredos permanecem sob administração do responsável; não foram alterados nem precisam ser enviados no chat.

## 7. O que ainda impede automação contínua real

As alterações ainda são locais; as candidatas novas não estão aplicadas; flags de escrita, snapshots e importação de cartão permanecem falsas; releases SQL começam falsas; não há consentimento criado por esta missão; não foi homologado o payload/worker real. Esses são bloqueios intencionais, não substituídos por grants amplos.

Além disso, fonte sem metadados seguros, suspeita de duplicação, cartão não vinculado, parcelas incompletas, limite atingido, política expirada/pausada, conexão inválida ou origem editada **devem continuar bloqueando aquela movimentação** mesmo após a liberação. Encargos/ajustes ambíguos e conciliação inexata continuam manuais. Não declaro importação universal de todas as transações nem homologação real concluída.

## 8. Ordem mínima para publicação, ativação e celular

1. Revisar este diff e autorizar push/PR. Depois, revisar e autorizar merge/sincronização Lovable; conferir o SHA, sem publicar automaticamente.
2. Em homologação isolada, aplicar somente dependências ausentes e aprovadas: estrutura/fila/amount_original/import-gi/live/first → lote → partial-undo → vínculos → card-batch → política contínua e conciliações. A automação antiga de lotes fechados não precisa ser ativada para usar a nova política. F4 e ajuste de max-attempts têm aprovação própria.
3. Homologar Preview com releases falsas: leitura, telas, identificação do titular, bloqueios, histórico e erros. Conferir permissões e atualização do schema cache.
4. Autorizar publicação do código inicialmente bloqueado, se o Preview estiver aprovado. Publicação não significa ativação financeira.
5. Após aprovação específica, liberar apenas a política contínua no código/banco e permitir que o titular confirme uma conta MP606 com limites pequenos. Para cartões, antes disso homologar flags de leitura/snapshots, dados da fatura e vínculo confirmado. Para conciliações, usar a release própria. Manter a trava global e flags antigas fechadas quando desnecessárias.
6. Autorizar e configurar webhook/worker/agendamento gradual. Validar uma movimentação elegível previamente aprovada, comparar origem e destino e confirmar retry sem duplicação.
7. No celular, conferir os valores em conta/receita/despesa/fatura, pausar, verificar que não importa após a pausa, testar reconexão e desfazer autorizado preservando edição manual. Só ampliar categorias/limites após essa conferência.

## Referências de implementação

- [Pluggy — Credit card bills](https://docs.pluggy.ai/en/docs/products/credit-card-bills): relação entre fatura anterior, encargos e pagamentos do ciclo seguinte.
- [Pluggy — List bills](https://docs.pluggy.ai/en/reference/bill/bills-list).
- [TanStack Router — Search params](https://tanstack.com/router/latest/docs/guide/search-params): validação direta com Zod.

**Créditos:** não consigo confirmar o consumo real de créditos desta execução.
