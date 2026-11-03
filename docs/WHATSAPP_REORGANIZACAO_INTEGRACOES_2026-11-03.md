# Integrações pendentes — resultado da execução 03/11 23:40 UTC

**Parecer: avanço parcial, NÃO pronto para homologação integral nem ativação.** Não foi repetida a auditoria geral. Foram modificadas integrações específicas, preparados candidatos e executados testes fictícios. Nenhuma migração de produção, mudança de dados reais, segredo, configuração, flag existente, publicação ou envio Meta.

## Tabela exigida

| Pendência | Status real | Testes/evidência | Impedimento remanescente |
|---|---|---|---|
| Todos os writers financeiros | Parcial; não concluído | Novo `financial_group_write` valida JWT/titular/plano, geração, operação e payload; journal protegido; chamadas service_role negadas; SQL isolado | Writers legados, compartilhados, pagamentos e metadados vinculados ainda não adaptados. Quarentena continua necessária; não equivale a migração de todos os 93 pontos do inventário. |
| Parcelas | Candidato de criação atômica | Duas parcelas de R$ 35 criadas juntas, grupo preservado; replay sem duplicação; falha de outra linha desfaz operação inteira | Criação WhatsApp via RPC existente e exclusão/restauração do grafo completo não migradas. Escopos parcelados continuam recusados pelo reset. |
| Recorrências | Candidato parcial | Criação de receita de R$ 0,01 com recurrence ID preservado; falha na segunda ocorrência não deixa primeira/journal; rejeição de saldo replicado | Metadados, scheduler, edições por série e wrappers WhatsApp existentes ainda exigem adaptação transacional. Não libera exclusão/restauração de série. |
| CSV/PDF/imagem de fatura | Caminho de confirmação corrigido | Os três formatos usam `addGastosBulkAwait`; um insert atômico; sucesso somente após confirmação; 6 testes do store real com persistência fictícia, incluindo timeout, replay, tombstone e troca de sessão | Manifesto está em memória; fechar/reabrir ou reiniciar perde essa retenção. Deduplicação de arquivo diferente/conteúdo igual e reversão integral não homologadas. Candidate SQL não aplicado e flag nova false. |
| Extrato CSV/PDF/imagem | Contrato existente preservado; candidato restrito por linha | 16 regressões da importação de extrato atômica passaram; quatro formatos/kinds de criação no SQL candidato passaram | `import_extrato_atomic` ainda não recebe contexto de geração para transferências/histórico. Sua reversão antiga é incompatível com tombstones; não habilitada por bypass. |
| Atribuição bancária | Serialização, modelos, referência e campos candidatos integrados parcialmente | Banco UUID + instante explícito; valida titular; offline duplicate proof inclui banco/instante/geração; rejeita crédito e expansão de série | Campos novos invisíveis com gate false. Formulário inline e edição de Receitas, edição de Gastos, pagamentos/importadores e conta compartilhada não integrados integralmente. Bancos legado com alias não convertido automaticamente. |
| Conciliação/saldos | Proteções corrigidas; cobertura integral não concluída | Corrigidos instante com timezone, futuros, overflow, leitura truncada/paginada e ledger parcial; 3000 + ajuste 2000 = 5000 sem receita; SQL de exclusão não apaga fato | Baseline histórico ainda não gera fato opening; leitura agora recusa esse ledger incompleto em vez de apresentar saldo errado. Falta cutoff/timezone contábil, compensação histórica e snapshot consistente entre páginas. |
| Falhas, duplicidade, isolamento | Executados no escopo candidato | 163 testes JS finais em 20 arquivos e 114 verificações SQL. Replay, payload diferente, falha intermediária, generation stale, owner/JWT, service role, timestamps e crédito | Não prova todos os writers. Concorrência anterior aplica/replay permanece testada; carga/deadlock dos novos grupos e schema integral isolado não homologados. |
| WhatsApp Meta | Recursos existentes identificados; teste real NÃO executado | Credenciais de acesso/app presentes, scripts e regressões de áudio existentes; número oficial já validado/usado, não precisa revalidar | Não há evidência de backend/número/callback isolados apropriados para teste destrutivo. Presença de segredo não comprova validade/routing. |
| Android | Testes web executados; nativo indisponível | 11 testes OAuth/privacidade/storage + 33 testes áudio; Playwright executou módulos reais no localhost, gate false, zero page errors | Sem SDK, Java, Gradle, adb/emulador, fonte nativa ou APK no ambiente. Não afirmar homologação Android com Chromium. |

## Mudanças concretas

- `ImportFaturaDialog` passou de sucesso otimista para confirmação aguardável, com proteção a duplo clique e mesmo operation ID após erro. Preserva parcelas e vínculos; não usa o importador de extrato que força tipo único.
- `financial-import-transport.ts` confirma manifesto inteiro após erro retornado ou exceção de conexão. IDs, titular, valores e vínculo devem coincidir; não reescreve editados nem reinjeta excluídos.
- Candidato `financial-group-writer.sql`: criação restrita a gastos/receitas, usuário próprio com plano ativo, default bloqueado, journal imutável, tabelas/colunas fechadas, sem marcador de bypass do reset. Banco/categoria/cartão validados; cliente/fornecedor ainda bloqueados nesse candidato. Não altera RPCs produtivas.
- `financial-cash-input.ts`, tipos e builders carregam a atribuição explícita. `FinancialCashField` está ligado aos formulários reutilizáveis, mas invisível enquanto `FINANCIAL_GROUP_WRITER_AUTHORIZED=false`. Nenhuma funcionalidade bloqueada foi ativada.
- SQL candidato de captura bancária agora serializa com conciliação/reset, impede mudança de banco/instante já capturados e impede edição de valor junto com exclusão. O fato registra delta, nunca valor integral repetido.
- Leitura de saldos usa fatos completos do titular, rejeita futuro e valores inválidos e não combina baseline com ledger parcial. Se houver baseline sem opening fact, retorna indisponível.

## Evidências e limites

Comandos executados: `bash scripts/test-whatsapp-reorganizacao-sql.sh`, arquivos JS separados com `bun test`, Playwright `/tmp/browser/pending-integration/check_integration.py`. O banco PostgreSQL é descartável por socket local e removido ao final; o harness limpa variáveis de conexão de produção.

**163 testes JS em 20 arquivos, 0 falhas finais; 114 PASS SQL.** Falhas intermediárias: mock RPC sem abortSignal no teste novo e guarda F3 exigindo revisão da nova exceção por tombstones. Corrigidos e repetidos com sucesso. Build automático final OK; sem build/typecheck manual.

Playwright executou código real dos módulos no navegador: resposta perdida → leitura → replay sem nova escrita, banco/instante preservados e gate false. A screenshot é página pública, NÃO tela financeira autenticada. O fluxo autenticado de escrita foi verificado apenas por store real com persistência fictícia e SQL com JWT/RLS fictícios; não no Preview financeiro real.

## Recursos já disponíveis — não solicitar novamente

- Número oficial WhatsApp validado e anteriormente utilizado; não precisa revalidá-lo nem recriar a integração oficial.
- Credenciais Meta de acesso/app presentes (valores não lidos/divulgados). Flags e IDs associados estão no ambiente; isso não comprova ambiente de homologação isolado.
- Auth e material de sessão do Preview presentes; não utilizados para executar operação financeira real.
- PostgreSQL local, Bun, PGlite, Playwright Chromium e scripts de conversa disponíveis.
- `scripts/build-android-offline.ts` gera apenas bundle JS offline, não APK.
- Fontes nativas/APK/SDK/aparelho não encontrados na busca limitada a projeto, uploads e temporários.

## Disponibilização específica dos recursos externos faltantes

1. **Ambiente isolado:** disponibilizar uma cópia de homologação com backend separado, dados exclusivamente fictícios e configuração separada. Não usar este Preview: compartilha backend com produção. Revisar/aplicar os candidatos apenas nesse ambiente autorizado; manter produção intacta.
2. **Meta:** usar número de teste ou número separado já disponível na conta Meta, se existir; confirmar o ID e callback desse número exclusivamente para homologação. Não alterar o callback/número oficial. Reutilizar as credenciais existentes somente depois de confirmar que permitem acesso ao número isolado; adicionar segredo de teste somente se realmente necessário, pelo cofre, nunca por código/chat.
3. **Conta fictícia:** cadastrar no backend isolado, conceder plano de teste pelo mecanismo existente, vincular telefone de teste e consentir. Fixtures: meses anterior/atual, parcelas/recorrências, cartão pago/parcial, bancos de dois titulares, saldo R$ 3000. Não conceder operações em produção.
4. **Android:** enviar fonte do wrapper (Gradle/Kotlin/manifest sem segredos) ou APK de homologação assinado apontado para o backend isolado; fornecer aparelho físico ou ambiente com Android Studio/SDK. Nesse ambiente, instalar Platform Tools, validar `adb devices`, instalar o APK com `adb install -r caminho.apk`; build pelo `./gradlew assembleDebug` somente se fonte fornecida. APK de produção não serve para testes destrutivos.
5. Após resolver as integrações internas da tabela, executar os passos já existentes em `WHATSAPP_REORGANIZACAO_HOMOLOGACAO.md`: áudio, prévia sem writes, confirmação por código, replay, restauração, fila antiga/reinício/offline/troca de conta, conferência autenticada em cada módulo, evidências de callbacks/hashes sem tokens. Nenhum desses testes reais foi executado nesta rodada.

## Créditos

A ferramenta informou **73 créditos acumulados no período 28/10–28/11/2026**. Isso não discrimina esta execução e não há baseline anterior comparável; **não consigo confirmar o consumo real desta execução**.

Não tratar bloqueios internos como apenas falta de publicação: existem contratos e integrações não concluídos. Homologação integral e ativação continuam proibidas até esses impedimentos serem resolvidos e testados.