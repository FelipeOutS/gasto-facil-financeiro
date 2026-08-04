/**
 * Mercado Inteligente — parser puro de HTML público da NFC-e.
 *
 * Função PURA. Não faz fetch, não usa DOM, não acessa Supabase.
 * Recebe a string HTML retornada pela página pública da SEFAZ e tenta
 * extrair: itens (nome/qtd/unid/vu/vt/código), total declarado, mercado,
 * CNPJ e data. Quando algo não está disponível, devolve undefined em vez
 * de inventar dados.
 *
 * Suportado prioritariamente: layout do consultaPublica da NFC-e (padrão
 * SEFAZ, usado por SP/RJ/MG/PR/SC/RS e vários outros estados), que renderiza
 * uma tabela "#tabResult" com linhas no formato:
 *
 *   NOME DO PRODUTO
 *   (Código: 123456 )   Qtde.: 1.000  UN: UN
 *   Vl. Unit.:  5,99
 *   Vl. Total                          5,99
 */

import type { CupomItemPreview } from "./nfce-items-parser";

export interface NfceHtmlParseResult {
  items: CupomItemPreview[];
  totalDeclared?: number;
  marketName?: string;
  cnpj?: string;
  dateISO?: string;
  protectedPage: boolean;
  warnings: string[];
}

function makeId(): string {
  return `nfce_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function safeNumber(n: number | undefined | null): number | undefined {
  if (n === undefined || n === null) return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function parseBR(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/r\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return safeNumber(n);
}

function normalizeUnit(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const x = u.toLowerCase().replace(/\.$/, "").trim();
  if (!x) return undefined;
  if (["un", "und", "unid", "pc", "pç", "pcte", "pct"].includes(x)) return "un";
  if (x === "kg") return "kg";
  if (["g", "gr", "grs"].includes(x)) return "g";
  if (["l", "lt"].includes(x)) return "L";
  if (x === "ml") return "ml";
  if (x === "cx") return "cx";
  return x;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|li|p|div|h\d|td|th|tbody|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function detectProtected(html: string, text: string): boolean {
  const t = text.toLowerCase();
  if (/captcha|recaptcha|hcaptcha/.test(html.toLowerCase())) return true;
  if (/digite os caracteres|preencha o captcha|verifique que você não é um robô/i.test(text))
    return true;
  if (t.includes("acesso negado") || t.includes("forbidden")) return true;
  if (t.includes("nota fiscal não encontrada") || t.includes("nfc-e não encontrada")) return true;
  return false;
}

function extractMarket(text: string): { name?: string; cnpj?: string } {
  // CNPJ no formato 00.000.000/0000-00 ou apenas dígitos.
  const cnpjMatch = text.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  const cnpj = cnpjMatch?.[1];

  // Heurística: a primeira linha "significativa" antes do CNPJ costuma ser a razão social.
  let name: string | undefined;
  if (cnpj) {
    const idx = text.indexOf(cnpj);
    if (idx > 0) {
      const before = text
        .slice(0, idx)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      // Pega a última linha antes do CNPJ que tenha letras e tamanho razoável.
      for (let i = before.length - 1; i >= 0; i--) {
        const l = before[i];
        if (l.length >= 4 && l.length <= 120 && /[A-Za-zÀ-ÿ]/.test(l) && !/cnpj/i.test(l)) {
          name = l;
          break;
        }
      }
    }
  }
  return { name, cnpj };
}

function extractDate(text: string): string | undefined {
  // "Emissão: 01/02/2024 12:34:56" ou "Data de Emissão 01/02/2024"
  const m = text.match(/Emiss[aã]o[:\s]*([0-3]?\d)\/([01]?\d)\/(\d{4})/i);
  if (!m) return undefined;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function extractTotal(text: string): number | undefined {
  // Vários estados — captura o primeiro padrão plausível.
  const candidates: RegExp[] = [
    /Valor\s+a\s+pagar[^\d]*R?\$?\s*([\d.]+,\d{2})/i,
    /Valor\s+total\s+da\s+nota[^\d]*R?\$?\s*([\d.]+,\d{2})/i,
    /Valor\s+total[^\d]*R?\$?\s*([\d.]+,\d{2})/i,
    /Total\s+da\s+nota[^\d]*R?\$?\s*([\d.]+,\d{2})/i,
    /Total\s+R?\$?\s*([\d.]+,\d{2})/i,
  ];
  for (const re of candidates) {
    const m = text.match(re);
    if (m) {
      const v = parseBR(m[1]);
      if (typeof v === "number" && v > 0) return v;
    }
  }
  return undefined;
}

/**
 * Extrai itens no formato textual do consultaPublica da NFC-e.
 * Tolerante a quebras de linha extras entre os campos.
 */
function extractItems(text: string): CupomItemPreview[] {
  const items: CupomItemPreview[] = [];

  // Regex multi-linha que cobre o padrão SEFAZ-padrão.
  // Group 1: nome
  // Group 2 (opt): código
  // Group 3: quantidade
  // Group 4: unidade
  // Group 5: valor unitário
  // Group 6: valor total
  const re = new RegExp(
    String.raw`([^\n]{2,200}?)\s*\n` +
      String.raw`[\s\S]{0,400}?Qtde\.?\s*[:\s]\s*([\d.]+,?\d*)` +
      String.raw`[\s\S]{0,80}?UN\s*[:\s]\s*([A-Za-zçÇ]{1,6})` +
      String.raw`[\s\S]{0,200}?Vl\.?\s*Unit\.?\s*[:\s]\s*R?\$?\s*([\d.]+,\d{1,3})` +
      String.raw`[\s\S]{0,200}?Vl\.?\s*Total\s*R?\$?\s*([\d.]+,\d{1,3})`,
    "gi",
  );

  // Capturar também código quando aparecer entre nome e Qtde.
  const codeRe = /\(C[oó]digo:\s*(\d{3,14})/i;

  let m: RegExpExecArray | null;
  let safety = 0;
  while ((m = re.exec(text)) !== null && safety < 500) {
    safety++;
    const block = text.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10);
    const codeMatch = block.match(codeRe);
    const codigoBarras = codeMatch?.[1];

    const nome = m[1]
      .replace(/^\s*\d{1,4}\s*[-.)]?\s*/, "")
      .replace(/\(C[oó]digo:.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!nome || nome.length < 2 || /^[\d.,/\s-]+$/.test(nome)) continue;
    // Linhas como "Produto" / "Descrição" que aparecem como header da tabela.
    if (/^(produto|descric[aã]o|item|c[oó]digo|qtde)/i.test(nome)) continue;

    const quantidade = parseBR(m[2]) ?? 1;
    const unidade = normalizeUnit(m[3]);
    const valorUnitario = parseBR(m[4]);
    const valorTotal = parseBR(m[5]);

    let confianca: CupomItemPreview["confianca"] = "alta";
    if (valorUnitario !== undefined && valorTotal !== undefined && quantidade > 0) {
      const expected = quantidade * valorUnitario;
      const diff = Math.abs(expected - valorTotal);
      const rel = valorTotal > 0 ? diff / valorTotal : 0;
      if (rel > 0.1 && diff > 0.05) confianca = "baixa";
    } else if (valorTotal === undefined && valorUnitario === undefined) {
      confianca = "baixa";
    } else {
      confianca = "media";
    }

    items.push({
      id: makeId(),
      nome,
      quantidade,
      unidade,
      valorUnitario,
      valorTotal,
      codigoBarras,
      confianca,
    });
  }

  return items;
}

export function parseNfceHtml(html: string): NfceHtmlParseResult {
  const warnings: string[] = [];
  if (!html || html.length < 50) {
    return { items: [], protectedPage: false, warnings: ["empty_html"] };
  }

  const text = stripHtml(html);
  const protectedPage = detectProtected(html, text);

  const items = extractItems(text);
  const totalDeclared = extractTotal(text);
  const { name: marketName, cnpj } = extractMarket(text);
  const dateISO = extractDate(text);

  if (items.length === 0 && !totalDeclared) {
    warnings.push("no_items_no_total");
  }

  // Validação final: soma vs total declarado.
  if (items.length > 0 && totalDeclared) {
    const sum = items.reduce((acc, it) => {
      const v =
        typeof it.valorTotal === "number"
          ? it.valorTotal
          : typeof it.valorUnitario === "number"
            ? it.valorUnitario * (it.quantidade || 1)
            : 0;
      return acc + v;
    }, 0);
    const diff = Math.abs(sum - totalDeclared);
    const rel = totalDeclared > 0 ? diff / totalDeclared : 0;
    if (rel > 0.15 && diff > 0.5) {
      warnings.push("total_mismatch");
    }
  }

  return {
    items,
    totalDeclared,
    marketName,
    cnpj,
    dateISO,
    protectedPage,
    warnings,
  };
}
