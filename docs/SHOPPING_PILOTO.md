# Piloto do Assistente de Compras (WhatsApp)

Ninguém usa o assistente sem as TRÊS condições: flag ligada, usuário na lista do piloto e plano pago com número vinculado.
Nunca cole chave ou ID no chat.

## Ordem obrigatória
1. Instalar e verificar `docs/migrations-candidate/whatsapp-shopping-quota.sql` (cota 10/usuário, 200 globais). Sem ele, a busca falha fechada.
2. Lovable → Project Settings → Secrets → **Add secret**:
   - Nome `SERPAPI_API_KEY` → cole a chave da SerpApi (a do seu Mac, direto no campo, sem mandar em mensagens).
   - Nome `WHATSAPP_SHOPPING_PILOT_USER_IDS` → o ID da sua conta (UUID). Vários: separados por vírgula. Qualquer item inválido bloqueia todos.
3. Só depois: Secret `WHATSAPP_SHOPPING_ENABLED` = `true`.
4. Teste pelo seu número: "quero comprar macbook air m4 16gb", depois "e em 12x?" (não gasta nova busca).

## Desligar
Troque `WHATSAPP_SHOPPING_ENABLED` para `false` ou apague `WHATSAPP_SHOPPING_PILOT_USER_IDS`.
