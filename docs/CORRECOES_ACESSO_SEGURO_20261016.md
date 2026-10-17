# Correções de acesso seguro — 16/10/2026

## Escopo

Correção local na branch codex/fix-biometric-activation, baseada na main 2f8622b2. Commit e envio para revisão autorizados em 16/10. Sem merge, publicação, migrations ou alterações financeiras.

- Ativar usa gravação nativa confirmada, sem fallback para tokens em texto claro quando o canal seguro existe.
- Desativar aguarda confirmação da exclusão nativa antes de remover preferências e mostrar sucesso. Falhas preservam a indicação de acesso ativo.
- Falhas transitórias de rede/503 ou leitura não apagam o acesso nem autorizam login. Somente códigos explícitos de invalidação revogam a cópia local.
- Desbloqueios simultâneos compartilham uma operação. O APK novo devolve Promise correlacionada à requisição; eventos de operações anteriores não completam outra solicitação. APKs antigos continuam com o protocolo de eventos legado.
- Falha de renovação é informada ao usuário, sem invalidar a sessão online já validada. A cópia antiga é preservada; a reativação pode ser necessária se a gravação continuar falhando.
- Android só remove a credencial em erro criptográfico quando a chave está explicitamente invalidada. Erros transitórios, stale state e exceções ambíguas preservam o armazenamento.

## Validação

19 testes web aprovados, incluindo regressões anteriormente reproduzidas. Typecheck aprovado. Android: 40 testes unitários e 13 testes instrumentados distintos aprovados (executados em duas rodadas), sem skips; pacote isolado .offlinevalidation. Build APK e lint aprovados. Assinatura APK verificada.

Não foi realizada autenticação biométrica manual no celular do usuário nesta rodada. O resultado automatizado não substitui essa homologação.

## Entrega e publicação pendente

APK debug: Gasto-Inteligente-biometria-20261016.apk (artefato local, não versionado)
SHA256: 6799FE9DFA8A6772AFAC6723FD31DA3B3D3FDFD9169EBB87F1944E43BC1ED5E3

O APK mantém a URL de produção. A ativação/desativação da tela depende da publicação da correção web. Não apresentar a instalação do APK isoladamente como solução completa. Integrar sobre a main atual preservando alterações do Lovable; publicar somente com autorização. Após atualizar ambas as partes, homologar ativar, sair/entrar, cancelar, falha de rede, desativar e reabrir. Não limpar dados do app: pode haver lançamentos offline pendentes.

Build web aprovado (exit 0).
