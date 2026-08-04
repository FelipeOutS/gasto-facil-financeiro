/**
 * Mercado Inteligente — Parser local para QR Code de NFC-e (cupom fiscal).
 *
 * IMPORTANTE — Escopo desta etapa (E29):
 *  - Função PURA. Não faz fetch, não acessa Supabase, não usa localStorage.
 *  - Apenas tenta identificar e extrair informações básicas do conteúdo
 *    lido em um QR Code de cupom fiscal eletrônico (NFC-e).
 *  - NÃO consulta SEFAZ, NÃO quebra captcha, NÃO importa produtos,
 *    NÃO cria despesas. Etapas futuras poderão:
 *      • usar server function para consultar dados públicos da NFC-e
 *        quando tecnicamente viável;
 *      • aplicar OCR sobre foto do cupom;
 *      • permitir revisão de produtos antes de importar para lista/carrinho;
 *      • enriquecer histórico de preços somente após confirmação do usuário.
 */

export type ParsedNfceStatus = "valid_nfce_url" | "possible_nfce_url" | "invalid" | "unsupported";

export interface ParsedNfceQrResult {
  status: ParsedNfceStatus;
  /** Texto bruto recebido (trim). */
  raw: string;
  /** URL detectada, se for o caso. */
  url?: string;
  /** Host/domínio da URL detectada. */
  host?: string;
  /** Chave de acesso de 44 dígitos, se localizada. */
  accessKey?: string;
  /** Sigla provável da UF emissora (apenas heurística por domínio). */
  uf?: string;
  /** Parâmetros relevantes encontrados na URL (ex.: p, chNFe, nVersao, tpAmb). */
  params?: Record<string, string>;
}

const UF_BY_HOST_HINT: Array<{ re: RegExp; uf: string }> = [
  { re: /(^|\.)fazenda\.sp\.gov\.br$/i, uf: "SP" },
  { re: /(^|\.)sefaz\.rs\.gov\.br$/i, uf: "RS" },
  { re: /(^|\.)sefaz\.mg\.gov\.br$/i, uf: "MG" },
  { re: /(^|\.)fazenda\.mg\.gov\.br$/i, uf: "MG" },
  { re: /(^|\.)sefaz\.rj\.gov\.br$/i, uf: "RJ" },
  { re: /(^|\.)fazenda\.rj\.gov\.br$/i, uf: "RJ" },
  { re: /(^|\.)sefaz\.pr\.gov\.br$/i, uf: "PR" },
  { re: /(^|\.)fazenda\.pr\.gov\.br$/i, uf: "PR" },
  { re: /(^|\.)sefaz\.sc\.gov\.br$/i, uf: "SC" },
  { re: /(^|\.)sef\.sc\.gov\.br$/i, uf: "SC" },
  { re: /(^|\.)sefaz\.ba\.gov\.br$/i, uf: "BA" },
  { re: /(^|\.)sefaz\.pe\.gov\.br$/i, uf: "PE" },
  { re: /(^|\.)sefaz\.ce\.gov\.br$/i, uf: "CE" },
  { re: /(^|\.)sefaz\.go\.gov\.br$/i, uf: "GO" },
  { re: /(^|\.)economia\.go\.gov\.br$/i, uf: "GO" },
  { re: /(^|\.)sefaz\.df\.gov\.br$/i, uf: "DF" },
  { re: /(^|\.)fazenda\.df\.gov\.br$/i, uf: "DF" },
  { re: /(^|\.)sefaz\.es\.gov\.br$/i, uf: "ES" },
  { re: /(^|\.)sefaz\.ms\.gov\.br$/i, uf: "MS" },
  { re: /(^|\.)sefaz\.mt\.gov\.br$/i, uf: "MT" },
  { re: /(^|\.)sefaz\.pa\.gov\.br$/i, uf: "PA" },
  { re: /(^|\.)sefaz\.pb\.gov\.br$/i, uf: "PB" },
  { re: /(^|\.)sefaz\.rn\.gov\.br$/i, uf: "RN" },
  { re: /(^|\.)set\.rn\.gov\.br$/i, uf: "RN" },
  { re: /(^|\.)sefaz\.al\.gov\.br$/i, uf: "AL" },
  { re: /(^|\.)sefaz\.se\.gov\.br$/i, uf: "SE" },
  { re: /(^|\.)sefaz\.pi\.gov\.br$/i, uf: "PI" },
  { re: /(^|\.)sefaz\.ma\.gov\.br$/i, uf: "MA" },
  { re: /(^|\.)sefaz\.to\.gov\.br$/i, uf: "TO" },
  { re: /(^|\.)sefaz\.am\.gov\.br$/i, uf: "AM" },
  { re: /(^|\.)sefaz\.ac\.gov\.br$/i, uf: "AC" },
  { re: /(^|\.)sefaz\.ap\.gov\.br$/i, uf: "AP" },
  { re: /(^|\.)sefaz\.ro\.gov\.br$/i, uf: "RO" },
  { re: /(^|\.)sefaz\.rr\.gov\.br$/i, uf: "RR" },
];

const UF_BY_KEY_PREFIX: Record<string, string> = {
  "11": "RO",
  "12": "AC",
  "13": "AM",
  "14": "RR",
  "15": "PA",
  "16": "AP",
  "17": "TO",
  "21": "MA",
  "22": "PI",
  "23": "CE",
  "24": "RN",
  "25": "PB",
  "26": "PE",
  "27": "AL",
  "28": "SE",
  "29": "BA",
  "31": "MG",
  "32": "ES",
  "33": "RJ",
  "35": "SP",
  "41": "PR",
  "42": "SC",
  "43": "RS",
  "50": "MS",
  "51": "MT",
  "52": "GO",
  "53": "DF",
};

const NFCE_URL_HINT = /(nfce|nfc-?e|qrcode|consultanfce|consultanfc|consulta\/?nfce)/i;

function extractAccessKey(text: string): string | undefined {
  const onlyDigits = text.replace(/\D+/g, "");
  // Procura sequência contínua de 44 dígitos.
  const m = onlyDigits.match(/\d{44}/);
  if (m) return m[0];
  // Tenta também procurar em parâmetros típicos no texto original.
  const param = text.match(/(?:^|[?&|])(?:p|chnfe|chNFe)=([0-9]{44})/i);
  return param?.[1];
}

function pickRelevantParams(url: URL): Record<string, string> | undefined {
  const interesting = ["p", "chNFe", "chnfe", "nVersao", "tpAmb", "cIdToken", "vNF"];
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (interesting.some((i) => i.toLowerCase() === k.toLowerCase())) {
      out[k] = v;
    }
  }
  // Alguns QR Codes de NFC-e codificam tudo em um único parâmetro "p"
  // separado por pipe (|). Se houver um "p" tipo "chave|2|...|...|..."
  // não tentamos decompor aqui — apenas preservamos.
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseNfceQrContent(input: unknown): ParsedNfceQrResult {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { status: "invalid", raw: "" };

  // Tenta detectar URL no início do conteúdo.
  let url: URL | undefined;
  try {
    // Aceita conteúdos tipo "http..." e também URLs com query gigante.
    if (/^https?:\/\//i.test(raw)) {
      url = new URL(raw);
    }
  } catch {
    url = undefined;
  }

  const accessKey = extractAccessKey(raw);
  const keyPrefix = accessKey?.slice(0, 2);
  const ufFromKey = keyPrefix ? UF_BY_KEY_PREFIX[keyPrefix] : undefined;

  if (url) {
    const host = url.host.toLowerCase();
    const ufFromHost = UF_BY_HOST_HINT.find((h) => h.re.test(host))?.uf;
    const params = pickRelevantParams(url);
    const looksLikeNfce =
      NFCE_URL_HINT.test(url.pathname) ||
      NFCE_URL_HINT.test(url.search) ||
      !!params?.p ||
      !!params?.chNFe ||
      !!params?.chnfe;

    const isGovBr = /(^|\.)gov\.br$/i.test(host);

    if (looksLikeNfce && (isGovBr || ufFromHost)) {
      return {
        status: "valid_nfce_url",
        raw,
        url: url.toString(),
        host,
        accessKey,
        uf: ufFromHost ?? ufFromKey,
        params,
      };
    }

    if (looksLikeNfce || accessKey) {
      return {
        status: "possible_nfce_url",
        raw,
        url: url.toString(),
        host,
        accessKey,
        uf: ufFromHost ?? ufFromKey,
        params,
      };
    }

    return {
      status: "unsupported",
      raw,
      url: url.toString(),
      host,
      accessKey,
      uf: ufFromHost ?? ufFromKey,
      params,
    };
  }

  // Sem URL: pode ser apenas a chave de acesso ou texto qualquer.
  if (accessKey) {
    return {
      status: "possible_nfce_url",
      raw,
      accessKey,
      uf: ufFromKey,
    };
  }

  return { status: "invalid", raw };
}
