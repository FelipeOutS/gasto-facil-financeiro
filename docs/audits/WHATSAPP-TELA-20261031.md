# Tela WhatsApp — revisão local de ponta a ponta — 31/10/2026

Escopo: rota /whatsapp, carregamento, vínculos, consentimento, histórico, ações financeiras, simulador, configuração e contrato do webhook. Inspeção do código local; nenhuma chamada à Meta ou ao banco real, nenhum emulador e nenhuma alteração funcional.

## Achados

1. ALTO — Reprocessar apaga whatsapp_messages antes do POST. O POST não fornece assinatura HMAC e usa payload legado; o endpoint exige assinatura Meta. Se o DELETE tiver permissão e o POST falhar, perde-se o registro original. O erro do DELETE também é ignorado. Corrigir com fluxo autenticado e idempotente, preservando mensagem original; não relaxar HMAC do webhook.
2. ALTO — Ver em Gastos trata erro de leitura igual a ausência do gasto, atualizando status para gasto_excluido e zerando gasto_id. Falha transitória não deve alterar histórico. Reprodução local do handler confirmou a atualização após erro simulado.
3. ALTO — Excluir gasto executa DELETE físico por deleteGastoAtivo e depois atualiza contas_a_pagar e whatsapp_messages em chamadas separadas; erros dessas atualizações são ignorados. Pode reportar sucesso parcial e perder reversibilidade. Exige solução transacional compatível com a migração F2 ainda candidata, não ativação automática.
4. ALTO — Remover duplicados (Admin) usa descrição/valor/data/cartão, que não provam duplicidade. Desvincula mensagens antes do DELETE físico; falha posterior deixa referências removidas. Revisão manual e identidade de origem são necessárias antes de remoção transacional.
5. MÉDIO — Testar mensagem envia POST sem HMAC ao endpoint exclusivo Meta. Contrato incompatível confirmado estaticamente. Usa links[0], mesmo que outro vínculo seja o elegível que habilitou o botão. Não foi enviado POST real.
6. MÉDIO — Status global Ativo depende apenas de config.enabled, links.length e existência de mensagem; não exige vínculo ativo/verificado com consentimento. Vínculos revogados com histórico podem parecer ativos. Falha de carregamento de configuração aparece como desativação, sem estado desconhecido.
7. MÉDIO — refresh combina vínculos e histórico: erro em uma consulta impede atualizar ambos. Após erro inicial exibe lista vazia como se não houvesse vínculo, sem erro persistente. Não protege contra respostas fora de ordem.
8. BAIXO — Confirmação guarda expiraEm mas mostra prazo fixo de 20 minutos, sem indicar expiração. Sair/recarregar perde mensagem de confirmação local; tela instrui gerar novamente.
9. BAIXO — Cores amber-200/emerald-300/rose-300 de vários avisos e botões são voltadas ao escuro; revisar contraste no claro. Botões de histórico h-7 oferecem área pequena para toque; voltar e atualizar carecem de nome acessível.
10. BAIXO — Histórico consulta 50 mensagens mas mostra só 8, sem paginação. URL técnica copiada usa localhost fora do Preview embora comentário prometa domínio publicado.

## Verificações positivas

- Revogar vínculo possui autenticação, ownership e RPC específica no servidor; não exige plano para executar a revogação. A acessibilidade da rota quando plano expira ainda depende dos gates superiores.
- Novo vínculo exige consentimento e verificação de posse; não ativa apenas pelo cadastro.
- Links externos têm noopener/noreferrer.
- Consultas de gastos nesta tela filtram deleted_at, e helper recusa exclusão de registro já marcado.
- Segredos não são retornados por getWhatsAppConfigStatus, apenas indicadores booleanos.
- HMAC obrigatório do webhook está preservado.

## Validação executada

Harness local Node executou os corpos atuais de verEmGastos e reprocessar com banco/rede simulados: 2 cenários reproduzidos. Assertiva adicional conferiu incompatibilidade de assinatura entre botão e endpoint: 1 confirmada. São reproduções de defeitos, não testes de aprovação da tela. Script em %TEMP%/audit-whatsapp-screen.mjs.

Não executada homologação integrada com banco/Meta, nem teste visual completo ou abertura de app externo em Android. Não afirmar validação ponta a ponta em produção. Não houve alteração de código funcional, SQL, flags, dados, push ou publicação nesta revisão.

## Ordem recomendada

1. Impedir perda de histórico e mutações em leitura com falha.
2. Corrigir/remover ações legadas incompatíveis; não enviar segredo HMAC ao cliente.
3. Preparar transações financeiras compatíveis com schema implantado e preservar idempotência.
4. Corrigir estados de carregamento, vínculo, expiração e histórico; contraste e alvos de toque.
5. Adicionar regressões dos cenários e homologar com conta de teste e autorização separada.

Resultado: NÃO APTO para considerar esta tela integralmente homologada; há riscos de dados nos controles legados.

## Correção local posterior

- Consulta de gasto agora é somente leitura; falha e ausência preservam histórico.
- Removidos reprocessamento destrutivo, exclusão física e limpeza automática da tela. Usuário segue para Gastos para gerir o lançamento. Os quatro endpoints legados também rejeitam chamadas autenticadas sem efeitos colaterais.
- Simulador é explicitamente local, sem POST nem criação de gasto. Assinatura Meta não foi relaxada.
- Estado exige vínculo verificado, ativo, consentido e não revogado; configuração desconhecida não aparece como integração desativada.
- Refresh preserva dados que puderam ser obtidos, expõe erro persistente, ignora respostas antigas e invalida chamadas ao desmontar; consultas filtram user_id explicitamente.
- Confirmação usa horário real de expiração e remove código/link expirados; mensagem continua somente na memória, sem persistir token em localStorage.
- Histórico expande de 8 em 8 até as 50 mensagens consultadas, com limite indicado.
- Ajustados contraste claro/escuro, alvos do histórico, nomes de voltar/atualizar, validação do celular, bloqueio de desvinculação enquanto aguarda resposta e URL técnica estável.
- Testes: node --test scripts/verify-whatsapp-screen.mjs — 10 aprovados; typecheck aprovado.

Limite deliberado: isto contém e remove os caminhos inseguros; não implementa nova exclusão/reprocessamento transacional na tela. Reativá-los exige contrato de banco compatível e homologação separados. Não há novas migrações, flags, chamadas de produção, push ou publicação. A troca de tema, abertura externa do WhatsApp e confirmação real de posse ainda precisam de homologação integrada. Não classificar o aplicativo inteiro como pronto para produção com esses testes isolados.

## Homologação visual isolada complementar

`node scripts/verify-whatsapp-screen-browser.mjs`: 6 cenários aprovados, claro/escuro em 320, 390 e 1280 px. Renderiza a página React real com serviços simulados e bloqueia rede externa. Conferidos histórico de 8 para 12 mensagens, prévia sem chamadas de escrita, vínculo revogado/pendente, falha de consulta com histórico preservado, recuperação, expiração do código e ausência de overflow horizontal/erros JavaScript. Captura clara mobile inspecionada. Isso não valida AuthGate, Meta, banco real nem abertura nativa de links.

Regressões Node novamente: 10 aprovadas. Nenhum emulador aberto ou mensagem enviada. Alterações continuam locais.
Validação final complementar: typecheck e npm run build concluídos com código 0. Build mantém avisos de depreciação/inputValidator e diretivas de dependências; sem erro de compilação.

## Complemento: acesso ao consentimento sem plano

- AuthGate mantém a rota paga protegida, mas renderiza exclusivamente WhatsAppConsentAccess quando o plano não permite WhatsApp ou há falha na consulta da assinatura. Não libera children, cadastro, mensagens ou funções financeiras. Autenticação e bloqueio biométrico continuam anteriores ao painel.
- listOwnWhatsAppConsents exige autenticação, usa cliente do usuário e filtro explícito user_id; retorna somente id e telefone dos vínculos não revogados. Revogação usa a RPC existente whatsapp_revoke_links, sem fallback de escrita.
- Renovação de consentimento seleciona apenas vínculo ativo/verificado/não revogado e repete os predicados no UPDATE. Zero linhas alteradas ou erro não retornam sucesso.
- Resposta incompleta ao iniciar vínculo não informa mais que o número já está ativo. Link de confirmação usa o gerador central wa.me com texto codificado.
- 14 testes Node aprovados, incluindo revogação concorrente/erro no consentimento e escopo da consulta de privacidade. 7 cenários de navegador aprovados, incluindo falha, retry e revogação no painel restrito. Typecheck aprovado.
- Confirmação real de posse, configuração/RPC no banco implantado e abertura externa Android ainda dependem de homologação autorizada. Não enviados códigos ou mensagens reais; sem push, deploy, migrations ou mudanças de flags. Ações financeiras legadas continuam bloqueadas.
Build final do complemento aprovado (código 0); permanecem avisos de dependências já observados. Os testes de navegador verificam também destino wa.me e conteúdo codificado da confirmação, sem navegar para serviços externos.
