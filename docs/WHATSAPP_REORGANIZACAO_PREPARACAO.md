# Reorganização reversível — preparação local, não liberada

## Estado
**Parecer mais recente (03/11, continuação final): núcleo candidato ampliado e aprovado em testes isolados; fluxo completo ainda NÃO pronto.** As seções históricas abaixo descrevem estados anteriores; o fechamento ao final substitui suas pendências quando explicitamente indicado.
Não é uma funcionalidade concluída nem pronta para ativação. O WhatsApp existente continua com seus serviços de áudio e autorização; pedidos novos de limpeza composta são interceptados sem gravar valores. Nenhuma migração, mudança de configuração, publicação, envio Meta ou exclusão financeira real foi realizada.

## Preparado
- Interpretador conservador para gastos/receitas, períodos com ano, meses anteriores, exceções/negações e receita posterior; utiliza `parseValor` central. Datas incompletas pedem esclarecimento; saldo inicial não vira receita.
- Contrato injetado de prévia, confirmação exata APAGAR + seis dígitos, cancelamento, resultado persistido e timeout sem alegar sucesso.
- SQL candidato `docs/migrations-candidate/whatsapp-reorganizacao.sql`: política ausente/desligada bloqueia execução; snapshots completos, ownership/vínculo/plano, expiração, exclusão com marcadores F2, receita na mesma transação e restauração por snapshot/stamp. O candidato não modifica o guard F2 e foi executado somente em PostgreSQL descartável.
- Códigos são exclusivos por titular/telefone e não reutilizados; confirmação busca o código exato, evitando cobrar tentativas de uma solicitação nova por código antigo. Falta limitação persistente de tentativas vinculada à operação antes da liberação.
- Restauração parcial preserva conflitos; SQL permite consultar/restaurar por referência explícita via controle interno. O adaptador e a conversa bloqueiam restauração até existir prévia/confirmacão própria; não desfazem a última operação implicitamente.

## Testes
134 testes em nove arquivos passaram quando executados separadamente: interpretação/pipeline novo (35), áudio (27), lote mensal (21), exclusão antiga (10), leitores F3 (5), atualização financeira (14), isolamento offline (17) e idempotência de receita offline (5).
Uma execução conjunta apresentou três falhas por colisão de mocks globais (query simulada sem `.order`); execução separada de todos os arquivos passou. Não é prova de funcionamento em produção.
31 verificações SQL locais passaram, incluindo F2 coerente, nenhuma exclusão física, operação composta/rollback, expiração/cancelamento, replay, ownership, cartões bloqueados, restauração parcial e duas conexões com aplicação única.

## Bloqueios de conclusão
1. **Barreira offline:** `offlineWriteDecision` é apenas contrato puro testado. Ainda não há geração persistente nem integração nos escritores/filas. Não impede sozinho que itens antigos reapareçam. Liberação proibida antes disso.
2. **Vínculos financeiros:** o candidato recusa todo escopo com cartões, parcelas, recorrências, bens, contas a pagar, importações ou Pluggy. Ainda não limpa essas estruturas; não anunciar reinício completo.
3. **Saldo inicial:** bancos são metadados; saldo do Dashboard é fluxo mensal. Novo modelo contábil requer decisão/revisão antes de escrever qualquer saldo. Não inventar receita substituta.
4. **Conversa completa:** esclarecimentos/edição da prévia, sessão persistente por operação, seleção de histórico, confirmação própria para restauração e envio de resposta reconciliado ainda precisam integração. Não liberar apenas alterando uma constante.
5. **Segurança e escala:** contratos JSON estritos/status específicos e tentativas precisam revisão adicional; locks conservadores de tabelas exigem testes de carga/deadlock. Recuperação parcial deve ter histórico por item e apresentação detalhada antes de uso.
6. **Atualização:** filtros e Realtime gastos/receitas foram reaproveitados/auditados, não alterados. Atualização dos demais módulos e funcionamento Android não comprovados. Wrapper nativo não está no repositório.
7. **Homologação:** não houve chamada real de IA/transcrição/WhatsApp nem fluxo autenticado de escrita no Preview; todas as mutações verificadas usam dados fictícios locais.

## Próxima autorização
Antes de qualquer alteração no banco real, apresentar revisão completa do candidato, pré-requisitos F2/F4 e plano de rollout. Ativação/publicação e teste financeiro real continuam exigindo autorizações separadas. Nenhum prazo de recuperação definitivo foi prometido. Consumo real de créditos não confirmado.

## Continuação implementada em 03/11/2026 (não liberada)
### Implementação concreta
- Restauração conversacional no contrato injetado: pedido com ID do lote gera prévia/código; RESTAURAR + ID + código chama o controle seguro. Restauração sem ID/código é rejeitada também pelo SQL candidato. Validade cinco minutos, cinco tentativas por operação, replay sem repetição. APAGAR no SQL também exige ID da operação. A conversa de produção permanece interceptada e sem escritor.
- Reversão da receita composta avalia seu próprio snapshot, independentemente de conflitos em outros registros; reversão parcial informa quantidades. Helper candidato detecta vínculos reversos com bens e contas, além de Pluggy; cartões/faturas/parcelas/recorrências continuam recusados, nunca desvinculados ou reconstruídos por heurística.
- Filas de gastos/receitas persistem versão financeira imutável e a repassam aos writers existentes. SQL candidato financial-offline-generation.sql bloqueia inserts/updates de operações offline de versões anteriores e restauração por cliente; controle efetivo de identidade impede bypass por GUC. Incremento acontece na transação de limpeza. Erro específico mantém pendência local e impede retry automático contínuo. Cache monotônico invalida snapshot quando recebe versão nova.
- Saldo inicial: parser e cálculo puro em centavos separados de receitas, contrato de baseline no fim do dia informado. SQL candidato account-opening-balances.sql valida titular da conta, valor, idempotência e recusa substituição silenciosa. Helper não é executável nem por service_role; sem persistência real ou ligação aos indicadores.
- Locks da aplicação/restauração adquirem tabelas antes do advisory lock para reduzir inversão com trigger de INSERT; isso não substitui testes de carga/deadlock.
### Arquivos alterados/criados nesta continuação
- src/lib/account-opening-balance.ts; src/lib/whatsapp-reorganizacao.ts.
- src/server/whatsapp-reorganizacao.server.ts; src/server/whatsapp-reorganizacao-store.server.ts.
- src/lib/offline/financial-generation.ts; offline-expense-queue.ts; offline-income-queue.ts; use-offline-sync.tsx; use-offline-income-sync.tsx; offline-error-messages.ts (os cinco últimos no mesmo diretório).
- src/lib/store.ts (campo candidato opcional de versão, sem mudar o schema gerado).
- docs/migrations-candidate/whatsapp-reorganizacao.sql; financial-offline-generation.sql; account-opening-balances.sql.
- tests/whatsapp-reorganizacao-safety.test.ts; tests/offline-financial-generation.test.ts; tests/sql/whatsapp-reorganizacao/00-stub.sql; 10-tests.sql; 20-balance.sql; scripts/test-whatsapp-reorganizacao-sql.sh.
- AGENTS.md; roadmap.md; este relatório.
### Resultados finais
- 164 testes JS em 14 arquivos, executados separadamente: 0 falhas finais. Incluem áudio/lote, pipeline bloqueado, saldo 5000 distinto de receita, confirmação, idempotência, isolamento offline, leitores F3 e atualização do Dashboard.
- 49 verificações SQL aprovadas em PostgreSQL descartável, incluindo duas conexões (uma aplicação e um replay), código obrigatório por lote, tentativas, bloqueio de versões offline antigas, conta compartilhada sem bypass, baseline 5000 sem receita, vínculos com bens. Execuções intermediárias falharam por assinatura de RPC de teste e variável SQL ambígua; corrigidas e reexecutadas com sucesso.
- Navegador Chromium: filas reais IndexedDB persistiram após reload, versões não foram reetiquetadas, outro titular não leu a fila; nenhuma chamada de sincronização financeira. Nenhum erro de página capturado. Isso não é teste no Android real nem homologação autenticada da operação financeira.
- Compilação automática final OK. Erro intermediário de tipos do campo de schema candidato corrigido sem editar tipos gerados.
### Pronto para homologação isolada
Contratos de prévia/confirmação/restauração; rejeição offline pelo trigger candidato; baseline candidato separado; regressões de áudio e soft-delete. Homologação precisa backend descartável com schemas aprovados, sem usar dados reais.
### Bloqueios remanescentes e ação exata
1. Aplicação dos candidatos não autorizada/executada. Revisar F2/F4 e três candidatos, grants/guards e dependências no schema real antes de autorizar migração; não ligar limpeza mensal.
2. Geração ainda não é carregada do servidor em cada hidratação/reconexão; cache não cria autoridade. Clientes sem versão serão bloqueados após a primeira limpeza. Falta integrar leitura autorizada para contas próprias/compartilhadas, atualização de caches e todos os escritores NÃO offline (importações, recorrências, OCR, filas WhatsApp). A barreira entregue cobre writes offline versionados, não todo o sistema.
3. Vínculos com cartões/faturas são preservados por recusa, não por limpeza/restauração do grafo. Falta executor contábil transacional específico, snapshots de dependências, política de pagamentos, importações e recorrências. Helper dinâmico de dependências requer revisão de locks contra criação concorrente de vínculos. Não anunciar reset completo.
4. Baseline não está ligado a banco escolhido na conversa, confirmação/limpeza atômicas ou telas de saldo. Falta atribuição de movimentações a contas e data/hora de corte; o cálculo puro usa somente movimentos após o fim do dia e não substitui o Dashboard mensal. Comando final composto continua bloqueado sem cadastrar receita nem saldo.
5. Restauração permanece apenas no contrato injetado e candidatos; produção não tem sessão/executor conectado. Faltam histórico/seleção de operação, prévia detalhada de conflitos, reconciliação da resposta WhatsApp, limites cumulativos de renovação de códigos, teste de mudanças de plano/vínculo concorrentes e carga/deadlocks. Não prometer prazo definitivo de recuperação.
6. Android: fonte nativa/Gradle/Kotlin e aparelho não disponíveis. Verificação de IndexedDB no Chromium não prova Keystore, WebView real, reinício do app ou bridge biométrica. Necessário wrapper Android e aparelho de homologação.
7. Skills: diretório de skills ativas não disponível no ambiente; nenhuma skill ativa pôde ser aplicada. Auditoria independente e testes usados, sem afirmar execução de skill inexistente.
8. Liberação/publicação e teste real exigem autorização separada após homologação completa; nenhuma migração, exclusão real, publicação, envio Meta ou alteração de configuração foi realizada. Créditos desta execução não confirmados.

## Fechamento da continuação 03/11 — resultados que substituem os estados anteriores
### Implementado e testado, somente candidato/local
- Compras simples de cartão com competência explícita e fatura aberta podem entrar no candidato transacional; compras pagas, parcialmente pagas, com evidência de pagamento, parcelas, recorrências e vínculos incompatíveis são recusadas. Cartões, faturas e pagamentos permanecem fisicamente intactos. A prévia calcula total derivado e limite estimado; não afirma alterar saldo bancário/limite do emissor.
- Comando composto de exclusão e saldo inicial reconhece Nubank e R$ 5.000 sem criar receita. SQL candidato resolve banco único do titular, valida snapshot, exclui reversivelmente e grava baseline na mesma transação. Falha do baseline desfaz a exclusão inteira. Desfazer revoga baseline; conflito em operação composta impede revogar baseline isoladamente.
- Baseline aparece separado em Dashboard, Guardado e Relatórios quando o schema candidato está disponível; schema ausente não inventa saldo zero. Não é saldo bancário atual calculado e não altera resultado mensal, receitas ou reservas. Restrito ao titular autenticado.
- Hidratação/reconexão das filas próprias leem versão do servidor; filas antigas conservam versão original. Candidato `financial-universal-fence.sql` bloqueia escritores legados de gastos/receitas após reset, inclusive service_role. O nome não significa cobertura integral: módulos vinculados e contratos dos demais escritores continuam pendentes.
### Arquivos desta etapa
- `src/lib/account-opening-balance.ts`, `whatsapp-reorganizacao.ts`, `reorganization-card-accounting.ts`, `account-balances.functions.ts`.
- `src/server/whatsapp-reorganizacao.server.ts`, `whatsapp-reorganizacao-store.server.ts`.
- `src/components/AccountBaselines.tsx`; `src/routes/app.tsx`, `guardado.tsx`, `relatorios.tsx`.
- `src/lib/offline/financial-generation-reader.ts`, `use-offline-sync.tsx`, `use-offline-income-sync.tsx`; `src/lib/store.ts`.
- Candidatos SQL: `whatsapp-reorganizacao.sql`, `account-opening-balances.sql`, `reorganization-card-accounting.sql`, `financial-universal-fence.sql`.
- Testes: `reorganization-card-accounting.test.ts`, `reorganization-compound-balance.test.ts`, `financial-generation-reader.test.ts`, `whatsapp-reorganizacao.test.ts`; fixtures SQL `05-account-card-stub.sql`, `20-balance.sql`, `30-compound-card.sql`, `40-universal-fence.sql`; harness `scripts/test-whatsapp-reorganizacao-sql.sh`.
- `AGENTS.md`, `roadmap.md`, este relatório.
### Verificação final
- **193 testes JS em 21 arquivos, zero falhas**, executados separadamente para evitar colisão de mocks. Incluem 60 regressões de áudio/transcrição/duração, contratos injetados, regras de saldo, cartões, filas, identidade, atualização financeira e Android web.
- **65 verificações SQL, zero falhas**, PostgreSQL descartável: F2, confirmação, replay/duas conexões, rollback, titular, baseline R$ 5.000 sem receita, cartões não pagos, recusa de pago/parcial e versões legadas. Falhas intermediárias de aliases SQL corrigidas antes da execução final.
- Chromium carregou interpretador real do Preview e validou comando composto: `income=null`, baseline 500000 centavos e banco Nubank, sem erro de página. Isso verifica parsing, NÃO áudio real nem fluxo autenticado de gravação. Evidência de IndexedDB anterior continua restrita ao Chromium.
- Compilação automática final registrada `build OK`. Nenhum build/typecheck manual executado nesta etapa.
### Bloqueios e critério de prontidão
1. Não há contabilidade completa de estorno de pagamentos, parcelas/recorrências/importações e módulos vinculados: estes permanecem bloqueados. Não liberar reset completo usando apenas o executor restrito.
2. Não existe atribuição canônica de gastos/receitas a contas bancárias; baseline é informativo separado, não saldo corrente calculado. Necessário contrato de movimentos/corte por conta antes de integrá-lo à contabilidade corrente.
3. Barreira completa exige registro/migração de todos os escritores, inclusive compartilhados e não offline. O candidato atual pode bloquear fluxos legados, não os torna automaticamente compatíveis.
4. Sessão/executor de produção permanecem desconectados e flag false. Homologação autenticada com áudio real, confirmação, resposta reconciliada e restauração precisa ambiente isolado com schemas, sem dados de produção; não foi executada.
5. Wrapper/aparelho Android não disponíveis; evidência histórica de cliques WebView não homologa esta função. Necessários testes reais de offline, troca de conta, reinício, sincronização e confirmação em APK de homologação.
6. Candidatos não aplicados e não autorizados para produção. Sem migração, publicação, mensagens Meta, mudanças de flags/segredos ou dados reais. Consumo de créditos não confirmado.

**Parecer: apto para revisão/homologação isolada do núcleo restrito; não apto para ativação nem para prometer o fluxo financeiro completo por áudio.**
