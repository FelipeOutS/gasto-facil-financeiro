# Cofre novo — senha, recuperação por e-mail e padrão visual

Relatório da etapa inicial, mantido como histórico. A continuação, os novos testes nativos e a substituição do envio direto por fila durável estão em `COFRE-HOMOLOGACAO-RECUPERACAO-20261116.md`. O hash SQL abaixo pertence à etapa inicial; usar o hash do relatório de homologação para a candidata atual. Não usar esta versão histórica como autorização de publicação.

## Origem e escopo

Repositório `FelipeOutS/gasto-facil-financeiro`, branch local `codex/cofre-novo-senha-20261116`, baseada na main remota `3172b6be`. Checkout reutilizado e atualizado somente após preservar o arquivo gerado anterior em stash. As cópias antigas em E: e OneDrive não foram sobrescritas. Sem commit, push, deploy, e-mail real ou acesso ao banco real nesta etapa.

Os quatro objetos existentes são vaults, vault_keyslots, vault_v2_entries e vault_security_events. O código e o SQL novos não escrevem em vault_entries, vault_settings ou vault_pin_settings. Os 14 registros reais não foram consultados. O teste SQL preserva integralmente 14 registros legados sintéticos.

## Uso

1. Abrir o Cofre novo por um método existente.
2. Em **Acesso e segurança**, cadastrar/confirmar uma senha de pelo menos 12 caracteres, independente das outras senhas do aplicativo.
3. Confirmar NOVAMENTE a passkey PRF ou a chave de recuperação. A chave de sessão em cache não é usada para autorizar o cadastro.
4. Após a gravação, o Cofre bloqueia. Escolher **Entrar com senha**; a preferência é local por usuário/cofre/dispositivo. A senha e a DEK não são persistidas no dispositivo.
5. Para trocar, repetir o processo. Para desativar, informar a chave de recuperação; o banco exige recuperação ativa. Passkeys e recuperação não são revogadas pela troca da senha.

**Esqueci minha senha**: envia seis dígitos ao endereço verificado obtido de Supabase Auth no servidor. O cliente não escolhe destinatário nem identidade. O código expira em dez minutos, tem no máximo cinco verificações e um único sucesso; reenvio limitado a um por dez minutos. Após validar, ainda exige passkey PRF ou chave de recuperação, e só então aceita uma nova senha. O grant é consumido na mesma transação da troca. A notificação de alteração usa o provedor Lovable existente e chave de idempotência própria.

## Criptografia e segurança

Mesma DEK aleatória AES-256-GCM, novo envelope com salt aleatório de 32 bytes e nonce de 12 bytes. AAD vincula usuário e cofre. KDF PBKDF2-HMAC-SHA-256 com 600.000 iterações no WebCrypto; parâmetros são validados antes da derivação, sem fallback para KDF fraco. Evitou-se uma nova dependência/WASM para Argon2id nesta etapa; Argon2id continua preferível para uma evolução com biblioteca e desempenho homologados. Referência: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

A DEK é exportável somente na memória para reencapsulamento, como nos métodos existentes. Buffers temporários controlados são zerados em finally. Strings/objetos em JavaScript não oferecem garantia de apagamento físico. Não há senha ou DEK em texto puro no banco, armazenamento local ou logs.

RPCs serializam no cofre e verificam o ID esperado do slot, evitando sobrescrever mudança concorrente. Erros de persistência são propagados. O contador admite cinco derivações por janela de bloqueio de um minuto; escritas diretas em slots de senha são recusadas por trigger, sem afetar os slots antigos de passkey. Esse controle não impede ataque offline contra um envelope obtido por invasão: a defesa offline é KDF e senha forte.

Códigos são aleatórios por rejection sampling e guardados como HMAC ligado a usuário/nonce, usando a credencial de servidor existente somente dentro do servidor. Sua rotação invalida códigos pendentes; não altera envelopes nem DEK. Dados dos desafios não são acessíveis a anon/authenticated. RPCs de emissão/verificação são exclusivas de service_role. A verificação sempre consulta o usuário atual no Auth, incluindo e-mail confirmado.

A troca incrementa access_version. Sessões desta implementação conferem versão a cada 15 segundos e bloqueiam por divergência ou falha de consulta. Isso não apaga uma chave que já tenha sido copiada por um invasor nem controla clientes antigos/offline. Revogar passkeys em Aparelhos e trocar a chave de recuperação são decisões explícitas; não há revogação indiscriminada de métodos legítimos ou da sessão global do aplicativo.

## Recuperação exclusivamente por e-mail

**Incompatível com o modelo atual sem custódia adicional.** E-mail confirma identidade; não contém material capaz de abrir a DEK. Não foi criado bypass, comparação visual de hash ou chave nova por cima da existente.

Uma opção futura exige adesão expressa enquanto o Cofre já está aberto: DEK encapsulada por chave pública de recuperação, chave privada mantida em KMS/HSM fora do banco, autorização com autenticação recente/MFA além do e-mail, limite global, período de espera/avisos, trilha de auditoria e revogação. O serviço autorizado reencapsularia a DEK para uma chave efêmera do aparelho. Isso concede capacidade de recuperação ao operador e muda a alegação de privacidade: a infraestrutura de recuperação passa a poder recuperar chaves. Exige análise própria, consentimento revogável, gestão/rotação de chaves e aprovação separada. Nada disso foi ativado.

## UI

| Before | After | Why |
| --- | --- | --- |
| Lista linear de credenciais | Cards em grid responsivo com CompanyLogo compartilhado | Aproximar o padrão do Cofre antigo |
| Senha visível no editor | Campo mascarado, mostrar/ocultar e gerador preservado | Consistência e privacidade |
| Sem janela de detalhes | Dialog com logo, usuário, senha mascarada e cópia | Reutilizar os componentes visuais existentes |
| Acesso só por passkey/recuperação | Senha, preferência por dispositivo e ajuda por e-mail | Alternativa permanente sem dependência obrigatória de biometria |

Respeita tokens e componentes dos temas. Capturas isoladas com dados sintéticos, sem serviços externos, verificadas a 320/390/1280 px, claro/escuro, sem overflow horizontal. A barra de categorias mantém scroll próprio. Capturas não representam a conta real nem homologação física de Face ID/Touch ID.

## Validação e limitações

92 testes aprovados em 11 arquivos: criptografia, serviços, SQL real em PostgreSQL/WASM descartável (PGlite), código de e-mail com provedor falso, UI, timer de inatividade e regressões legadas. O runner canônico isola cada arquivo (Happy DOM/mocks globais não podem ser misturados em um único bun test).

Typecheck, build e lint dos arquivos alterados aprovados. O lint geral foi executado e falhou com 298.277 achados (298.109 erros/168 avisos), majoritariamente formatação CRLF e problemas preexistentes fora do escopo. O build conserva avisos preexistentes do bundler e inputValidator. Nenhuma dependência foi adicionada/atualizada. Dois testes v2 existentes usavam vitest não instalado; passaram a usar bun:test, o runner oficial do repositório.

Pendente: entrega real do provedor, remetente autorizado, bloqueios/supressões, latência de PBKDF2 no A11 e WebAuthn PRF no aparelho. Face ID/Touch ID dependem de HTTPS, navegador/autenticador e extensão PRF; passkey comum sem PRF não abre dados. WebCrypto é necessário para todos os métodos. A senha funciona sem biometria depois de configurada.

O aviso após alteração é tentado pelo provedor e usa idempotência, mas não possui uma nova fila durável de repetição. Se o envio falhar, o usuário vê aviso e a senha já alterada continua válida. Antes de produção, homologar entrega e estabelecer repetição operacional do notify; não considerar envio confirmado em caso de erro. Nenhum segredo de provedor foi criado ou alterado.

## Implantação, autorização e rollback

SQL candidato: `docs/migrations-candidate/vault-v2-password-email.sql`.
SHA-256: `4EE153CB3AD3D93ED09B97F8D615CB06CE853A881E5CB315083789D45052C5B3`.

Somente após aprovação específica: conferir backup/restore e schema inicial, aplicar candidata transacional no Preview isolado, publicar código no Preview e testar com usuário sintético. A candidata não é migration automática e não foi copiada para diretórios de migrations aplicáveis. Sem RPC, senha/e-mail falham fechados e métodos antigos continuam disponíveis.

Antes de qualquer produção: homologar envio real, notificação, concorrência em PostgreSQL nativo/duas sessões, recuperação após reload, sessões concorrentes e dispositivo físico. O PGlite valida transações/RLS, mas não substitui duas conexões concorrentes nativas. Comparar schema e permissões de produção com a base candidata por leitura autorizada separadamente.

Rollback preferido: reverter somente o código e manter dados/envelopes. Não remover a constraint nova/coluna/tabela enquanto houver slots de senha ou grants; não apagar envelopes, não restaurar snapshot antigo por cima de credenciais recentes. Passkeys/recuperação continuam intactas. Retornar ao código revisado após resolver o problema. Recuperação exclusivamente por e-mail e custódia KMS não integram esta implantação.

Arquivos: rota app_.cofre-novo.tsx; componentes/vault/VaultV2Password.tsx; lib/vault/v2/{keyslots,password,service,supabase-store,email.functions,lifecycle}.ts; server/vault-v2-email.server.ts; testes vault-v2-{password,password-sql,email,lifecycle,ui,keyslots,service}; esta documentação e SQL candidato. Arquivos do Cofre antigo sem diff contra a main de origem.
