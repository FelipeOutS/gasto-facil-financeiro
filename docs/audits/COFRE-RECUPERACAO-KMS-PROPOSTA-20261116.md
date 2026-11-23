# Proposta separada — recuperação assistida por servidor, opt-in

Status: somente proposta; nenhuma custódia, infraestrutura, segredo ou cobrança ativada.

## Arquitetura proposta

Usuário adere explicitamente enquanto a DEK já está legitimamente desbloqueada. A tela explica que o operador da infraestrutura de recuperação poderá recuperar essa chave. O cliente encapsula uma cópia da DEK com uma chave pública RSA-OAEP de recuperação; a privada fica não exportável em KMS/HSM, fora do Supabase e do código do aplicativo. Vincular usuário, vault, geração, consentimento/versionamento e parâmetros criptográficos dentro do conteúdo autenticado, sem tratar e-mail como material criptográfico.

O envelope é separado dos slots atuais. Cadastro comprova a chave existente e exige autenticação recente. Cada recuperação exige sessão Auth válida, e-mail verificado, desafio expirável de uso único, análise de risco e autenticação reforçada. Recomendação: fator independente do e-mail (TOTP/dispositivo), ou procedimento assistido com espera de 24–48 horas e avisos/cancelamento em canais previamente cadastrados. Se todos os fatores forem apenas o e-mail, invasão da caixa postal passa a permitir recuperação; isso precisa ser aceito explicitamente como risco, não descrito como proteção equivalente a MFA.

Serviço de recuperação dedicado, identidade de workload e IAM mínimo chama Decrypt no KMS. A DEK aparece transitoriamente na memória desse serviço e é reencapsulada para uma chave pública efêmera do cliente, ligada ao grant aprovado. Não armazenar senha nova, DEK, código nem material recuperado em logs. Este fluxo não promete que somente o HSM vê a DEK: o serviço também a processa. Uma solução que elimine esse acesso requer outro desenho e auditoria.

Depois: cliente prova que abre os dados, cria envelope da nova senha, confirma transação, bloqueia sessões e oferece revogação seletiva dos métodos comprometidos. Preservar passkeys/recuperação legítimas. Auditoria imutável, alertas, limites por usuário/vault/IP, aprovação dupla para operações operacionais sensíveis, segregação entre produção e teste, rota de cancelamento e testes periódicos de recuperação de desastre.

Retirar consentimento revoga o envelope ativo. Backups podem reter envelopes até expirar a retenção; não prometer apagamento imediato de todas as cópias. Evitar chave KMS exclusiva por usuário inicialmente; usar chaves por ambiente/tenant/geração, sem compartilhar identidades de teste com produção. Destruição de chave pode tornar todos os envelopes dependentes irrecuperáveis; aplicar espera, bloqueio de deleção e plano de rotação antes de habilitar.

## Custos de referência em USD

Preços oficiais consultados em 16/11/2026; exemplos aritméticos, não orçamento nem contratação. Referência Google Cloud KMS: https://cloud.google.com/kms/pricing (exemplo da própria página: US$0,06 por versão SOFTWARE/mês e US$0,03 por 10 mil operações; tabela horária de HSM RSA-2048 equivale aproximadamente a US$1 por versão/mês).

| Cenário | Versões ativas | Operações por mês | Componente KMS estimado |
| --- | ---: | ---: | ---: |
| Software, piloto | 2 | 10.000 | US$0,15/mês |
| Software, volume maior | 2 | 100.000 | US$0,42/mês |
| HSM gerenciado RSA-2048, piloto | 2 | 10.000 | aproximadamente US$2,03/mês |
| HSM gerenciado RSA-2048, volume maior | 2 | 100.000 | aproximadamente US$2,30/mês |

As operações incluem chamadas cobradas efetivas, não usuários: recuperação e obtenção de chave pública, entre outras. Região, algoritmo, novas versões de rotação, impostos e câmbio alteram o total. Não contabilizei franquias gratuitas. Não usar HSM single-tenant dedicado para este piloto; é uma categoria de preço diferente, muito superior.

Além do KMS: serviço dedicado, banco/fila, tráfego, auditoria/retencão, alertas, e-mails, suporte a recuperação, revisão independente e resposta a incidentes. Não há métricas de volume, tarifas contratadas de e-mail ou taxa/hora da equipe disponíveis; não é possível confirmar custo total. Estimativa de planejamento própria, a validar: 15–30 dias de engenharia/QA mais 3–5 dias de revisão externa. Converter em orçamento somente com taxa/hora, provedor/região e política de atendimento aprovados.

## Riscos e aprovação necessária

Concentração de poder no serviço/IAM, roubo de sessão/e-mail, engenharia social no suporte, administrador malicioso, indisponibilidade/falha de KMS, perda de versões, erros de vinculação entre usuários, custo operacional, ataques de repetição e retenção em backup. A promessa de criptografia deixa de ser estritamente sem custódia do operador para os usuários aderentes. Requer revisão de privacidade, consentimento informado, IAM, trilhas auditáveis e teste de desastre antes da liberação.

KMS NÃO recupera os 14 registros antigos se a chave original nunca foi encapsulada para ele e não puder ser obtida por outro método válido. Adesão somente pode ocorrer após recuperar legitimamente a chave. Nenhuma proposta exige alterar os parâmetros criptográficos antigos ou sobrescrever registros.
