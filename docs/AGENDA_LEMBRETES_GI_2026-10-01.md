# GI Agenda e Lembretes — configuração externa pendente

Nada abaixo foi configurado. Tudo funciona internamente (site + WhatsApp); só o **envio automático** depende destes passos.

## 1. Templates Meta (categoria UTILITY, pt_BR)

`gi_agenda_financeiro` — variáveis em `payload.agenda_params` (preenchidas no envio, valores atuais):
```
🔔 Lembrete do Gasto Inteligente
{{1}} vence em {{2}}.
Valor atual: {{3}}
Vencimento: {{4}}
```
Ex.: {{1}}=Fatura Nubank, {{2}}=3 dias, {{3}}=R$ 356,00, {{4}}=05/11/2026

`gi_agenda_lembrete`:
```
🔔 Lembrete do Gasto Inteligente
{{1}}
🗓️ {{2}}
```
Ex.: {{1}}=Dentista, {{2}}=Amanhã às 14:00

Após aprovação: cadastrar os dois em `whatsapp_notification_templates` / mapeamento Meta (mesmo processo dos templates `gi_conta_*`), apontando os parâmetros para `agenda_params[0..3]`.

## 2. Scheduler
O dispatcher existente (`/api/public/hooks/whatsapp-dispatcher`) já processa a categoria `agenda`. Ativar seguindo o mesmo cron já documentado nele, com `WHATSAPP_DISPATCH_ENABLED=true`.

## 3. Regras de envio (já implementadas)
- Antes de enviar: item precisa estar ativo; conta paga/cancelada → `payable_paid`/`payable_cancelled`; vencimento alterado → `agenda_changed` + novo aviso no horário certo.
- Valor/vencimento sempre lidos da origem no momento do envio.
- Preferência: `whatsapp_notification_preferences.agenda` (padrão ligado), quiet hours e opt-in existentes.

## 4. Google Calendar
Não implementado. `agenda_items` é a fonte única; uma futura sincronização deve ler/escrever nela.
