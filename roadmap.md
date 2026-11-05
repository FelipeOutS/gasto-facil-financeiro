# Roadmap — WhatsApp por áudio

- [x] Áudios reais de 04/11 — download corrigido (redirect manual), transcrição validada; áudio das 21h06 confirmou recebimento/transcrição.
- [x] Portão de intenção (WA-INTENT-GATE) — pergunta "GI, você entende esse áudio?" não vira mais gasto; sem sinal financeiro → esclarecimento sem sessão; 14 testes novos, suíte oficial verde.

1. [ ] Exclusão/restauração individual — homologar no Draft 2 (F2 + v2, R$ 150 fictício), aplicar no banco real (autorizado), ligar flag, publicar.
2. [~] Exclusão/restauração em massa (código + SQL candidato prontos e testados; falta homologar no Draft 2) por período ("meses anteriores, manter o atual") E escopo total ("zerar tudo", inclui mês atual — distinção testada); confirmação por voz com 6 dígitos falados e "restaurar última limpeza" (RPC candidata `wa_reorganization_last_applied`); RPC transacional `wa_lote_mes_*`, prévia com totais, confirmação reforçada, restauração só do próprio lote.
3. [~] Saldo bancário (ajuste atual corrigido e testado; falta homologar) — ajuste "saldo do Nubank para R$ X" como observação/delta de conta (nunca receita), banco validado.
4. [~] Comando combinado (prévia mostra excluídos, de fora e ajuste; falta homologar) (2 + 3 numa só prévia/confirmação, tudo-ou-nada).
5. [ ] Vínculos: cartões/faturas, parcelas, recorrências, importações — writers compatíveis; até lá, excluídos da operação em massa e listados na prévia.
6. [ ] Homologação com áudio real (app Meta de teste) e publicação de cada etapa.

Bloqueios externos: instruções no chat do Draft 2; app Meta de teste com credenciais próprias.

## Limpeza total por áudio (owner-only)
- [x] Trava por conta (lista vazia por padrão) + ciclo zerar→restaurar testado em banco temporário (161 PASS)
- [x] Incluir cartão/fatura/parcelas/recorrências/importações/contas no zerar tudo (banco temporário: 211 PASS + conversa por voz)
- [x] Leituras do servidor (WhatsApp/alertas/lembretes, 16 arquivos) ignoram arquivados; novos lançamentos liberados após a limpeza; restauração preserva o que veio depois (banco temporário: 226 PASS)
- [ ] Confirmar qual das 2 contas de dono entra na lista de liberação; exportação de dados
- [ ] Itens 4 e 5 (banco real + publicação) — aguardando autorização
