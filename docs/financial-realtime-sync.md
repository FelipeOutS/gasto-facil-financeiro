# Sincronização financeira entre dispositivos

## Implementação

Base: main `a0da9456` (PR #7 mergeado). Branch: `feat/financial-realtime-sync`.

O Dashboard lia snapshots da store sem observar gravações de outros clientes. A recuperação de Gastos ao entrar na rota não atualizava um Dashboard já aberto nem as receitas.

O ActiveAccountProvider inicia um único hook depois da hidratação da conta ativa. O canal assina somente INSERT e UPDATE de gastos e receitas, com filtro `user_id=eq.<activeOwnerId>`. A identidade do ator também faz parte do ciclo de vida. Payloads não são inseridos na store: eventos solicitam SELECTs autenticados sujeitos às políticas existentes de RLS.

O serviço reúne eventos por 350 ms, evita consultas simultâneas e agenda uma leitura posterior quando chegam eventos durante uma consulta. Os refreshes da store compartilham consultas por entidade e geração da sessão. Erros preservam os últimos dados válidos; leituras suspensas expiram em 15 segundos sem publicar respostas tardias. Troca de conta/logout cancela listeners e timers, remove o canal e invalida callbacks/respostas da geração anterior, inclusive A → B → A.

`refreshReceitas()` mantém `deleted_at IS NULL`. `refreshGastos()` não exige essa coluna em gastos. `refreshFinancialCore()` atualiza as duas entidades. O Dashboard e seus filtros de mês não foram alterados.

## Foreground e DELETE

visibilitychange para visible, focus, pageshow, online e SUBSCRIBED/reconexão solicitam recuperação das duas entidades. Eventos próximos compartilham o mesmo debounce.

Não há subscription DELETE nem wildcard. Não assumimos que filtros de DELETE, replica identity e a autorização do ambiente ofereçam as mesmas garantias dos eventos INSERT/UPDATE. Exclusões físicas são recuperadas pelo SELECT ao voltar ao primeiro plano/reconectar. Um usuário que permaneça continuamente em primeiro plano pode ver uma exclusão física desatualizada até esse refresh. Soft delete de receitas chega como UPDATE quando autorizado pelas políticas; eventos não entregues também são recuperados pelo foreground.

Referência: https://supabase.com/docs/guides/realtime/postgres-changes

## Android verificado, sem alteração

Emulador `emulator-5554`, app real `com.gastointeligente.app`, WebView em `https://gastointeligente.com.br/app`. Foi instalado temporariamente um listener de diagnóstico via DevTools, sem ler dados financeiros ou credenciais. Após KEYCODE_HOME e retorno à MainActivity, os eventos observados foram:

```json
[{"event":"visibilitychange","visibility":"hidden"},{"event":"visibilitychange","visibility":"visible"}]
```

Os listeners de diagnóstico foram removidos. A Activity já chama WebView.onPause/onResume. Nenhum arquivo Android foi modificado e assembleDebug não foi necessário. Esse teste verifica o lifecycle do WebView; não representa implantação da nova sincronização em produção.

## Migration e validação

`20260924140000_financial_realtime.sql` adiciona apenas gastos e receitas ausentes em supabase_realtime. Não usa SET TABLE, não altera RLS, replica identity ou RPCs. Pressupõe a publication existente, conforme ambiente informado. Não foi aplicada remotamente.

103 testes em 11 arquivos: sincronização (14), migration PostgreSQL/PGlite (1), hidratação de contas (6), corridas de sessão (3), escrita offline por proprietário (17), idempotência offline de gastos (9) e receitas (5), soft delete/valores de receitas (15), exportação de gastos (16), parcelamento/store (14), formulário de gastos recorrentes (3).

A suíte nova executa store e serviço reais com transporte Supabase simulado; cobre INSERT, UPDATE, rajadas, evento durante SELECT próprio ou iniciado pela página, timeout, foreground sem websocket, logout, troca de conta, soft delete e callbacks antigos. Um teste monta o componente real do Dashboard, com widgets periféricos/sessão simulados, e confirma totais atualizados e preservação do mês selecionado. O teste SQL executa a migration duas vezes e verifica que a tabela previamente publicada continua presente.

Pendências: aplicar a migration na etapa de publicação e validar a entrega Realtime entre dois clientes autenticados no Lovable Cloud. Nenhum teste gerou transações financeiras de produção.

Typecheck: node node_modules/typescript/bin/tsc --noEmit concluído com exit code 0.
