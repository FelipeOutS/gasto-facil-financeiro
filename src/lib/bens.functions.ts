import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { 
  processarDocumentoFinanciamentoIA, 
  salvarRastroProcessamento 
} from "./bens.server";

const processarInputSchema = z.object({
  bemId: z.string(),
  financiamentoId: z.string().optional().nullable(),
  fileData: z.string(), // dataURL
  fileName: z.string(),
  fileSize: z.number(),
  fileType: z.enum(["pdf", "imagem"])
});

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";



/**
 * Server function para processar documentos de financiamento via IA.
 * Reutiliza a infraestrutura de OCR/IA e sanitização.
 */
export const processarDocumentoFinanciamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => processarInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Validação de posse do bem
    const { data: bem, error: bemError } = await supabase
      .from("bens")
      .select("id")
      .eq("id", data.bemId)
      .eq("user_id", userId)
      .single();

    if (bemError || !bem) {
      throw new Error("Bem não encontrado ou acesso negado.");
    }

    // 2. Processamento via IA (Gemini/Gateway)
    const resultado = await processarDocumentoFinanciamentoIA({
      fileData: data.fileData,
      fileType: data.fileType,
      fileName: data.fileName
    });

    // 3. Salvar rastro no banco para auditoria (V4)
    const docId = await salvarRastroProcessamento({
      userId: userId,
      bemId: data.bemId,
      financiamentoId: data.financiamentoId || undefined,
      nomeArquivo: data.fileName,
      tamanhoArquivo: data.fileSize,
      dadosExtraidos: resultado
    });

    return {
      docId,
      ...resultado
    };
  });
