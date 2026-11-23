# Cofre — resultados de homologação segura em desenvolvimento

## Ambiente e preservação

Branch `codex/cofre-novo-senha-20261116`, base main `3172b6be`. O checkout temporário perdeu arquivos preexistentes durante a execução; nenhuma dessas exclusões integra o trabalho. As alterações do Cofre foram copiadas com hashes conferidos para o worktree íntegro gerenciado em `C:/Users/Felip/.codex/worktrees/cofre-novo-homologacao/gi-pr35-fix`, e a mesma branch foi vinculada a ele. O checkout anterior foi mantido como cópia de preservação, sem reset/clean ou inclusão das exclusões. Dependências e lockfiles não foram alterados.

A inspeção do Lovable encontrou o projeto publicado e um draft antigo com backend_kind hosted, sem evidência de banco separado. Não foi criado nem aplicado SQL num draft potencialmente compartilhado. O titular confirmou que não tem URL isolada comprovada ou e-mail de teste autorizado e autorizou continuar com banco descartável/provedor simulado. Nenhuma consulta SQL em produção, envio real, migração real, push ou publicação foi feita.

## Resultados

- Senha derivada com PBKDF2-SHA256/600.000 e encapsulamento da mesma DEK; cadastro/troca requer desbloqueio criptográfico novo por passkey PRF ou recuperação. Preserva entradas e os outros envelopes.
- UI de desbloqueio abre dados cifrados reais sintéticos com senha correta, recusa incorreta e funciona após desmontar/remontar a tela com o envelope persistido (simulação de reload).
- Sessões verificam access_version; mudança em outra sessão, remoção do Cofre ou falha de consulta bloqueiam. Verificações lentas não se sobrepõem; respostas depois de desmontar não reabrem uma sessão. Testados inatividade, atividade que renova prazo e cancelamento dos timers.
- Passkey simulada exige userVerification required e PRF de 32 bytes; apenas evento biométrico, resposta sem PRF ou cancelamento não liberam a chave. Sem telefone conectado no ADB; Face ID, Touch ID e Android físico não foram homologados.
- Padrões de cards, tokens de tema, CompanyLogo, dialogs, botões, busca e organização compartilhados com o Cofre antigo. As capturas isoladas da etapa anterior validaram claro/escuro em 320/390/1280 px. Isso confirma uso do mesmo sistema visual, não equivalência pixel a pixel de todas as telas/estados numa conta real. A aprovação visual final em Preview permanece pendente.

## E-mail e repetição segura

O envio direto foi substituído pela infraestrutura existente `enqueue_email` / fila transactional_emails / processador Lovable. A emissão do desafio e o enfileiramento do código são transacionais. A troca da senha com grant de e-mail enfileira o aviso de alteração na MESMA transação: se a fila falhar, a senha e o consumo do grant são revertidos. Não depende de callback do navegador para enviar o aviso.

Código continua com seis dígitos, dez minutos, cinco verificações, um sucesso e um envio por dez minutos. Pode solicitar outro código depois desse prazo; uma falha de enfileiramento não confirma envio. O retorno do servidor informa fila aceita, não entrega na caixa postal. Código viaja no payload da fila privada de e-mail (como outros e-mails de autenticação), nunca como chave do Cofre. Proteger retenção/acesso operacional da fila e backups na homologação.

O worker existente foi alterado somente para expiração específica do código (antes de enviar), remoção de texto/HTML de código em DLQ e mensagens genéricas de erro desses códigos. Mantidos limite de cinco falhas, backoff 429, idempotência e deduplicação existentes. Provedor simulado validou: 500 mantém mensagem e permite retry; 429 pausa até cooldown; 403 vai a DLQ; cinco falhas encerram repetição; mensagem já enviada não dispara novamente; código expirado não sai, e a DLQ não guarda seu texto.

Nenhum cron/worker foi ativado remotamente. Para envio real é necessário ambiente separado, remetente/provedor válidos, fila/worker em funcionamento e destinatário de teste expressamente autorizado. Não há prova de entrega real nesta etapa.

## Banco nativo e concorrência

Script `scripts/test-vault-v2-native.ts`: PostgreSQL 17.11, cluster novo a cada execução, TCP 127.0.0.1 em porta alocada dinamicamente, sem URL externa e sem aceitar cluster existente. SQL entregue por stdin UTF-8 para preservar acentos no Windows. Log de inicialização sanitizado; stop e limpeza restritos ao diretório novo do teste.

Oito verificações aprovadas com conexões independentes: duas trocas simultâneas geram um commit e uma recusa CAS; duas verificações do mesmo OTP geram exatamente um sucesso; duas recuperações geram uma troca; uma única notificação é enfileirada; access_version incrementa por commit; oito tentativas simultâneas permitem somente cinco; bypass direto/anon são recusados; fingerprint dos 14 registros legados sintéticos permanece igual.

PGlite adicional valida RLS, OTP errado/expirado/reutilizado, limite de tentativas, consumo único, erro da fila com rollback de senha/grant e preservação integral dos registros antigos sintéticos.

Suíte final: 101 testes em 14 arquivos (incluindo regressões do Cofre legado), sem falhas/skip/erros, além de oito verificações nativas aprovadas. Typecheck e build concluíram com exit 0; lint dos arquivos desta etapa passou. O lint global da etapa inicial tinha falhas preexistentes fora do escopo, sem supressão global.

Candidata atual: `docs/migrations-candidate/vault-v2-password-email.sql`, SHA-256 `A12F56D148B62DE64DE5C179CE859EB1A101274A49C4B114F520D26CDF449DC9`. Aplicada somente em PGlite e PostgreSQL nativo descartáveis. A infraestrutura de fila é simulada nesses testes; não é prova de entrega nem de conexão com um Preview hospedado.

## Cofre antigo e proposta KMS

Não foi obtida uma chave original válida nem recuperado qualquer dos 14 registros reais. O titular confirmou falha nos métodos disponíveis; não foi encontrado dispositivo conectado, sessão do app aberta ou backup de Cofre pelos nomes pesquisados nas pastas conhecidas. Isso não permite declarar perda definitiva. Sem senha, sessão/chave válida ou envelope legítimo acessível, e-mail não decifra o legado. Nenhum reset/reescrita foi implementado.

Detalhes: `COFRE-ANTIGO-RECUPERACAO-20261116.md`. A prova automatizada usa 14 credenciais sintéticas, mostra que só a chave original as abre e que senha nova/OTP não são substitutos; não representa recuperação dos registros reais.

Proposta separada com consentimento, custos e riscos: `COFRE-RECUPERACAO-KMS-PROPOSTA-20261116.md`. Não ativada. Não recupera retroativamente chaves antigas nunca custodiadas.

## Requisitos para publicação

1. Provisionar/identificar Preview com Auth, banco, filas e segredos separados; comprovar que não contém os 14 registros reais nem compartilha referência de produção.
2. Conferir schema/backup e RPC enqueue_email; aplicar a candidata somente nesse ambiente autorizado e instalar o código do mesmo snapshot da branch.
3. Autorizar destinatário de teste e homologar envio/recebimento real, reenvio, falhas, expiração e notificação, verificando logs sem códigos/chaves.
4. Homologar navegação/reload e duas sessões no navegador, além de Face ID/Touch ID/Android disponíveis e latência do KDF no A11. Aprovar visual em claro/escuro e desktop/celular.
5. Revisar diff/SQL e autorizar produção separadamente. Sem infra de fila, não aplicar candidata (preflight falha); sem RPC, senha/e-mail recusam operação. Não há fallback que substitua a DEK.

Rollback: reverter código sem apagar envelopes/entradas ou restaurar backup antigo por cima de dados novos. Manter coluna de versão, tipo password e tabelas necessárias enquanto existirem dados dependentes. Slots legítimos de passkey/recuperação e Cofre antigo permanecem preservados.
