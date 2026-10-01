# WhatsApp Flow — Cadastro de cartão (configuração manual na Meta)

Nada disto foi feito na sua conta Meta. Enquanto o `flow_id` não estiver
configurado, o WhatsApp usa automaticamente o cadastro por conversa
(Nome → Limite → Fechamento → Vencimento → Confirmação).

## Dados do Flow
- Nome sugerido: `gi_cadastro_cartao`
- Categoria: **Other** (ou "Sign up")
- Modelo: sem endpoint (sem Data Exchange, sem chave de criptografia)
- Tela: `CADASTRO_CARTAO` com 4 campos — nome, limite, fechamento, vencimento
- Arquivo: `docs/whatsapp-flow/cadastro-cartao.flow.json`

## Passo a passo
1. Abra o WhatsApp Manager → **Conta** → **Flows** → **Criar Flow**.
2. Nome `gi_cadastro_cartao`, categoria Other, modelo **Sem modelo / Default**,
   e **não** configure endpoint.
3. No editor, apague o JSON de exemplo e cole o conteúdo de
   `cadastro-cartao.flow.json`. Clique em **Salvar**. Confira que não há erros.
4. Copie o **Flow ID** (número no topo do editor ou na lista de Flows).
5. Teste em rascunho (opcional, antes de publicar): no projeto, configure
   `WHATSAPP_CARD_FLOW_ID=<Flow ID>` e `WHATSAPP_CARD_FLOW_MODE=draft`.
   Mande "cadastrar cartão" do seu número e preencha o formulário.
6. Quando estiver tudo certo, clique em **Publicar** no WhatsApp Manager
   (Flow publicado não pode mais ser editado — para mudar, crie uma cópia).
7. Remova `WHATSAPP_CARD_FLOW_MODE` (ou deixe vazio) e mantenha
   `WHATSAPP_CARD_FLOW_ID=<Flow ID>`.

O Flow pertence à mesma conta comercial (WABA) do número atual — não há
vínculo extra por número.

## Onde configurar no projeto
Peça no chat: "configure o secret WHATSAPP_CARD_FLOW_ID com <número>". Sem
esse valor (ou com valor inválido), o cadastro por conversa continua ativo.
