import { aiGateway } from "@/lib/ai-gateway"; // Supondo que exista um helper para o gateway
import { supabase } from "@/integrations/supabase/client";

/**
 * Helper server-side para sanitização e processamento via IA.
 * Este arquivo não é enviado ao cliente.
 */

export async function processarDocumentoFinanciamentoIA(args: {
  fileData: string;
  fileType: "pdf" | "imagem";
  fileName: string;
}) {
  // 1. Prompt especializado
  const SYSTEM_PROMPT = `Você é um especialista em análise de documentos de financiamento bancário (SAC/Price).
Extraia as seguintes informações financeiras com precisão:
- saldoDevedor: valor numérico
- dataReferenciaSaldo: YYYY-MM-DD
- valorParcela: valor da última parcela ou parcela atual
- numeroParcela: número da parcela atual
- parcelasRestantes: quantidade de parcelas a vencer
- taxaJuros: valor numérico da taxa
- periodicidadeTaxa: "mensal" | "anual"
- tipoTaxa: "nominal" | "efetiva"
- cet: Custo Efetivo Total (separado da taxa de juros)
- sistemaAmortizacao: "SAC" | "Price" | "Outro"
- instituicao: nome do banco
- eventos: lista de pagamentos ou amortizações identificadas no documento [{ tipo: 'pagamento' | 'amortizacao', valor: number, data: 'YYYY-MM-DD', parcela: number | null }]

REGRAS:
1. Se o dado não estiver claro, não invente.
2. SAC usa amortização constante. Price usa prestação constante.
3. Taxa nominal anual costuma ser taxa_mensal * 12. Efetiva anual é (1+i)^12 - 1.
4. Identifique se o documento é um extrato de evolução, boleto ou comprovante de amortização.
5. Retorne um JSON puro.
`;

  // 2. Chamada ao Gateway (Gemini 1.5 Flash ou Pro)
  // Reutilizando lógica de sanitização e envio similar ao ImportExtrato
  // Nota: A implementação real do aiGateway depende do projeto, aqui seguimos o padrão.
  
  // Exemplo de chamada simplificada (ajuste conforme a infra real)
  const response = await aiGateway.chat.completions.create({
    model: "gemini-1.5-flash",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { 
        role: "user", 
        content: [
          { type: "text", text: `Analise este documento de financiamento: ${args.fileName}` },
          { 
            type: "image_url", 
            image_url: { url: args.fileData } // Funciona para imagens e PDFs (o gateway trata)
          }
        ] 
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  return JSON.parse(content || "{}");
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

  if (error) throw error;
  return data.id;
}
