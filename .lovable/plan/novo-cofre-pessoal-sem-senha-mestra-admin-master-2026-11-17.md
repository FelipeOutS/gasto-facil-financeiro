# Novo Cofre Pessoal sem senha mestra (Admin Master)

## Auditoria (somente leitura, já feita)
- Hoje existe **um único cofre por usuário**, com a senha mestra como base. A chave dos registros fica embaralhada pela senha (PBKDF2 250 mil rodadas + AES-256-GCM), e tudo acontece no aparelho.
- A biometria do navegador já existe e usa o recurso **WebAuthn PRF**: o próprio Touch ID / Face ID entrega material criptográfico real, não é só um "ok" visual. Hoje ela só embrulha a chave do cofre antigo e fica gravada no navegador.
- O PIN antigo do servidor está aposentado: o código só lê o que já existe, não cria novos. Ele tem limite de tentativas (5 erros = 15 min).
- Os 14 registros antigos ficam em `vault_entries`, ligados ao usuário, sem identificador de cofre.

## O que é viável de verdade nos seus aparelhos
| Aparelho | Desbloqueio sem senha | Observação |
|---|---|---|
| MacBook, Safari 18+ ou Chrome recente, com Touch ID | Sim, via passkey com PRF | Funciona bem |
| iPhone, iOS 18+, Safari, Face ID | Sim, via passkey com PRF | No iCloud, a passkey sincroniza entre Mac e iPhone |
| Navegador sem PRF | Não | Usa a chave de recuperação, nunca uma proteção só visual |
| PIN de 6 dígitos | Só como **segundo fator junto com a passkey** | Sozinho, ele nunca abre a chave |

Conclusão: dá para ter um cofre **sem senha mestra**. A base é uma passkey com PRF e uma **chave de recuperação** forte, mostrada uma vez só. Ser Admin Master não abre nada sozinho: você precisa estar logado **e** ter a passkey ou a chave de recuperação.

## Arquitetura
```text
Chave do cofre (DEK, 256 bits aleatórios, só na memória)
 ├─ embrulhada pela passkey PRF do Mac         → envelope 1
 ├─ embrulhada pela passkey PRF do iPhone      → envelope 2
 └─ embrulhada pela chave de recuperação (HKDF de 256 bits) → envelope de recuperação
Registros: AES-256-GCM, com IV novo a cada gravação
```
- O PIN, quando ligado, só entra junto com a passkey: o envelope é embrulhado por PRF + PIN. Isso mantém o limite de tentativas e não permite ataque offline só com o PIN.
- O servidor guarda só os envelopes embrulhados. Nunca vê a chave do cofre nem o PIN.

## Banco (aditivo, sem tocar no antigo)
- Nova tabela `vaults`: id, dono, nome, tipo (`legacy_password` | `passkey`), parâmetros e data de criação.
- Nova tabela `vault_keyslots`: id do cofre, tipo (passkey, recuperação, PIN+passkey), id da credencial, apelido do aparelho, envelope, revogado_em e último uso.
- Nova tabela `vault_v2_entries`: registros do cofre novo, com chave estrangeira para `vaults` e sem cascata para o antigo.
- Nova tabela `vault_security_events`: só o tipo do evento, o aparelho e o horário, sem segredos.
- RLS por dono em todas as tabelas novas. Admin não ganha nenhuma leitura extra.
- `vault_entries`, `vault_settings` e `vault_pin_settings` **não são alteradas**. O cofre antigo aparece como "legado" só na leitura.

## Fases
1. **Preservação:** exportar os 14 registros e os metadados do cofre antigo (ainda embaralhados) em um arquivo baixado por você, e conferir pela impressão digital (SHA-256). Nada é gravado no banco.
2. **Código e testes isolados:** criptografia, envelopes, recuperação, revogação, PIN e bloqueio por inatividade, com testes automatizados e dados fictícios.
3. **Telas:**
   - "Cofre principal": botão Touch ID / Face ID, sem campo de senha.
   - Configuração inicial: criar a passkey e mostrar a chave de recuperação.
   - "Segurança": aparelhos, adicionar ou revogar, PIN, recuperação, bloqueio automático, exportar e histórico.
   - "Cofre anterior — 14 registros": bloqueado, com tentar senha e exportar.
4. **Migração do banco no ar:** só com sua autorização. São apenas tabelas novas.
5. **Publicação:** só com sua autorização.
6. **Migração futura:** quando a senha antiga aparecer, abrir os registros no aparelho, você confirma, eles são embrulhados de novo no cofre novo, e o antigo fica guardado.

## Limites honestos
- Se você perder **todos** os aparelhos e a chave de recuperação, o cofre novo fica irrecuperável. Essa é a garantia de que ninguém mais consegue abrir.
- A troca de senha de 27/09 continua sem solução sem a senha certa. Este plano não abre os 14 registros antigos.
