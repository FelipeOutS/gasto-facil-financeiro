import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { 
  processarDocumentoFinanciamentoIA, 
  salvarRastroProcessamento 
} from "./bens.server";

const processarInputSchema = z.object({
  bemId: z.string(),
  financiamentoId: z.string().optional(),
  fileData: z.string(), // dataURL
  fileName: z.string(),
  fileSize: z.number(),
  fileType: z.enum(["pdf", "imagem"])
});

/**
 * Server function para processar documentos de financiamento via IA.
 * Reutiliza a infraestrutura de OCR/IA e sanitização.
 */
export const processarDocumentoFinanciamento = createServerFn({ method: "POST" })
  .inputValidator((data) => processarInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    // A middleware requireSupabaseAuth deve estar configurada no start.ts
    // Se não estiver, injetaremos aqui ou usaremos o supabase client com RLS.
    // Por simplicidade e segurança, vamos validar o usuário aqui se o context não tiver.
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Não autorizado");
    }

    // 1. Validação de posse do bem
    const { data: bem, error: bemError } = await supabase
      .from("bens")
      .select("id")
      .eq("id", data.bemId)
      .eq("user_id", user.id)
      .single();

    if (bemError || !bem) {
      throw new Error("Bem não encontrado ou acesso negado.");
    }

    // 2. Processamento via IA (Gemini/Gateway)
    // O helper bens.server.ts cuidará da sanitização e prompt.
    const resultado = await processarDocumentoFinanciamentoIA({
      fileData: data.fileData,
      fileType: data.fileType,
      fileName: data.fileName
    });

    // 3. Salvar rastro no banco para auditoria (V4)
    const docId = await salvarRastroProcessamento({
      userId: user.id,
      bemId: data.bemId,
      financiamentoId: data.financiamentoId,
      nomeArquivo: data.fileName,
      tamanhoArquivo: data.fileSize,
      dadosExtraidos: resultado
    });

    return {
      docId,
      ...resultado
    };
  });
