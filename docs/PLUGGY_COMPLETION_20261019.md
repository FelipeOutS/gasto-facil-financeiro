# Pluggy — implementação local e entrega controlada

Início: 19/10/2026. Atualização: 20/10/2026. Branch `codex/pluggy-completion-20261019`, base remota verificada `91dd1dfd09205897bd21991daaaf9728489a9703`. Worktree isolada `E:/Projetos/APLICATIVO GASTO INTELIGENTE/pluggy-completion-20261019`. Alterações anteriores em outra worktree foram preservadas.

**Não é uma liberação de produção.** Nenhum push, merge, deploy, migração real, grant, conexão bancária ou ativação de worker/cron foi executado. Os controles financeiros continuam fechados. Não foi possível confirmar o consumo de créditos; a ferramenta não disponibilizou esse dado.

## Entrega por fase

| Fase | Implementação e evidência local | Limite / pendência |
|---|---|---|
| A — lote | Período de até 31 dias, seleção até 10 itens, valores/categorias/datas revalidados no servidor, lista exata conferida no SQL existente; desfazer parcial com lista pertencente ao lote, sem apagar edições manuais; histórico detalha os itens | Aplicação real da migração de lote não verificada. Nenhum lote autorizado nem executado |
| B — conciliação | Módulo reutilizável `reconciliation.ts`; identidade bancária exata confirma correspondência mesmo com edição de data; valor/data apenas levantam suspeita, inclusive entre fontes Pluggy reconectadas; consultas paginadas, sem truncar em 1.000 linhas | ProviderId entre reconexões ainda não é persistido como identidade universal. Coincidências entre integrações seguem para revisão |
| C — classificação | Preserva evidência de transferência própria na prévia; principal de empréstimo, adiantamentos e resgate de capital ficam em revisão; metadados incompletos de parcelas bloqueiam importação | Associação aprovada a Contas a Receber e conciliação automática de estorno com compra original ainda não implementadas. Nenhum registro de R$ 35/R$ 150 criado |
| D — cartões | Consulta real 606, comparação com cartões próprios, confirmação/desvinculação preparadas e bloqueadas; SQL rejeita Sandbox e outro titular; desvinculação não apaga histórico. API de faturas preparada; planejador exige billId e vencimento bancário para cartão real | Extensão candidata do lote fechado implementada e testada localmente: grant exato inclui cartão, billId e vencimento; rollback integral, replay e reversão testados. Exige homologação com faturas reais e aprovação da candidata antes de uso. Pagamento de fatura evita nova despesa, mas não baixa automaticamente a fatura |
| E — automático | Consumidor de autorizações de lotes fechados, Felipe+owner, opção expressa relida antes da gravação e novamente no SQL sob lock; não cria grants. Transações de webhook podem ser buscadas por IDs fora da janela inicial | Flag automática false. Não é autorização contínua para futuras transações; novos lotes exigem aprovação. UI e RPC de opt-in real separadas do Sandbox estão preparadas, desligadas. Política contínua para novas transações não foi liberada; o consumidor permanece restrito a lotes bancários previamente aprovados |
| F — fila | Mantida fila persistente, claim/lease, idempotência, backoff/limite; exclusão de staging agora limitada também ao item; erros persistidos aceitam apenas códigos conhecidos; IDs divididos em grupos de até 500 | Corridas entre sessões PostgreSQL não executadas neste ambiente. Eventos de exclusão consultam novamente os IDs no provedor; só marcam ausentes após resposta completa de item UPDATED, sem erro. Falhas não excluem staging. Isso não autoriza remoção financeira automática; corridas entre sincronizações ainda precisam de homologação |
| G — interface | Sandbox oculto por padrão; painel Sandbox separado; logo Mercado Pago, limite quando disponível, intervalo de prévia, histórico com seleção para desfazer, vínculos de cartões; erros não prometem rollback quando houve falha de rede | Sem validação visual autenticada nem teste real no celular nesta execução; histórico completo de falhas da fila ainda não aparece na interface |
| H — módulos | Usa `gastos`, `receitas`, `cartoes`, `extratos_importados` e trilha existente; nenhuma tabela financeira paralela; conciliação lê apenas ativos; reversão preserva edições | Reflexo ao vivo em Dashboard/Relatórios/Orçamentos depende da homologação autenticada. Não cria obrigações, investimentos ou metas automaticamente |
| I — segurança | Allowlist+owner, leituras por titular, escrita financeira inicial Felipe, 606 real, Sandbox sem vínculo real, flags falsas, SQL global intacto, funções novas sem execução por browser | Auditoria de RLS efetivamente instalada depende do banco real. Varredura local limitada não encontrou PEM privado/JWT service_role versionados; não equivale a scanner completo de histórico |
| J — testes | Testes unitários isolados por arquivo; SQL em PostgreSQL WASM descartável; typecheck/build; lint inspecionado | Resultados detalhados abaixo; homologação externa não realizada |
| K — entrega | Candidatas separadas, hashes, roteiro de consulta, publicação/rollback e homologação | Push e deploy continuam proibidos até aprovação futura |

## Ambiente e dependências

`npm run dev` inicia Vite/TanStack; `npm run typecheck`, `npm run build`. Testes canônicos: `bun scripts/run-test-suite.ts` (arquivos isolados, evitando contaminação de `mock.module`). SQL local: `bun scripts/test-pluggy-pglite.ts`. Nenhuma URL de banco é aceita por esse runner; usa apenas memória local. Não substitui o runner PostgreSQL nativo `scripts/test-pluggy-sql.sh`, que inclui corridas de duas sessões e a suíte genérica de importação 40/41/42.

A instalação Bun falhou no lifecycle de workerd. A instalação local foi recuperada com npm sem scripts, sem editar os manifests/lockfiles; a dependência peer `@testing-library/dom` foi instalada localmente com `--no-save`. Portanto, repetir em CI com o lock oficial e instalação limpa é um gate adicional. Não se deve atualizar dependências de produção a partir dessa instalação local.

Configuração necessária no servidor do Lovable Cloud (nomes, nunca valores):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` do projeto correto;
- `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`;
- `PLUGGY_WEBHOOK_TOKEN`, conferido em `x-gi-webhook-token`;
- `PLUGGY_WORKER_TOKEN`, conferido em `x-gi-worker-token`.

Cliente: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Nenhuma credencial privada deve receber prefixo `VITE_`. O `.env` rastreado contém configuração pública; o servidor local não possui as credenciais privadas necessárias. Não copiar credenciais de produção para testes financeiros.

Flags mantidas false: `PLUGGY_IMPORT_RELEASE_AUTHORIZED`, `PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED`, `PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED`, `PLUGGY_REAL_AUTOMATIC_AUTHORIZED`, `PLUGGY_REAL_CARD_LINKS_AUTHORIZED`, `PLUGGY_REAL_CARD_IMPORT_AUTHORIZED`, `PLUGGY_CARD_BILLS_ENABLED`. Nenhuma variável de ambiente habilita essas flags implicitamente.

## Verificações externas somente leitura

POST vazio, sem token, ao webhook em `gastointeligente.com.br` e ao domínio Preview retornou 401. O antigo 404 **não foi reproduzido nesse teste**. GET no domínio público retornou HTML 200, compatível com fallback da aplicação; GET no Preview retornou 401. Isso não prova processamento autenticado nem persistência da fila. Nenhum webhook foi cadastrado.

Sem credencial válida de leitura de banco, não foram verificados: migração de lote instalada, 1.179 transações, 751 registros antigos, contagens atuais ou os três IDs de referência. Usar `docs/pluggy-audit-readonly-20261019.sql` para consulta autorizada posterior, com compartilhamento restrito do resultado. Consultar também o histórico de migrações identificado por `to_regclass`; presença da função não prova correspondência do SQL instalado ao hash esperado.

## Publicação e ativação em ordem

1. Revisar diff e executar instalação limpa pelo lock, typecheck, testes, SQL nativo com duas sessões. Resolver os limites acima antes de ampliar as funcionalidades.
2. Autorizar apenas consultas reais para validar schema/migrações e contagens. Conferir preservação do primeiro rendimento desfeito e dos lançamentos antigos.
3. Aprovar os arquivos SQL exatos pelos hashes. Aplicar cada candidata separadamente em ambiente homologado, comparar permissões e validar rollback. Não reaplicar CREATE TABLE de migração já instalada.
4. Autorizar push/PR explicitamente. GitHub sincronizado ao Lovable transporta código, não comprova migração aplicada nem publicação do domínio. Conferir commit/build servido em Preview e produção separadamente.
5. Publicar inicialmente com gravações e automação bloqueadas. Validar servidor, autenticação e endpoint público no domínio final. Segredos devem ser configurados pelo responsável no Cloud, sem colar valores no chat.
6. Homologar leitura com Felipe e Michael, cada qual apenas suas contas. Vínculo de cartão precisa de aprovação própria, após candidata de vínculo; isso não libera importação de compras.
7. Só após revisão financeira aprovar um lote literal, expiração, itens/valores/datas/categorias e confirmação do titular. Não usar automaticamente os IDs de referência como autorização. A trava global deve continuar intacta.
8. Automação requer decisão separada sobre opt-in, lotes fechados e tratamento de alterações/exclusões. Só então autorizar webhook externo, worker e agendamento. Nenhum desses passos foi executado.

## Homologação no celular

- Testar Preview autenticado em Android/iOS: lista de instituições, Sandbox oculto, valores sem corte, nomes longos, loading, erro de rede e tentativa novamente.
- Confirmar consentimento na instituição somente numa sessão autorizada; validar retorno sem perder a conta logada, consentimento expirado e reconexão.
- Abrir prévia de 7 e 31 dias; rejeitar data inválida, intervalo invertido e mais de 31 dias. Conferir origem, natureza, categoria e totais.
- Antes de liberar vínculos: verificar que o cartão real aparece, nenhum Sandbox pode ser escolhido e nenhum cartão de outro usuário é visível.
- Em banco descartável: duplo clique, resposta perdida após commit, retry, concorrência, revisão ambígua, desfazer parcial, lançamento editado preservado, lote totalmente desfeito sem reaparecer como elegível.
- Depois de autorização financeira específica: conferir Gastos/Receitas/Dashboard/Relatórios/Orçamentos usando apenas ativos. Não repetir o rendimento já desfeito.

## Retorno seguro

Desligar primeiro flags financeiras/automáticas e interromper novos agendamentos. Preservar staging, eventos, grants consumidos e trilha de importação. Reverter código para o build anterior revisado; não apagar tabelas nem desfazer grants históricos. Desfazer financeiro é operação separada e autorizada, usando RPC do próprio lote/itens; nunca DELETE em massa. Migração de vínculos troca apenas o trigger de vínculo, não o trigger financeiro; rollback exige restaurar sua definição anterior revisada, preservando vínculos e metadados. Não remover colunas usadas enquanto houver código em execução que dependa delas.

## Referências técnicas primárias

- [Transações v2: IDs até 500, cursor opaco e datas](https://v2.docs.pluggy.ai/en/reference/transaction/transactions-list-by-cursor)
- [Faturas e dados bancários](https://docs.pluggy.ai/en/docs/products/credit-card-bills)
- [Parcelas e limitações de identificação](https://docs.pluggy.ai/en/docs/products/credit-card-installments)
- [Webhooks e headers](https://v2.docs.pluggy.ai/en/docs/developer-tools/webhooks-ref)

## Resultados e manifesto

Ver `PLUGGY_VALIDATION_20261019.md` para resultados finais, arquivos e SHA-256 das candidatas. Nenhuma funcionalidade nova desta branch foi homologada em produção.
