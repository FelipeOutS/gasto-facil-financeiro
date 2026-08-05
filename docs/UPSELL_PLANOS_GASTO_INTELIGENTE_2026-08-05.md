# Upsell Inteligente de Planos - 2026-08-05

## 1. Estratégia
Implementação de comunicação não invasiva para conversão de usuários `free_ads` em planos pagos.

## 2. Público Elegível
- Usuários no plano `free_ads`.
- Conta com mais de 48h de criação.
- Não é Admin/Owner.
- Não possui assinatura ativa ou pendente.

## 3. Formatos
- **Banner Dashboard**: Discreto, fechável, frequência de 7 dias.
- **Modal Ocasional**: Impacto médio, frequência de 21 dias, delay de 5s após load.
- **Gate Contextual**: Aparece ao tentar acessar recurso bloqueado.

## 4. Persistência
Tabela `user_communication_preferences` gerencia:
- `last_banner_at`
- `last_modal_at`
- `snooze_until` (pausa após fechamento ou 3 recusas)
- `dismiss_count`

## 5. Configuração (Owner)
Tabela `upsell_runtime_config` permite ajustar intervalos e habilitar/desabilitar globalmente.

## Validação Final (Prompt 9G) - 2026-08-05
- **Elegibilidade**: Reforçada com trava de 5 lançamentos e 48h (Server-side).
- **Delay**: Implementado 5s no Banner após confirmação de elegibilidade.
- **RLS/Owner**: Auditado e confirmado.
- **Mercado Pago**: Preservado e isolado.
- **Classificação**: UPSELL VALIDADO EM PRODUÇÃO.
