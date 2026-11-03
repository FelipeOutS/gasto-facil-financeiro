# Reorganização reversível — preparação local, não liberada

## Estado
Não é uma funcionalidade concluída nem pronta para ativação. O WhatsApp existente continua com seus serviços de áudio e autorização; pedidos novos de limpeza composta são interceptados sem gravar valores. Nenhuma migração, mudança de configuração, publicação, envio Meta ou exclusão financeira real foi realizada.

## Preparado
- Interpretador conservador para gastos/receitas, períodos com ano, meses anteriores, exceções/negações e receita posterior; utiliza `parseValor` central. Datas incompletas pedem esclarecimento; saldo inicial não vira receita.
- Contrato injetado de prévia, confirmação exata APAGAR + seis dígitos, cancelamento, resultado persistido e timeout sem alegar sucesso.
- SQL candidato `docs/migrations-candidate/whatsapp-reorganizacao.sql`: política ausente/desligada bloqueia execução; snapshots completos, ownership/vínculo/plano, expiração, exclusão com marcadores F2, receita na mesma transação e restauração por snapshot/stamp. O candidato não modifica o guard F2 e foi executado somente em PostgreSQL descartável.
- Códigos são exclusivos por titular/telefone e não reutilizados; confirmação busca o código exato, evitando cobrar tentativas de uma solicitação nova por código antigo. Falta limitação persistente de tentativas vinculada à operação antes da liberação.
- Restauração parcial preserva conflitos; SQL permite consultar/restaurar por referência explícita via controle interno. O adaptador e a conversa bloqueiam restauração até existir prévia/confirmacão própria; não desfazem a última operação implicitamente.

## Testes
134 testes em nove arquivos passaram quando executados separadamente: interpretação/pipeline novo (35), áudio (27), lote mensal (21), exclusão antiga (10), leitores F3 (5), atualização financeira (14), isolamento offline (17) e idempotência de receita offline (5).
Uma execução conjunta apresentou três falhas por colisão de mocks globais (query simulada sem `.order`); execução separada de todos os arquivos passou. Não é prova de funcionamento em produção.
31 verificações SQL locais passaram, incluindo F2 coerente, nenhuma exclusão física, operação composta/rollback, expiração/cancelamento, replay, ownership, cartões bloqueados, restauração parcial e duas conexões com aplicação única.

## Bloqueios de conclusão
1. **Barreira offline:** `offlineWriteDecision` é apenas contrato puro testado. Ainda não há geração persistente nem integração nos escritores/filas. Não impede sozinho que itens antigos reapareçam. Liberação proibida antes disso.
2. **Vínculos financeiros:** o candidato recusa todo escopo com cartões, parcelas, recorrências, bens, contas a pagar, importações ou Pluggy. Ainda não limpa essas estruturas; não anunciar reinício completo.
3. **Saldo inicial:** bancos são metadados; saldo do Dashboard é fluxo mensal. Novo modelo contábil requer decisão/revisão antes de escrever qualquer saldo. Não inventar receita substituta.
4. **Conversa completa:** esclarecimentos/edição da prévia, sessão persistente por operação, seleção de histórico, confirmação própria para restauração e envio de resposta reconciliado ainda precisam integração. Não liberar apenas alterando uma constante.
5. **Segurança e escala:** contratos JSON estritos/status específicos e tentativas precisam revisão adicional; locks conservadores de tabelas exigem testes de carga/deadlock. Recuperação parcial deve ter histórico por item e apresentação detalhada antes de uso.
6. **Atualização:** filtros e Realtime gastos/receitas foram reaproveitados/auditados, não alterados. Atualização dos demais módulos e funcionamento Android não comprovados. Wrapper nativo não está no repositório.
7. **Homologação:** não houve chamada real de IA/transcrição/WhatsApp nem fluxo autenticado de escrita no Preview; todas as mutações verificadas usam dados fictícios locais.

## Próxima autorização
Antes de qualquer alteração no banco real, apresentar revisão completa do candidato, pré-requisitos F2/F4 e plano de rollout. Ativação/publicação e teste financeiro real continuam exigindo autorizações separadas. Nenhum prazo de recuperação definitivo foi prometido. Consumo real de créditos não confirmado.