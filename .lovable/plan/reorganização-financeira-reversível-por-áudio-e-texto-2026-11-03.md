# Reorganização financeira reversível por áudio e texto

## Objetivo e limites
Permitir solicitar, revisar, confirmar e desfazer limpezas financeiras pelo WhatsApp, sem apagar fisicamente os registros. Receita nova e saldo inicial terão tratamentos distintos. A execução atingirá registros reais apenas após a futura liberação autorizada e a confirmação específica do usuário.

Nesta etapa, preparar código e testes isolados. Não aplicar migrações no banco compartilhado, alterar configurações/segredos, ligar a limpeza mensal, publicar ou testar exclusões em dados reais. F2/F4 e demais liberações continuam dependendo de autorização separada.

## Auditoria inicial
- **Reaproveitar:** recebimento e transcrição de áudio, vínculo do telefone, consentimento, acesso por plano elegível, parser monetário central, sessões de confirmação e serviços existentes de cadastro/consulta.
- **Limpeza mensal existente:** está bloqueada; atende um mês e um tipo por vez e exclui da elegibilidade vários registros vinculados. Não atende reinício completo nem limpeza seguida de receita.
- **Exclusão de privacidade:** usa apagamento físico; manter separada, sem reutilizá-la como executor deste fluxo reversível.
- **Bloqueio importante:** o SQL candidato mensal documenta incompatibilidade com a proteção F2. Resolver e testar conjuntamente antes de qualquer liberação; arquivos candidatos não comprovam o estado instalado.
- **Testes de base:** 63 testes locais aprovados, zero falhas, com dados fictícios. Cobrem áudio, exclusão individual/mensal e filtros de excluídos; não comprovam o novo fluxo nem execução em produção.
- **Android:** o projeto nativo não está neste repositório; a camada web pode ser verificada, mas a confirmação final no aplicativo exige teste no dispositivo.
- **Saldos:** `bancos` contém metadados, não saldo inicial; “Guardado” representa reservas. Dashboard e Relatórios calculam saldo do período como receitas menos despesas, não saldo bancário. O saldo inicial de conta exige um contrato próprio antes de execução.
- **Atualização existente:** o store filtra `deleted_at` em gastos e receitas; a sincronização financeira observa INSERT/UPDATE e refaz leituras ao reconectar ou voltar ao primeiro plano. Isso não prova entrega em produção nem atualiza todos os módulos relacionados. Filas offline podem inserir lançamentos antigos depois da limpeza e exigem tratamento específico.

## Entregas
### 1. Interpretar e esclarecer sem executar
Interpretar comandos naturais em uma solicitação estruturada: gastos, receitas ou ambos; histórico inteiro, intervalo fechado ou meses anteriores; manter mês atual; operação adicional de receita ou saldo inicial. Resolver períodos no fuso do usuário e mostrar datas exatas. Não assumir ano, conta, categoria ou escopo quando houver dúvida. “Pagamentos” e “limpa tudo” sempre exigem esclarecimento quando ambíguos. Comandos compostos não podem cair acidentalmente no cadastro simples.

### 2. Prévia e confirmação exclusiva
Consultar registros ativos e dependências; mostrar quantidades, valores, datas, registros bloqueados e eventual receita/saldo a registrar. Depois da revisão, exigir **APAGAR + código dinâmico exclusivo**, com validade proposta de cinco minutos, vinculado ao usuário, telefone, operação e versão da prévia. Nunca aceitar “sim” para executar. Aceitar confirmação textual ou áudio apenas quando a transcrição corresponder inequivocamente ao comando e código esperados. Cancelamento invalida a solicitação; código incorreto não renova indefinidamente a validade.

### 3. Execução reversível e restauração
Criar o contrato transacional candidato compatível com F2/F4, com lista imutável de IDs/versões selecionados no servidor, isolamento por titular e registro auditável da operação. Revalidar vínculo, consentimento, plano, prazo e escopo na confirmação e no executor. Se o conjunto ou dependências mudarem, não executar: apresentar nova prévia e pedir nova confirmação.

Marcar exclusão real em `deleted_at`, preservando relacionamentos e journal, nunca usar DELETE físico. Restaurar somente os IDs e a marca de exclusão daquela operação; preservar alterações posteriores e relatar restauração parcial quando necessário. Não prometer prazo de recuperação até validar o mecanismo e definir a política efetiva; nesta preparação, não criar expurgo automático.

### 4. Dependências e operações compostas
Mapear cartões, faturas, pagamentos, contas, parcelas, recorrências, bens, importações e origens antes de permitir limpeza desses vínculos. Não desvincular ou recalcular histórico cegamente. Preservar configurações de cartões/contas salvo inclusão expressa compatível; interromper escopos não suportados, em vez de anunciar limpeza completa. Metas e investimentos somente com inclusão expressa e regras verificadas. Preservar autenticação, plano, assinatura, integrações e administração.

“Limpar e adicionar receita” será uma transação única: a receita é gravada apenas após a etapa de exclusão dentro da mesma transação; qualquer falha desfaz ambas. Guardar ID determinístico/único para impedir duplicação. “Saldo inicial” só será executável após confirmar o modelo contábil de contas e seu efeito nos cálculos; se não houver suporte, esclarecer a limitação, nunca criar receita substituta.

### 5. Recuperação de falhas e atualização das telas
Deduplicar mensagens, confirmações e execução por operação persistente, não apenas por resposta enviada ou memória do processo. Em timeout, consultar o resultado registrado, sem repetir cegamente nem afirmar que nada mudou. Reconciliar envio da resposta separadamente da conclusão financeira.

Conferir todos os leitores e totais de Dashboard, Relatórios, Receitas, Gastos, cartões e contas. Implementar atualização/invalidação e recuperação de cache offline conforme os mecanismos existentes; provar a atualização com o site aberto e a camada web móvel. Não anunciar atualização instantânea do Android sem teste real.

Reaproveitar `financial-realtime-sync` e os refetches do store para gastos/receitas, ampliando somente os módulos afetados. Definir uma barreira persistente por operação/geração para escritas anteriores à limpeza: revalidar gravações em trânsito e colocar filas offline antigas em revisão, sem apagá-las silenciosamente nem permitir que repovoem o histórico automaticamente. A nova receita da operação composta deve pertencer à geração posterior à limpeza.

## Detalhes técnicos
- Manter os serviços de WhatsApp atuais e o modelo de IA existente; IA interpreta intenção, nunca fornece SQL nem escolhe IDs como autoridade.
- Integrar sem competir com sessões pendentes, cadastro, consultas ou edição individual. Proteger conta do titular; acesso a contas conectadas não autoriza limpeza em massa de outro usuário.
- SQL somente candidato nesta etapa; funções transacionais restritas ao servidor, validação de ownership, RLS/GRANT explícitos, CAS, bloqueio concorrente por titular e resultado persistente. Sem loops de mutações independentes ou fallback direto.
- Compatibilizar exclusão/restauração com F2, journal e vínculos de importação; impedir reimportação automática de movimentos limpos sem decisão explícita. Não ativar sincronizações ou workers.
- Auditar apenas operação, titular, data, prova mínima da confirmação, contagens e resultado, com acesso restrito e sem divulgar dados de outras contas.

## Testes e critérios de aceite
Usar banco descartável e fixtures, nunca finanças reais. Cobrir histórico completo, intervalos, mês preservado, gastos pagos, receitas, ambiguidades, cancelamento, áudio com código correto/incorreto, expiração, múltiplas instruções, replay, duas confirmações concorrentes, mudança após prévia, falha entre exclusão e receita, vínculo revogado e acesso cruzado. Cobrir restauração por stamp, alteração posterior, parcelas/faturas/recorrências/importações, saldo sem inflar receita e atualização dos totais/cache.

Incluir dispositivos offline antes da limpeza, retorno ao primeiro plano, gravação concorrente e envio atrasado de receitas/gastos enfileirados; nenhum item anterior deve reaparecer automaticamente sem revisão. Para saldo inicial, apresentar separadamente a proposta contábil (conta, data de referência e efeito em disponibilidade sem inflar receitas) antes de liberar gravação.

Apresentar relatório de módulos reaproveitados, resultados de testes, limitações e SQL candidato revisável. Só depois solicitar autorização específica para schema, ativação controlada e eventual publicação. Não considerar concluído enquanto dependências, recuperação, totais e fluxo ponta a ponta estiverem sem prova.

## Próximo passo
Aprovação deste plano autoriza implementação local e testes isolados, não migrações, ativação ou operações financeiras reais. O consumo real de créditos desta auditoria não pôde ser confirmado.