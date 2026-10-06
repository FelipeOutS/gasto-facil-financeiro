# WhatsApp 2.0 — Pesquisa Inteligente gratuita

Implementação local concluída em `feat/whatsapp-improvements`. **A feature flag `WHATSAPP_RESEARCH_ENABLED` continua desligada; não houve deploy nem migration remota.** O fluxo ainda requer homologação com conta real antes de ativação.

## Escopo e origem dos dados

- Explicações para CDI, IPCA, IP68, OLED, QLED, ARM e inverter usam a [Action API oficial da Wikimedia](https://www.mediawiki.org/wiki/API:Main_page), em português. A busca é `action=query&list=search`; texto, título e URL vêm de `action=query&prop=extracts|info`. O IPCA usa a seção própria da página para a qual seu título redireciona. Se a fonte não contém informação suficiente, a resposta informa a limitação.
- Trechos são abreviados por regra de código, com título, URL original retornada pela API e atribuição à Wikipédia/CC BY-SA 4.0. Não há HTML scraping, LLM nem enriquecimento por conhecimento do modelo.
- Produtos e comparações só apresentam informação contida nos artigos encontrados. Sem os dois artigos, a comparação de especificações é recusada. Wikimedia não fornece preço atual, estoque, ofertas, reviews de lojas nem recomendação subjetiva.
- Preços vêm **somente da mensagem do usuário** e são registrados no contexto como `USER_PROVIDED`. O tipo `SEARCH_VERIFIED` está reservado para eventual fonte estruturada futura; o MVP não o produz. `MODEL_GENERATED` não existe no tipo e é rejeitado ao recuperar contexto. Links enviados pelo usuário não são abertos; um valor escrito junto ao link continua sendo preço informado por ele.
- “Onde está mais barato?” compara somente valores fornecidos na conversa, se houver dois. Sem valores suficientes, solicita os preços; não consulta lojas. Ofertas amplas, como “notebooks até 4 mil”, não iniciam busca de varejo.
- “Cabe no meu orçamento?” lê apenas orçamento **total** configurado em `limites` e gastos registrados no mês em `gastos`, sem gravar dados financeiros. Explica que o restante registrado não é saldo bancário nem garantia de compra. Parcelas usam divisão exata de centavos sem juros hipotéticos.
- Contexto por usuário/telefone tem até três produtos, ordinais primeiro/segundo/terceiro e validade de 20 minutos na tabela `whatsapp_research_requests`. Apenas uma atualização de produtos/preços renova essa validade. A RPC da migration existente reserva mensagens de forma idempotente e limita pesquisas mensais.

## Segurança operacional

A integração usa User-Agent identificado, HTTPS, timeout de 8 segundos, respostas de tamanho limitado, cache em memória de 1 hora para artigo e 5 minutos para ausência, com no máximo 128 entradas. Mantém rate limit por usuário e cotas operacionais da RPC (padrão 300 por usuário e 20.000 globais por mês, configuráveis com `WHATSAPP_RESEARCH_MONTHLY_LIMIT` e `WHATSAPP_RESEARCH_GLOBAL_MONTHLY_LIMIT`). Erro da Wikimedia não aciona outro provedor. Respostas livres usam templates; não há chamadas pagas de IA no novo fluxo.

O provider OpenAI antigo permanece em `src/server/whatsapp-research-provider.server.ts` apenas como protótipo histórico; webhook e handler gratuito não o importam nem o instanciam. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, Tavily, Serper, Brave Search e Bing pago não são necessários e não podem ativar o MVP. `WHATSAPP_RESEARCH_ENABLED=true` ativa exclusivamente o caminho Wikimedia, após migration e homologação. **Não ativar a flag agora.**

A migration local `supabase/migrations/20261004150000_whatsapp_research.sql` foi reutilizada sem alteração. Os campos legados de token/provedor ficam nulos ou zero neste fluxo. O custo de API/IA paga **adicionado pela pesquisa nova** é R$ 0 por chamada; isso não mede custos da infraestrutura, Meta/WhatsApp, nem os fluxos preexistentes de áudio/OCR via Lovable AI Gateway.

## Exemplos e validação pendente

Menu: “✨ Pesquisa inteligente”. Ajuda: “Explique o que é IP68”, “Compare Galaxy X e Moto Y”, “Achei este por R$ 1.899”, “Isso cabe no meu orçamento?”. A flag desligada ainda responde que a pesquisa está em preparação.

Testes dirigidos: `tests/whatsapp-2_0-free-mvp.test.ts` e `tests/whatsapp-2_0-research.test.ts`. A homologação completa deverá validar webhook real, disponibilidade da Wikimedia, limites de mensagens Meta, migração aplicada no ambiente correto, expiração do contexto e interações com os comandos financeiros.

As quatro falhas antigas da execução de menu/resumo de 2026-10-04 foram resolvidas ou tiveram as expectativas atualizadas na homologação seguinte. As suítes WhatsApp e global locais passaram com zero falhas. Isso não substitui a validação com webhook, banco e conta reais antes da ativação. A [auditoria de fontes e custos](whatsapp-2_0-zero-cost-audit.md) registra a decisão que levou ao escopo reduzido.
