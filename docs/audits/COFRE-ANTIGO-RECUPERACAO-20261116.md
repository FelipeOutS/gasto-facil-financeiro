# Cofre antigo — resultado da investigação não destrutiva

## Resultado atual

Os 14 registros NÃO foram recuperados nesta etapa. Também não foi demonstrado que sejam irrecuperáveis em definitivo: nenhum dispositivo contendo um possível envelope válido está conectado. O titular confirmou que biometria e demais métodos disponíveis já falharam. Não houve novas tentativas de PIN/senha, acesso a memória de processos, extração de Keystore, limpeza de armazenamento, consulta SQL em produção nem alteração de registros/configurações.

O inventário de navegadores não encontrou aba do aplicativo com sessão aberta. ADB não encontrou dispositivo. Não foram encontrados arquivos com nomes de backup de Cofre/recuperação nas duas pastas de backups conhecidas do projeto (E: e OneDrive); isso não exclui arquivos renomeados, outros computadores, downloads, backups pessoais ou de nuvem. Não foram coletadas senhas, chaves, cookies ou conteúdo de credenciais.

## Mecanismos efetivamente encontrados no código

| Material | Condição necessária | Limitação |
| --- | --- | --- |
| Chave da sessão em memória (`use-vault.tsx`) | Sessão original ainda válida e desbloqueada | Expira por inatividade, troca de identidade ou fechamento; e-mail não a recria |
| Android Keystore (`native-vault.ts`, `quick-unlock.ts`) | Envelope nativo existente + autenticação do SO + chave coincidente com verifier atual | Uma notificação de biometria bem-sucedida não basta; reinstalação/invalidação do Keystore pode tornar o envelope inutilizável |
| WebAuthn PRF (`quick-unlock.ts`) | Credencial original, PRF e envelope local correspondente | Sincronizar uma passkey comum não garante sincronizar o envelope nem PRF; registro legado android-bio não é usado como bypass |
| PIN nativo (`native-pin.ts`) | PIN correto, estado nativo protegido e envelope válido | Não testar combinações; respeitar limite do dispositivo |
| PIN legado (`server-pin.ts`) | PIN correto + vault_pin_settings previamente existente + envelope da chave original | Novos cadastros foram bloqueados; não recriar o PIN nem substituir a chave |
| Backup criptografado (`service.ts`) | Senha mestra correspondente ou chave original recuperada | O JSON contém dados cifrados e parâmetros; não contém uma chave de recuperação em texto puro |

## Critério para qualquer recuperação futura

Antes de alterar senha: obter uma dessas chaves por caminho autorizado, conferir identidade, verificar `keyMatchesVaultSettings` e conseguir descriptografar TODOS os registros do snapshot (esperados 14, conferir a contagem real somente com autorização). Preservar snapshot criptografado e fingerprint. Qualquer registro que falhe bloqueia a troca. Não gerar senha/verifier novos para fingir recuperação.

Somente depois dessa prova: vincular a confirmação por e-mail a uma operação específica do Cofre antigo, com grant de uso único validado no servidor, e usar a rotação atômica já existente com CAS. O grant atual do Cofre novo não autoriza operação do antigo. Esta extensão NÃO foi habilitada: sem chave comprovadamente disponível, criaria uma promessa falsa de recuperação. A migração posterior deve mostrar prévia e só copiar para o Cofre novo após confirmação, sem excluir os originais.

Se nenhum material válido existir, e-mail, alteração da senha de login, acesso administrativo ao Supabase e KMS instalado agora não permitem descriptografar retroativamente os registros. Preservar dados e dispositivos até concluir a verificação de backups pessoais. Não foi implementado reset do Cofre antigo.
