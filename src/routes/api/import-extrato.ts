import { createFileRoute } from "@tanstack/react-router";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Importação de extrato bancário (Pix, transferências, débito, tarifas, entradas, saídas).
 *
 * Aceita:
 *   - { pdf: "data:application/pdf;base64,..." }            → PDF (texto ou OCR)
 *   - { imagens: ["data:image/jpeg;base64,...", ...] }      → até 10 imagens/prints
 *
 * NUNCA persiste nada — apenas devolve sugestões para o usuário revisar.
 * Mascara CPF, número de cartão completo, agência/conta longas antes de mandar pra IA.
 */

const CATEGORIAS_VALIDAS = [
  "aluguel",
  "moradia",
  "mercado",
  "alimentacao",
  "transporte",
  "casa",
  "saude",
  "lazer",
  "educacao",
  "contas",
  "assinaturas",
  "farmacia",
  "online",
  "presentes",
  "pet",
  "trabalho",
  "roupas",
  "besteiras",
  "cabeleireiro",
  "outros",
];

const FORMAS_VALIDAS = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "vale_alimentacao",
  "vale_refeicao",
  "outro",
];

const TIPOS_MOV = ["despesa", "receita", "transferencia_interna"] as const;

const SYSTEM_PROMPT = `Você analisa EXTRATOS BANCÁRIOS brasileiros (Pix, transferências, TED, débito, tarifas, entradas e saídas).

OBJETIVO: extrair UMA LISTA de movimentações da conta. Para CADA item, preencha:
- descricao: descrição curta e clara do lançamento (ex: "Pix recebido de João", "Compra no débito - Padaria")
- valor: SEMPRE positivo, em reais. Vírgula é decimal, ponto é milhar.
- data: ISO YYYY-MM-DD
- horario: HH:mm 24h se aparecer, senão null
- tipoMovimentacao: "despesa" | "receita" | "transferencia_interna"
- formaPagamento: um destes ids → ${FORMAS_VALIDAS.join(", ")}
- categoriaSugerida: um destes ids (use "outros" se não souber) → ${CATEGORIAS_VALIDAS.join(", ")}
- contraparte: nome do remetente/destinatário se aparecer (ex: "MARIA DA SILVA"), curto, sem CPF/CNPJ
- confianca: "alta" | "media" | "baixa"

REGRAS DE CLASSIFICAÇÃO:
- Pix enviado, compra no débito, pagamento de boleto, tarifa, IOF, anuidade → tipoMovimentacao="despesa"
- Pix recebido, salário, transferência recebida, reembolso, estorno, rendimento → tipoMovimentacao="receita"
- "Transferência entre contas próprias", "Aplicação", "Resgate de investimento", "Movimentação interna" → tipoMovimentacao="transferencia_interna"
- IGNORE linhas que claramente NÃO são lançamentos: saldo anterior, saldo do dia, total, subtotal, cabeçalhos.
- IGNORE faturas de cartão de crédito (esse fluxo é separado). Compras com cartão de CRÉDITO no extrato bancário só aparecem como "PAGAMENTO DE FATURA" → trate como despesa do tipo "boleto" ou "transferencia".

FORMA DE PAGAMENTO heurística:
- "PIX" → pix
- "TED", "DOC", "TRANSF" → transferencia
- "DÉBITO", "DEB", "COMPRA NO DÉBITO" → debito
- "BOLETO", "PGTO BOLETO" → boleto
- "TARIFA", "IOF", "ANUIDADE" → outro
- Crédito de salário, depósito → transferencia

CATEGORIA SUGERIDA heurística:
- iFood/restaurante/lanchonete → alimentacao
- Uber/99/posto/combustível → transporte
- Netflix/Spotify/assinatura → assinaturas
- Farmácia/drogaria → farmacia
- Mercado/supermercado/atacado → mercado
- Shopee/Amazon/Magalu → online
- Conta de luz/água/internet/telefone → contas
- Salário/freelance/comissão → trabalho
- Tarifa bancária, IOF → contas

PRIVACIDADE — NUNCA inclua na descrição: número completo do cartão, CVV, senha, CPF, número completo de conta/agência. Se aparecer, omita ou mascare.

Se o conteúdo não parece um extrato legível, retorne itens=[] com observacao explicando.`;

type ItemBruto = {
  descricao: unknown;
  valor: unknown;
  data: unknown;
  horario?: unknown;
  tipoMovimentacao?: unknown;
  formaPagamento?: unknown;
  categoriaSugerida?: unknown;
  contraparte?: unknown;
  confianca?: unknown;
  observacao?: unknown;
};

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "registrar_movimentacoes_extrato",
    description: "Estrutura a lista de movimentações encontradas no extrato bancário.",
    parameters: {
      type: "object",
      properties: {
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              descricao: { type: ["string", "null"] },
              valor: { type: ["number", "null"] },
              data: { type: ["string", "null"] },
              horario: { type: ["string", "null"] },
              tipoMovimentacao: {
                type: "string",
                enum: [...TIPOS_MOV],
              },
              formaPagamento: {
                type: ["string", "null"],
                enum: [...FORMAS_VALIDAS, null],
              },
              categoriaSugerida: {
                type: ["string", "null"],
                enum: [...CATEGORIAS_VALIDAS, null],
              },
              contraparte: { type: ["string", "null"] },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
              observacao: { type: ["string", "null"] },
            },
            required: ["confianca", "tipoMovimentacao"],
            additionalProperties: false,
          },
        },
        observacao: { type: ["string", "null"] },
      },
      required: ["itens"],
      additionalProperties: false,
    },
  },
};

function decodeBase64Pdf(dataUri: string): Uint8Array | null {
  const m = dataUri.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  const b64 = m ? m[1] : dataUri.startsWith("data:") ? null : dataUri;
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function sanitizeText(text: string): string {
  return text
    // 16 dígitos com ou sem espaços/hífens → mantém só últimos 4
    .replace(/\b(?:\d[ -]?){12}(\d{4})\b/g, "**** **** **** $1")
    // CPF formatado
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    // CPF sem formato (11 dígitos isolados)
    .replace(/(?<!\d)\d{11}(?!\d)/g, "[CPF]")
    // CNPJ
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[CNPJ]")
    // Agência/conta longas (ex: 1234-5 / 12345678-9)
    .replace(/\bAg(?:ência|encia)?[:\s]*\d{4,6}[-\s]?\d{0,2}\b/gi, "[Agência]")
    .replace(/\bConta[:\s]*\d{5,}[-\s]?\d{0,2}\b/gi, "[Conta]")
    // CVV
    .replace(/\bCVV[:\s]*\d{3,4}\b/gi, "[CVV]")
    .slice(0, 80_000);
}

async function callGemini(apiKey: string, messages: unknown[]) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      tools: [TOOL_SCHEMA],
      tool_choice: {
        type: "function",
        function: { name: "registrar_movimentacoes_extrato" },
      },
    }),
  });
}

function normalizeItens(rawItens: ItemBruto[]) {
  return rawItens
    .map((it) => {
      const valorRaw = typeof it.valor === "number" ? it.valor : null;
      const valor = valorRaw !== null && valorRaw !== 0 ? Math.abs(valorRaw) : null;
      const data =
        typeof it.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.data) ? it.data : null;
      const horarioMatch =
        typeof it.horario === "string" ? it.horario.match(/\b(\d{1,2})[:hH](\d{2})\b/) : null;
      const horario = horarioMatch
        ? `${String(Math.min(23, parseInt(horarioMatch[1], 10))).padStart(2, "0")}:${String(
            Math.min(59, parseInt(horarioMatch[2], 10)),
          ).padStart(2, "0")}`
        : null;
      const tipoMovimentacao =
        it.tipoMovimentacao === "despesa" ||
        it.tipoMovimentacao === "receita" ||
        it.tipoMovimentacao === "transferencia_interna"
          ? it.tipoMovimentacao
          : "despesa";
      const formaPagamento =
        typeof it.formaPagamento === "string" && FORMAS_VALIDAS.includes(it.formaPagamento)
          ? it.formaPagamento
          : tipoMovimentacao === "receita"
            ? "transferencia"
            : "outro";
      const cat =
        typeof it.categoriaSugerida === "string" &&
        CATEGORIAS_VALIDAS.includes(it.categoriaSugerida)
          ? it.categoriaSugerida
          : null;
      const desc = typeof it.descricao === "string" ? it.descricao.slice(0, 120) : null;
      const contraparte =
        typeof it.contraparte === "string" ? it.contraparte.slice(0, 80) : null;
      const conf =
        it.confianca === "alta" || it.confianca === "media" || it.confianca === "baixa"
          ? it.confianca
          : "baixa";
      return {
        descricao: desc,
        valor,
        data,
        horario,
        tipoMovimentacao,
        formaPagamento,
        categoriaSugerida: cat,
        contraparte,
        confianca: conf,
        observacao:
          typeof it.observacao === "string" ? it.observacao.slice(0, 200) : null,
      };
    })
    .filter((it) => it.valor !== null || it.descricao);
}

export const Route = createFileRoute("/api/import-extrato")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json(
              { error: "LOVABLE_API_KEY não configurada." },
              { status: 500 },
            );
          }

          const contentType = request.headers.get("content-type") || "";

          // ---------- PDF via multipart/form-data (caminho preferido p/ PDFs) ----------
          if (contentType.includes("multipart/form-data")) {
            let form: FormData;
            try {
              form = await request.formData();
            } catch (err) {
              console.error("[import-extrato] formData parse error", err);
              return Response.json(
                { error: "Não consegui ler o arquivo enviado. Tente novamente." },
                { status: 400 },
              );
            }
            const file = form.get("pdf");
            if (!(file instanceof File)) {
              return Response.json(
                { error: "Envie um arquivo PDF no campo 'pdf'." },
                { status: 400 },
              );
            }
            if (file.size === 0) {
              return Response.json(
                { error: "Arquivo PDF vazio." },
                { status: 400 },
              );
            }
            if (file.size > 15 * 1024 * 1024) {
              return Response.json(
                { error: "PDF muito grande. Tente um arquivo menor que 15 MB." },
                { status: 413 },
              );
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            return await processPdfBytes(bytes, apiKey);
          }

          // ---------- JSON (compat: imagens, ou pdf em base64 quando bem pequeno) ----------
          let body: { pdf?: string; imagens?: string[] };
          try {
            body = (await request.json()) as { pdf?: string; imagens?: string[] };
          } catch {
            return Response.json(
              { error: "Requisição inválida." },
              { status: 400 },
            );
          }

          // ---------- PDF (compat JSON base64) ----------
          if (typeof body?.pdf === "string" && body.pdf.length > 0) {
            const bytes = decodeBase64Pdf(body.pdf);
            if (!bytes || bytes.length === 0) {
              return Response.json(
                { error: "Envie um arquivo PDF válido." },
                { status: 400 },
              );
            }
            if (bytes.length > 12 * 1024 * 1024) {
              return Response.json(
                { error: "PDF muito grande. Tente um arquivo menor que 12 MB." },
                { status: 413 },
              );
            }
            return await processPdfBytes(bytes, apiKey);
          }

          // ---------- Imagens ----------
          if (Array.isArray(body?.imagens) && body.imagens.length > 0) {
            const imgs = body.imagens.slice(0, 10).filter((s) => typeof s === "string");
            if (imgs.length === 0) {
              return Response.json(
                { error: "Envie ao menos uma imagem do extrato." },
                { status: 400 },
              );
            }
            // Cap simples de tamanho total (~30MB de base64)
            const totalSize = imgs.reduce((s, i) => s + i.length, 0);
            if (totalSize > 30 * 1024 * 1024) {
              return Response.json(
                { error: "Imagens muito grandes. Reduza a quantidade ou qualidade." },
                { status: 413 },
              );
            }

            const messages = [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Estes são ${imgs.length} print(s) do meu extrato bancário. Extraia a lista de movimentações de TODAS as imagens, sem repetir.`,
                  },
                  ...imgs.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                ],
              },
            ];

            const aiResp = await callGemini(apiKey, messages);
            return await handleAIResponse(aiResp, 0, "ocr");
          }

          return Response.json(
            { error: "Envie um PDF ou imagens do extrato." },
            { status: 400 },
          );
        } catch (err) {
          console.error("[import-extrato] erro", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Erro desconhecido" },
            { status: 500 },
          );
        }
      },
    },
  },
});

// (helper removido — não mandamos mais o PDF como image_url ao gateway)


async function processPdfBytes(bytes: Uint8Array, apiKey: string) {
  let extractedText = "";
  let totalPages = 0;
  try {
    const docProxy = await getDocumentProxy(bytes);
    totalPages = docProxy.numPages;
    const result = await extractText(docProxy, { mergePages: true });
    extractedText =
      typeof result.text === "string"
        ? result.text
        : (result.text as string[]).join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) {
      return Response.json(
        {
          error:
            "Este PDF parece estar protegido por senha. Exporte uma versão sem senha ou envie prints do extrato.",
        },
        { status: 400 },
      );
    }
    console.error("[import-extrato] extractText error", msg);
  }

  const cleanText = sanitizeText(extractedText.trim());
  // Limiar baixo: qualquer extrato real tem facilmente >50 chars.
  const hasUsefulText = cleanText.length > 50;

  if (!hasUsefulText) {
    // Sem texto extraível. Não tentamos mandar o PDF inteiro como image_url
    // ao Gemini porque o gateway costuma responder 502 nesse caminho.
    // O usuário deve enviar prints (caminho de imagens já funciona bem).
    return Response.json(
      {
        error:
          "Esse PDF parece ser escaneado (sem texto selecionável). Tente exportar uma versão com texto, ou envie prints do extrato — o app lê imagens normalmente.",
      },
      { status: 422 },
    );
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Texto extraído do extrato bancário em PDF. Extraia a lista de movimentações.\n\n----INÍCIO----\n${cleanText}\n----FIM----`,
    },
  ];

  const aiResp = await callGemini(apiKey, messages);
  return await handleAIResponse(aiResp, totalPages, "texto");
}


async function handleAIResponse(aiResp: Response, paginas: number, modo: string) {
  if (!aiResp.ok) {
    const text = await aiResp.text();
    console.error("[import-extrato] AI gateway error", aiResp.status, text);
    if (aiResp.status === 429) {
      return Response.json(
        { error: "Muitas leituras seguidas. Tenta de novo em alguns segundos." },
        { status: 429 },
      );
    }
    if (aiResp.status === 402) {
      return Response.json(
        { error: "Sem créditos da IA. Adicione créditos no workspace para continuar." },
        { status: 402 },
      );
    }
    return Response.json(
      {
        error:
          "A leitura inteligente está instável agora. Tente novamente em instantes — ou envie prints do extrato (esse caminho costuma funcionar).",
      },
      { status: 502 },
    );
  }

  const json = await aiResp.json();
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) {
    return Response.json(
      { error: "A IA não conseguiu estruturar o extrato." },
      { status: 502 },
    );
  }
  let parsed: { itens?: ItemBruto[]; observacao?: unknown };
  try {
    parsed = JSON.parse(argsStr);
  } catch {
    return Response.json({ error: "Resposta inválida da IA." }, { status: 502 });
  }
  const itensRaw = Array.isArray(parsed.itens) ? parsed.itens : [];
  const itens = normalizeItens(itensRaw);

  return Response.json({
    itens,
    paginas,
    modo,
    observacao: typeof parsed.observacao === "string" ? parsed.observacao : null,
  });
}
