import { supabase } from "@/integrations/supabase/client";

/**
 * OCR de documento de financiamento — serviço único reutilizável (V4).
 * Reutiliza o Lovable AI Gateway (Gemini 2.0 Flash) para extrair dados
 * estruturados de financiamentos (SAC/Price, taxas, saldos).
 */

const SYSTEM_PROMPT = `Você é um especialista em análise de documentos de financiamento bancário brasileiro (SAC/Price).
OBJETIVO: Extrair informações financeiras estruturadas para ajudar no preenchimento de um sistema de controle.

EXTRAIA (em JSON):
- saldoDevedor: valor numérico (ex: 350000.50)
- dataReferenciaSaldo: YYYY-MM-DD (data do saldo informado)
- valorParcela: valor da parcela atual ou demonstrada
- numeroParcela: número da parcela (ex: 32)
- totalParcelas: total contratado (ex: 360)
- taxaJuros: valor numérico (ex: 9.85)
- periodicidadeTaxa: "mensal" | "anual"
- tipoTaxa: "nominal" | "efetiva"
- cet: Custo Efetivo Total (número)
- sistemaAmortizacao: "sac" | "price" | "outro"
- instituicao: nome do banco/financeira
- eventos: lista de pagamentos ou amortizações identificadas [{ tipo: 'pagamento' | 'amortizacao', valor: number, data: 'YYYY-MM-DD', parcela: number | null }]

REGRAS:
1. NUNCA invente dados. Se não houver clareza sobre o tipo de taxa (nominal vs efetiva), marque o campo mas adicione uma observação.
2. SAC: Amortização constante, parcelas decrescentes. Price: Prestações iguais.
3. Taxa nominal anual = mensal * 12. Efetiva anual = (1+i)^12 - 1.
4. Identifique o documento: Demonstrativo, Boleto, Evolução, Comprovante.
5. Retorne "confianca": "alta" | "media" | "baixa" para cada campo principal.
6. TAXAS AMBÍGUAS: Se aparecer apenas um percentual (ex: "10,5%") sem indicar se é anual/mensal ou nominal/efetiva, NÃO decida silenciosamente. Defina os campos correspondentes como null e explique na "observacao" que a taxa é ambígua e requer revisão manual.

PRIVACIDADE: Omita CPFs, números completos de conta/cartão e endereços. NUNCA retorne o conteúdo integral do documento, apenas os campos solicitados.`;

const TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "registrar_dados_financiamento",
    description: "Estrutura os dados de financiamento extraídos do documento.",
    parameters: {
      type: "object",
      properties: {
        saldoDevedor: { type: ["number", "null"] },
        dataReferenciaSaldo: { type: ["string", "null"] },
        valorParcela: { type: ["number", "null"] },
        numeroParcela: { type: ["number", "null"] },
        totalParcelas: { type: ["number", "null"] },
        taxaJuros: { type: ["number", "null"] },
        periodicidadeTaxa: { type: ["string", "null"], enum: ["mensal", "anual", null] },
        tipoTaxa: { type: ["string", "null"], enum: ["nominal", "efetiva", null] },
        cet: { type: ["number", "null"] },
        sistemaAmortizacao: { type: ["string", "null"], enum: ["sac", "price", "outro", null] },
        instituicao: { type: ["string", "null"] },
        eventos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string", enum: ["pagamento", "amortizacao"] },
              valor: { type: "number" },
              data: { type: ["string", "null"] },
              parcela: { type: ["number", "null"] }
            }
          }
        },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        observacao: { type: ["string", "null"] }
      },
      required: ["confianca"],
      additionalProperties: false
    }
  }
};

export async function processarDocumentoFinanciamentoIA(args: {
  fileData: string;
  fileType: "pdf" | "imagem";
  fileName: string;
}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");

  // O Gateway trata PDF e Imagens via image_url (data URL)
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Analise este documento de financiamento: ${args.fileName}` },
            { type: "image_url", image_url: { url: args.fileData } },
          ],
        },
      ],
      tools: [TOOL_DEF],
      tool_choice: { type: "function", function: { name: "registrar_dados_financiamento" } },
    }),
  });

  if (!aiResp.ok) {
    const errorText = await aiResp.text();
    console.error("[bens.server] AI gateway error", aiResp.status, errorText);
    throw new Error("Falha na análise do documento pela IA.");
  }

  const json = await aiResp.json();
  const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("A IA não conseguiu ler este documento.");

  return JSON.parse(argsStr);
}

export async function salvarRastroProcessamento(args: {
  userId: string;
  bemId: string;
  financiamentoId?: string;
  nomeArquivo: string;
  tamanhoArquivo: number;
  dadosExtraidos: any;
}) {
  const { data, error } = await supabase
    .from("bens_documentos_processados")
    .insert({
      user_id: args.userId,
      bem_id: args.bemId,
      financiamento_id: args.financiamentoId || null,
      nome_arquivo: args.nomeArquivo,
      tamanho_arquivo: args.tamanhoArquivo,
      dados_extraidos: args.dadosExtraidos,
      status: "pendente"
    })
    .select("id")
    .single();

  if (error) {
    console.error("[bens.server] Erro ao salvar rastro", error);
    throw error;
  }
  return data.id;
}

