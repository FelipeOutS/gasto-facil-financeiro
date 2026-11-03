# Homologação executável — não executar em produção

## Automação isolada disponível
- `bash scripts/test-whatsapp-reorganizacao-sql.sh`: inicia PostgreSQL descartável em socket `/tmp`, aplica candidatos somente nesse banco, testa pagamentos/saldo/concorrência/barreiras e chama a conversa real por `scripts/test-reorganization-conversation.ts`. Remove banco ao terminar.
- `bun test tests/financial-accounting.test.ts`: regras de receita, pagamento, ajuste, exclusão e restituição; comando exato transcrito.
- `python3 scripts/check-reorganization-web.py`: parser real no Chromium; não grava nem homologa Android.
- `bun scripts/inventory-financial-writers.ts`: inventário estático; revisar SQL/RPCs e tabelas dinâmicas além dos resultados.

## Áudio e Android reais — não executados
Recursos verificados em 03/11: credenciais Meta e integração oficial já existem; não pedir revalidação do número. PostgreSQL/Bun/Playwright e scripts disponíveis. SDK/adb/Java/Gradle/emulador/APK/fontes Android ausentes. Procedimentos específicos dos recursos faltantes e tabela das integrações: `WHATSAPP_REORGANIZACAO_INTEGRACOES_2026-11-03.md`. Não usar Preview compartilhado com produção para escrita de homologação.
Pré-requisito: backend descartável e APK de homologação apontando exclusivamente para ele; conta fictícia elegível/vinculada, consentimento e número Meta de teste. Não redirecionar callbacks do número de produção.
1. Criar fixtures de mês anterior/atual, compras pagas/parciais e conta Nubank com saldo contábil de R$ 3.000; registrar hashes e contagens.
2. Gravar áudio: “GI, exclua todas as minhas despesas e receitas de todos os meses anteriores, mantenha os dados do mês atual e ajuste meu saldo do Nubank para R$ 5.000.”
3. Enviar no número de teste; guardar ID inbound, resultado da transcrição, ID de lote, prévia e callback Meta. Confirmar nenhum write antes do código.
4. Confirmar APAGAR + lote + código; repetir a mesma mensagem para provar replay. Verificar histórico, mês atual, saldo de 5000 por ajuste de 2000, nenhum recebimento novo, faturas e pagamentos intactos.
5. No APK, entrar offline, criar fila antiga, reiniciar, reconectar após operação e trocar titular. Confirmar rejeição de versão antiga, persistência da pendência e nenhum vazamento entre titulares.
6. Solicitar restauração por lote, confirmar código próprio. Verificar IDs originais, compensação do ajuste e pagamentos inalterados; editar um registro antes do desfazer para validar recusa/conflito.
7. Conferir Dashboard, contas, Relatórios e cartões autenticados. Guardar screenshots, logs sem tokens e hashes antes/depois. Sem essas evidências, não aprovar.

## Migração/rollout ainda necessários
Revisar todos os candidatos como conjunto, F2/F4 e snapshot do schema real; aplicar primeiro somente no ambiente isolado. Code flag e política SQL continuam desligadas. A barreira de módulos vinculados é quarentena: writers incompatíveis serão recusados, não automaticamente adaptados. Não ativar enquanto o inventário e o contrato das importações/recorrências/contas conectadas não forem migrados e testados.