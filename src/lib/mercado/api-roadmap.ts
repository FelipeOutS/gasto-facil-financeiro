/**
 * Mercado Inteligente — Roadmap técnico de APIs futuras
 * ----------------------------------------------------------------------------
 * Arquivo puramente documental. NÃO faz chamadas de rede, NÃO importa
 * Supabase, NÃO mexe em stores locais e NÃO deve ser importado em telas
 * a não ser para uma futura página de "status técnico" interna.
 *
 * Objetivo: registrar de forma versionada quais integrações externas o
 * módulo Mercado já usa, quais estão preparadas e quais são futuras, com
 * observações de privacidade. Serve como guia para próximas etapas (E23+).
 *
 * Regras de ouro para próximas integrações:
 * - Todo recurso novo que envolva localização, câmera, leitura de cupom,
 *   compartilhamento de preços ou base comunitária EXIGE opt-in explícito
 *   do usuário antes de qualquer chamada externa.
 * - Nenhuma integração deve enviar dados financeiros do app (gastos,
 *   cartões, orçamentos pessoais) para serviços de terceiros.
 * - Stores locais (gi:mercado:*:v1) permanecem como fonte de verdade
 *   enquanto o backend comunitário não estiver oficialmente liberado.
 */

export type MercadoApiStatus =
  | "ativo-local" // já em uso, sem backend próprio (chamada direta a serviço público)
  | "preparado" // estrutura local pronta, falta apenas habilitar integração
  | "futuro"; // ainda não iniciado; requer planejamento de privacidade/UX

export type MercadoApiFutureFeature = {
  /** Identificador estável (não traduzir). */
  id: "barcode" | "cep" | "places" | "ocr" | "nfce" | "communityPrices";
  /** Nome curto e amigável apenas para documentação interna. */
  label: string;
  /** Provedor externo previsto (pode mudar). */
  provider: string;
  status: MercadoApiStatus;
  /** Resumo do que a feature entrega ao usuário. */
  purpose: string;
  /** Observações de privacidade, opt-in e dados envolvidos. */
  privacy: string;
  /** Requer backend próprio (Supabase/edge function) para funcionar? */
  requiresBackend: boolean;
};

export const MERCADO_API_ROADMAP: ReadonlyArray<MercadoApiFutureFeature> = [
  {
    id: "barcode",
    label: "Código de barras (Open Food Facts)",
    provider: "world.openfoodfoods.org",
    status: "ativo-local",
    purpose: "Preencher apenas o nome do produto a partir de um EAN/UPC ao adicionar item à lista.",
    privacy:
      "Envia apenas o código de barras digitado. Não envia preço, lista, identidade do usuário nem localização. Resultado é descartado após preencher o nome (sem persistência automática).",
    requiresBackend: false,
  },
  {
    id: "cep",
    label: "Busca de endereço por CEP (ViaCEP)",
    provider: "viacep.com.br",
    status: "ativo-local",
    purpose:
      "Facilitar o cadastro local de mercados em Meus Mercados, preenchendo logradouro/bairro/cidade/UF.",
    privacy:
      "Envia apenas o CEP. Não envia identidade nem outros dados do mercado. Campos permanecem editáveis após o auto-preenchimento.",
    requiresBackend: false,
  },
  {
    id: "places",
    label: "Mercados próximos (Places-like)",
    provider: "Google Places / OpenStreetMap Overpass (a definir)",
    status: "futuro",
    purpose:
      "Sugerir mercados próximos da localização atual para acelerar o cadastro e o registro de preços.",
    privacy:
      "Requer permissão explícita de geolocalização do navegador. Coordenadas nunca devem ser armazenadas no app sem opt-in. Resultados de busca não persistem em base comunitária.",
    requiresBackend: true,
  },
  {
    id: "ocr",
    label: "OCR de cupom fiscal por imagem",
    provider: "A definir (tesseract.js no-cliente OU serviço gerenciado)",
    status: "futuro",
    purpose:
      "Permitir que o usuário fotografe um cupom e extrair itens/valores automaticamente para popular a lista/histórico.",
    privacy:
      "Imagens contêm CPF, endereço do estabelecimento e itens comprados. Processamento on-device é o caminho preferido. Se houver upload, exigir opt-in claro e retenção zero.",
    requiresBackend: true,
  },
  {
    id: "nfce",
    label: "NFC-e por QR Code / chave de acesso",
    provider: "Portais SEFAZ estaduais (variam por UF)",
    status: "futuro",
    purpose: "Importar automaticamente itens e preços de uma NFC-e a partir do QR Code do cupom.",
    privacy:
      "A chave da NFC-e é um identificador fiscal sensível. Toda consulta deve ocorrer via backend próprio (proxy) para evitar CORS e proteger headers. Exigir opt-in e nunca armazenar a chave sem necessidade.",
    requiresBackend: true,
  },
  {
    id: "communityPrices",
    label: "Base comunitária de preços",
    provider: "Backend próprio (Lovable Cloud, futuro)",
    status: "futuro",
    purpose:
      "Compartilhar preços anonimizados entre usuários para alimentar comparativos por mercado/região.",
    privacy:
      "Compartilhamento é estritamente opt-in. Nunca enviar identidade, localização precisa, gastos pessoais ou dados financeiros. Apenas {produto, mercado, preço, data} agregados. Política de exclusão e direito ao esquecimento obrigatórios antes do lançamento.",
    requiresBackend: true,
  },
] as const;

/** Helper documental — não usado em runtime. */
export function getMercadoApiFeature(
  id: MercadoApiFutureFeature["id"],
): MercadoApiFutureFeature | undefined {
  return MERCADO_API_ROADMAP.find((f) => f.id === id);
}
