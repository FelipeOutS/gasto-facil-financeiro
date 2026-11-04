# Roadmap — WhatsApp por áudio

1. [ ] Exclusão/restauração individual — homologar no Draft 2 (F2 + v2, R$ 150 fictício), aplicar no banco real (autorizado), ligar flag, publicar.
2. [~] Exclusão/restauração em massa (código + SQL candidato prontos e testados; falta homologar no Draft 2) por período ("meses anteriores, manter o atual") — RPC transacional `wa_lote_mes_*`, prévia com totais, confirmação reforçada, restauração só do próprio lote.
3. [~] Saldo bancário (ajuste atual corrigido e testado; falta homologar) — ajuste "saldo do Nubank para R$ X" como observação/delta de conta (nunca receita), banco validado.
4. [~] Comando combinado (prévia mostra excluídos, de fora e ajuste; falta homologar) (2 + 3 numa só prévia/confirmação, tudo-ou-nada).
5. [ ] Vínculos: cartões/faturas, parcelas, recorrências, importações — writers compatíveis; até lá, excluídos da operação em massa e listados na prévia.
6. [ ] Homologação com áudio real (app Meta de teste) e publicação de cada etapa.

Bloqueios externos: instruções no chat do Draft 2; app Meta de teste com credenciais próprias.
