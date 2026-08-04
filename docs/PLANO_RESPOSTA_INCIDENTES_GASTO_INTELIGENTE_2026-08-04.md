# Plano de Resposta a Incidentes - Gasto Inteligente

## 1. Introdução
Este documento define as diretrizes para identificação e resposta a incidentes de segurança e privacidade.

## 2. Canais de Detecção
- Monitoramento de erros (Sentry/LogSnag)
- Alertas de banco de dados (Supabase Health)
- Denúncias de usuários via suporte
- Auditorias automáticas de RLS

## 3. Classificação de Severidade
- **Crítica (P0):** Vazamento de dados financeiros ou credenciais, queda total do sistema.
- **Alta (P1):** Falha em fluxos de pagamento, acesso indevido a dados de outro usuário (IDOR).
- **Média (P2):** Bug funcional em módulo secundário, indisponibilidade parcial.
- **Baixa (P3):** Erro visual, texto incorreto.

## 4. Fluxo de Resposta
1. **Identificação:** Registro do incidente no log interno.
2. **Contenção:** Isolamento da conta ou rota afetada. Se necessário, bloqueio temporário via `whatsapp_runtime_config`.
3. **Erradicação:** Correção da vulnerabilidade ou bug.
4. **Recuperação:** Restauração de serviços e validação com testes de regressão.
5. **Comunicação:** Notificação aos usuários afetados em conformidade com a LGPD (se houver vazamento de dados pessoais).

## 5. Contatos de Emergência
- Time de Engenharia: [Inserir e-mail/contato]
- DPO (Privacidade): [Inserir e-mail/contato]
