# Cofre novo — entrega para revisão e homologação isolada

Preparação em 23/11/2026 na branch `codex/cofre-novo-senha-20261116`, baseada em `3172b6be581dbd40faf14c07524343d7fdc2a4e2`. **Pronto para revisão em PR rascunho; não aprovado para merge ou produção.**

## Snapshot e preservação

O worktree gerenciado está íntegro: nenhum arquivo rastreado ausente e nenhuma exclusão no diff. O checkout temporário anterior permanece preservado; suas exclusões não foram incorporadas. `src/routeTree.gen.ts` apresenta apenas diferença de normalização local, sem diff de conteúdo; fica fora do commit. Dependências, lockfiles, código Android e módulos financeiros não mudam.

O Cofre antigo não recebe alterações de código, SQL ou dados nesta entrega. Os 14 registros reais não foram consultados, recuperados, redefinidos ou migrados. A prova de preservação do banco descartável usa 14 registros sintéticos. A recuperação real continua condicionada à existência da chave original ou de um envelope legítimo acessível; e-mail sozinho não a substitui.

## O que está entregue

- Senha para desembrulhar a mesma chave do Cofre novo, com PBKDF2-SHA256/600.000, AES-GCM e contexto vinculado a usuário/cofre.
- Recuperação com código de e-mail, seguida obrigatoriamente de passkey PRF ou chave de recuperação válida. Não há recuperação exclusivamente por e-mail nem KMS implementado.
- Código de seis dígitos, dez minutos, cinco tentativas, uso único e envio limitado; destinatário obtido da identidade verificada no servidor.
- Troca transacional do envelope, comparação de versão/slot, histórico de segurança e notificação enfileirada junto com a troca. Falha na fila reverte a operação.
- Bloqueio por inatividade/ocultação, verificação de versão entre sessões e proteção contra respostas assíncronas tardias.
- Interface reutiliza os componentes e tokens do Cofre antigo. Aprovação visual final em conta de teste ainda pendente.

Resultados locais anteriores preservados: **101 testes em 14 arquivos, oito verificações nativas em PostgreSQL 17, typecheck, build e lint dos arquivos da etapa aprovados**. Não repetidos nesta preparação, pois código/SQL permanecem no snapshot validado. Lint global tem pendências preexistentes documentadas no relatório de homologação. Nenhum resultado local representa recebimento real de e-mail ou biometria física homologada.

## SQL e ordem de homologação

| Arquivo | Situação | SHA-256 |
| --- | --- | --- |
| `docs/migrations-candidate/vault-v2-passwordless.sql` | Base já existente no repositório; verificar presença e equivalência do schema no ambiente de teste. Não reaplicar cegamente. | `F7261D65E659611B5CEFD381E2A06078FE3BCCEFA90A0E6FDB54FF765A40E2F4` |
| `docs/migrations-candidate/vault-v2-password-email.sql` | Nova candidata, somente testada em bancos descartáveis. Fora do diretório de migrações automáticas. | `A12F56D148B62DE64DE5C179CE859EB1A101274A49C4B114F520D26CDF449DC9` |

Hashes da tabela calculados sobre os bytes LF versionados no Git. A base passwordless no checkout Windows com CRLF tem hash `7524F855BA397081885EEE108969033B05834AC12879B9D5EACDD15872ADDA0B`; a diferença é somente de fim de linha. O arquivo base não integra as alterações deste commit.

1. Confirmar isolamento de URL/referência do banco, Auth, Storage, chaves e serviços. Parar se qualquer destino apontar para produção ou se houver dados reais.
2. Registrar SHA do código e hashes SQL; criar backup do ambiente de teste. Usar duas contas sintéticas com e-mails de teste, sem copiar usuários ou credenciais reais.
3. Em banco vazio, instalar apenas pré-requisitos Auth, schema v2 e infraestrutura de fila previamente revisados. Não aplicar todo o histórico de migrações financeiras. `tests/sql/vault-v2/*` são stubs, não infraestrutura de Preview hospedado.
4. Conferir `enqueue_email(text,jsonb)`, fila e permissões; aplicar a candidata senha/e-mail somente no destino isolado autorizado. Ela falha se faltar a fila. Não é script idempotente: verificar ausência das novas estruturas antes da aplicação.
5. Subir o código do mesmo SHA no servidor de teste; conferir tanto as URLs do frontend quanto as usadas pelo middleware/cliente administrativo. Sem RPC, o fluxo deve recusar a operação, sem redefinir a chave.
6. Executar a matriz abaixo. Envio externo só depois de autorização do destinatário, remetente e provedor de teste.

## Preview mais econômico

**Preferência: stack Supabase local independente + frontend local + provedor de e-mail simulado/capturado.** O desenvolvimento local não consome a cota do projeto; não exige criar um banco pago. No Windows, usar runtime Docker compatível e configuração nova em diretório de homologação, sem vincular o projeto publicado. Manter banco/Auth restritos ao computador; não expor a stack à internet. O capturador local não comprova entrega na caixa postal. [Supabase Local Development](https://supabase.com/docs/guides/local-development).

Para um Preview HTTPS acessível no celular fora do computador: um **projeto Supabase Free separado**, se houver cota disponível, com frontend de teste separado, dados sintéticos e chaves próprias. O plano Free anuncia US$ 0 e limite de dois projetos ativos, pausados após uma semana de inatividade; hospedagem do frontend e envio real dependem dos serviços escolhidos. Não foi provisionado nem contratado serviço. [Preços oficiais](https://supabase.com/pricing).

Draft do Lovable não é prova suficiente de isolamento. A documentação atual diferencia drafts com backend próprio e drafts com backend compartilhado; mesmo com banco próprio, segredos e serviços conectados mantêm valores reais. Para esta homologação completa, não usar um draft enquanto esses destinos não forem comprovadamente separados ou substituídos por simulação. Não aceitar o draft: essa ação pode promover schema/funções ao ambiente real antes de publicar a interface. [Documentação de drafts](https://docs.lovable.dev/features/drafts).

## Matriz final de testes pendentes

Executar apenas no ambiente isolado identificado. Registrar SHA, navegador/SO, modelo, origem HTTPS/RP ID, resultado, duração e evidência sem segredos. Todas as credenciais e entradas abaixo são sintéticas.

| Caso | Ação e critério de aprovação | Evidência local existente / pendência |
| --- | --- | --- |
| Senha | Configurar após novo desbloqueio; bloquear, abrir com senha correta, rejeitar incorreta e conferir todas as entradas. | Criptografia/UI automatizadas; falta Preview integrado. |
| Recarregamento | Recarregar, fechar/reabrir e trocar de usuário; nunca mostrar segredos antes de novo desbloqueio. | Remontagem e ciclo de vida simulados; falta navegador integrado. |
| Recuperação | Receber código, validar, provar passkey PRF/chave e criar senha; antiga falha, nova abre os mesmos registros. | Fluxo simulado; falta envio e execução integrados. |
| Código inválido | Errado, expirado, reutilizado, sexto erro e novo pedido antes de dez minutos são recusados. | SQL e servidor isolados aprovados; confirmar comportamento da tela. |
| E-mail sem chave | Código válido sem passkey PRF/chave válida não abre dados nem apresenta recuperação concluída. | Validar também manualmente; recuperação só por e-mail não existe. |
| Fila e entrega | 500, 429, indisponibilidade, duplicata, expiração e falha definitiva; nada confirma entrega antes do provedor. Aviso de alteração único após commit. | Worker simulado aprovado; falta provedor/caixa postal reais autorizados. |
| Concorrência | Duas sessões trocam a senha/validam o mesmo código: somente uma grava; a outra recebe conflito; sessão aberta bloqueia na próxima verificação de versão. | PostgreSQL nativo aprovado; falta ensaio entre navegadores. |
| Biometria | Android físico, Face ID e Touch ID onde disponíveis: PRF válido abre; cancelamento, ausência de PRF e aparelho não autorizado recusam. | Testes simulados aprovados; nenhum dispositivo físico homologado. |
| Origem biométrica | Registrar credencial no domínio/RP ID de teste e repetir nele; não esperar que a credencial do domínio publicado funcione no Preview. | Necessário no teste físico e WebView. |
| A11 | Medir desbloqueio/KDF, rolagem e botões no Samsung A11; não reduzir a derivação criptográfica para mascarar lentidão. | Medição física pendente. |
| Visual | Claro/escuro, 320/390 px e desktop; teclado, foco, dialogs e leitor de tela; nenhum segredo exposto por padrão. | Fixtures anteriores aprovadas; aceite final integrado pendente. |
| Isolamento | Conta B não lê nem altera Cofre A; erro de rede não libera chave nem grava falso sucesso. | RLS/mocks aprovados; falta integração com Auth real de teste. |
| Legado | Nenhuma escrita nas tabelas antigas; não testar reset nem importação dos 14 registros reais. | Código legado sem diff e fingerprint de 14 linhas sintéticas preservado. |

## CI, promoção e rollback

O PR deve permanecer rascunho e sem auto-merge. `whatsapp-pr.yml` executa verificação local/descartável com `contents: read`, sem segredos/deploy. Não cobre toda a nova suíte do Cofre: o resultado local está no relatório anterior. `cortex.yml` só roda por disparo manual e pode criar commits; não dispará-lo nesta entrega. Nenhum workflow foi adicionado ou alterado. Não foi reexecutada a suíte local já aprovada. Integrações externas de publicação não são comprovadas pela leitura desses YAMLs; manter main e Lovable sem alterações evita a promoção desta branch por esse caminho.

Se a homologação falhar, retirar somente a versão de código de teste e manter entradas/envelopes. Não fazer downgrade destrutivo do schema, remover slots password existentes ou restaurar snapshot antigo por cima de novos dados. Interromper o worker de teste caso não se possa comprovar o destino. Antes de produção, revisar a compatibilidade do código anterior com slots password e manter passkey/recuperação; não considerar rollback de UI uma revogação de credenciais/sessões.

## Ações e autorizações

- **Já autorizado:** commit e push desta branch para abrir PR rascunho; revisão sem merge/deploy.
- **Próximo passo sugerido:** autorizar montagem da stack local independente com Auth e e-mail capturado, sem copiar produção. Não é necessário fornecer credenciais reais para isso.
- **Para teste hospedado:** criar/identificar projeto de teste separado e autorizar sua configuração, SQL somente nele e hospedagem da branch. Não reaproveitar segredos de produção.
- **Para entrega real de e-mail:** indicar destinatário de teste e autorizar expressamente provedor/remetente/envio e notificações de teste.
- **Para biometria:** disponibilizar aparelhos compatíveis e concluir a autenticação diretamente neles, sem compartilhar PIN/senha/códigos.
- **Produção:** autorização separada para migração, código, serviços e publicação, depois dos critérios acima aprovados. Não há aprovação de produção nesta entrega.

KMS permanece apenas na proposta anterior; nenhuma custódia de chave foi implementada ou ativada. Consumo real de créditos/tokens não está disponível para confirmação.
