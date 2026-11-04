# Auditoria de áudio WhatsApp — 04/11/2026

## Incidente real (horário de São Paulo)

| Etapa | Primeiro áudio, 20:48:00 | Segundo áudio, 20:48:58 |
|---|---|---|
| Webhook recebido | Sim, HTTP 200 | Sim, HTTP 200 |
| Tipo audio / ID de mídia | Sim; alcançou chamada de download | Sim; alcançou chamada de download |
| Download | Não; `network`, 20:48:03 | Não; `network`, 20:49:01 |
| Transcrição / interpretação | Não iniciadas | Não iniciadas |
| Resposta gerada / enviada | Não / não | Não / não |
| Operação financeira | Nenhuma por essa mensagem | Nenhuma por essa mensagem |

Associação aos conteúdos relatados segue a ordem informada pelo usuário; não há transcrição para confirmar o conteúdo. `webhook_logs` registrou `audio_indisponivel` nos dois casos. Nenhuma sessão em `whatsapp_messages` foi criada pelos dois IDs externos. Não houve chamada ao AI Gateway na janela. IDs de mídia, bytes e texto de voz não são mantidos para diagnóstico; não é possível recuperar esses áudios por esses registros.

Uma mensagem de texto `oi` anterior, às 20:45:43, teve resposta aceita pela Meta (HTTP 200) às 20:45:52 e callback `delivered` às 20:45:53. Isso comprova entrega daquela resposta de texto, não dos áudios.

## Causa reproduzida

O downloader usava `redirect: "error"`. Workerd rejeita essa opção antes de enviar a requisição, com TypeError. O wrapper convertia a exceção em `network`. Reproduzido usando workerd instalado e URL pública sem credenciais: `error` falhou, `manual` retornou HTTP 200. Referência: https://developers.cloudflare.com/workers/runtime-apis/request/

Correção: `manual` nas duas requisições de mídia; qualquer resposta não-2xx continua rejeitada, sem seguir Location. Mantidos hosts HTTPS autorizados, limites de bytes e tempos existentes. Áudio inválido/indisponível passa a receber resposta segura; falhas nesse envio têm diagnóstico sanitizado. Nenhum token, número, webhook, configuração Meta, saldo ou dado financeiro foi alterado.

## Validação

- 131 testes direcionados passaram em seis processos separados: áudio 20, bounded fetch/entrega 28, segurança 18, duração 16, fluxo simples fictício 5, versão Graph 44.
- Execução conjunta inicial teve interferência de mocks entre arquivos; execução isolada passou.
- Compilação automática: OK.
- Modelo existente preservado; catálogo autenticado confirmou disponibilidade.
- Fala sintética portuguesa, completa em OGG/Opus: endpoint de transcrição existente retornou HTTP 200 e texto compreensível, com uso reportado. O vocativo sintético "GI" foi reconhecido como "Sim"; não constitui validação verbatim ou teste dos áudios reais.
- Nenhum comando financeiro foi reenviado em produção e nenhum lançamento de R$ 2 foi criado pelo diagnóstico.

## Confirmação ainda necessária

Após publicação, novo áudio não financeiro enviado pelo usuário deve produzir download, transcrição, resposta aceita e callback de entrega. Apenas compilar, publicar ou gerar texto internamente não estabelece recuperação real. Não reenviar automaticamente o comando financeiro anterior.