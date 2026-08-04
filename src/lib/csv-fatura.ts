import type { CategoryId } from "@/lib/categories";

/**
 * Item bruto extraído de uma fatura (imagem ou CSV) — antes da revisão do usuário.
 * Tudo opcional para refletir a realidade dos dados: a tela de conferência exige
 * descrição, valor, data e cartão para considerar "pronto para importar".
 */
export type FaturaItemBruto = {
  descricao: string | null;
  estabelecimento: string | null;
  valor: number | null;
  data: string | null; // ISO YYYY-MM-DD
  /** Horário opcional HH:mm. */
  horario: string | null;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  categoriaSugerida: string | null; // pode ou não ser CategoryId
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
};

/** Procura padrões de horário (14:30, 14h30, "às 19:45") em um texto. */
export function extractHorario(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2})[:hH](\d{2})\b/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/* --------------------------------------------------------------------------
 * CSV PARSER (tolerante a vírgula/ponto-e-vírgula, aspas, BOM)
 * ------------------------------------------------------------------------ */

function detectDelimiter(sample: string): "," | ";" | "\t" {
  const firstLines = sample.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Record<string, number> = {
    ",": (firstLines.match(/,/g) || []).length,
    ";": (firstLines.match(/;/g) || []).length,
    "\t": (firstLines.match(/\t/g) || []).length,
  };
  let best: "," | ";" | "\t" = ",";
  let max = -1;
  for (const k of [",", ";", "\t"] as const) {
    if (counts[k] > max) {
      max = counts[k];
      best = k;
    }
  }
  return best;
}

/**
 * Parser CSV simples mas robusto: aspas duplas, escape "" e CRLF.
 */
export function parseCSV(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(cleaned);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        cur.push(field);
        field = "";
      } else if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (ch === "\r") {
        // ignore, \n trata
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  // remove linhas totalmente vazias
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/* --------------------------------------------------------------------------
 * Mapeamento de colunas
 * ------------------------------------------------------------------------ */

export type CsvColumnRole =
  | "data"
  | "descricao"
  | "estabelecimento"
  | "valor"
  | "categoria"
  | "parcela"
  | "totalParcelas"
  | "observacao"
  | "ignorar";

const HEADER_HINTS: Record<Exclude<CsvColumnRole, "ignorar">, string[]> = {
  data: [
    "data",
    "date",
    "dt",
    "lancamento",
    "lançamento",
    "transaction date",
    "data lancamento",
    "data lançamento",
    "data compra",
  ],
  descricao: ["descricao", "descrição", "description", "historico", "histórico", "memo", "detalhe"],
  estabelecimento: [
    "estabelecimento",
    "merchant",
    "loja",
    "fornecedor",
    "vendor",
    "comercio",
    "comércio",
  ],
  valor: ["valor", "amount", "preco", "preço", "total", "value", "montante", "vlr"],
  categoria: ["categoria", "category", "tipo", "classificacao", "classificação"],
  parcela: ["parcela", "parcelas", "installment", "parc", "parc."],
  totalParcelas: [
    "total parcelas",
    "total de parcelas",
    "qtd parcelas",
    "n parcelas",
    "parcelas total",
  ],
  observacao: ["observacao", "observação", "obs", "note", "notes", "comentario", "comentário"],
};

function normHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function autoMapHeaders(headers: string[]): CsvColumnRole[] {
  return headers.map((h) => {
    const n = normHeader(h);
    for (const role of Object.keys(HEADER_HINTS) as Array<Exclude<CsvColumnRole, "ignorar">>) {
      if (HEADER_HINTS[role].some((hint) => n === hint || n.includes(hint))) {
        return role;
      }
    }
    return "ignorar" as const;
  });
}

/* --------------------------------------------------------------------------
 * Parsers de valor / data / parcela
 * ------------------------------------------------------------------------ */

export function parseValorBR(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  // remove símbolos e textos
  s = s
    .replace(/r\$/i, "")
    .replace(/brl/i, "")
    .replace(/[^\d,.\-]/g, "")
    .trim();
  if (!s) return null;
  const negativo = /-/.test(s);
  s = s.replace(/-/g, "");
  if (s.includes(",") && s.includes(".")) {
    // formato BR: ponto = milhar, vírgula = decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // formato US: vírgula = milhar
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // só vírgula → decimal BR
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return negativo ? -n : n;
}

export function parseDataBR(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // ISO YYYY-MM-DD ou YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return toIso(y, mo, d);
  }
  // dd/mm/aaaa ou dd/mm/aa ou dd-mm-aaaa
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y = 2000 + y;
    return toIso(y, mo, d);
  }
  // dd/mm (sem ano) → assume ano atual
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = new Date().getFullYear();
    return toIso(y, mo, d);
  }
  return null;
}

function toIso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseParcela(raw: string): { atual: number; total: number } | null {
  if (!raw) return null;
  const s = raw.trim();
  // 01/10, 1/10, 03 de 12
  let m = s.match(/(\d{1,2})\s*(?:\/|de|of)\s*(\d{1,2})/i);
  if (m) {
    const a = Number(m[1]);
    const t = Number(m[2]);
    if (a > 0 && t > 1 && a <= t) return { atual: a, total: t };
  }
  // "parcela 2 de 6"
  m = s.match(/parc(?:ela)?\.?\s*(\d{1,2}).*?(\d{1,2})/i);
  if (m) {
    const a = Number(m[1]);
    const t = Number(m[2]);
    if (a > 0 && t > 1 && a <= t) return { atual: a, total: t };
  }
  return null;
}

/**
 * Extrai parcela embutida na descrição (ex: "MAGAZINE LUIZA 03/12") e
 * retorna a descrição "limpa" sem o sufixo de parcela.
 */
export function extractParcelaFromDescricao(desc: string): {
  descricaoLimpa: string;
  parcela: { atual: number; total: number } | null;
} {
  if (!desc) return { descricaoLimpa: "", parcela: null };
  const re = /\s*(?:-\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/;
  const m = desc.match(re);
  if (m) {
    const a = Number(m[1]);
    const t = Number(m[2]);
    if (a > 0 && t > 1 && a <= t) {
      return {
        descricaoLimpa: desc.replace(re, "").trim(),
        parcela: { atual: a, total: t },
      };
    }
  }
  return { descricaoLimpa: desc, parcela: null };
}

/* --------------------------------------------------------------------------
 * Sugestão de categoria por descrição (heurística simples)
 * ------------------------------------------------------------------------ */

const CAT_RULES: Array<{ id: CategoryId; matches: string[] }> = [
  {
    id: "alimentacao",
    matches: [
      "ifood",
      "restaurante",
      "lanche",
      "padaria",
      "pizz",
      "burger",
      "mc donalds",
      "mcdonalds",
      "burger king",
      "subway",
      "outback",
      "ze delivery",
    ],
  },
  {
    id: "transporte",
    matches: [
      "uber",
      "99",
      "99app",
      "cabify",
      "posto",
      "gasolina",
      "combustivel",
      "estacionamento",
      "pedagio",
      "pedágio",
      "taxi",
    ],
  },
  {
    id: "assinaturas",
    matches: [
      "netflix",
      "spotify",
      "amazon prime",
      "disney",
      "hbo",
      "globoplay",
      "deezer",
      "apple.com/bill",
      "youtube premium",
      "icloud",
    ],
  },
  {
    id: "farmacia",
    matches: ["farmacia", "drogaria", "drogasil", "raia", "pacheco", "pague menos"],
  },
  {
    id: "mercado",
    matches: [
      "mercado",
      "supermercado",
      "atacado",
      "carrefour",
      "extra",
      "assai",
      "sams",
      "atacadao",
    ],
  },
  {
    id: "online",
    matches: [
      "shopee",
      "mercado livre",
      "mercadolivre",
      "amazon",
      "aliexpress",
      "magalu",
      "magazine luiza",
      "americanas",
      "submarino",
    ],
  },
  {
    id: "contas",
    matches: [
      "boleto",
      "energia",
      "agua",
      "água",
      "internet",
      "telefonia",
      "vivo",
      "claro",
      "tim",
      "sabesp",
      "enel",
    ],
  },
  {
    id: "saude",
    matches: [
      "clinic",
      "consulta",
      "exame",
      "hospital",
      "dentista",
      "psicolog",
      "amil",
      "unimed",
      "hapvida",
    ],
  },
  { id: "lazer", matches: ["cinema", "ingresso", "show", "teatro", "parque", "viagem"] },
  {
    id: "educacao",
    matches: ["curso", "udemy", "alura", "coursera", "escola", "faculdade", "mensalidade"],
  },
  { id: "pet", matches: ["petshop", "petz", "cobasi", "racao", "ração", "veterinari"] },
];

export function suggestCategoryFromDescription(desc: string | null | undefined): string {
  if (!desc) return "outros";
  const n = desc
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const rule of CAT_RULES) {
    if (rule.matches.some((m) => n.includes(m))) return rule.id;
  }
  return "outros";
}

/* --------------------------------------------------------------------------
 * CSV → FaturaItemBruto[]
 * ------------------------------------------------------------------------ */

export type CsvParseResult = {
  headers: string[];
  rows: string[][]; // sem o header
  autoMap: CsvColumnRole[];
};

export function parseCsvFile(text: string): CsvParseResult {
  const all = parseCSV(text);
  if (all.length === 0) return { headers: [], rows: [], autoMap: [] };
  const headers = all[0];
  const rows = all.slice(1);
  const autoMap = autoMapHeaders(headers);
  return { headers, rows, autoMap };
}

export function rowsToItens(rows: string[][], mapping: CsvColumnRole[]): FaturaItemBruto[] {
  return rows.map<FaturaItemBruto>((row) => {
    const get = (role: CsvColumnRole): string => {
      const idx = mapping.indexOf(role);
      if (idx < 0 || idx >= row.length) return "";
      return row[idx] ?? "";
    };
    let descricao = get("descricao") || get("estabelecimento") || "";
    const estabelecimento = get("estabelecimento") || null;
    const valor = parseValorBR(get("valor"));
    const data = parseDataBR(get("data"));
    const obs = get("observacao") || null;
    const catRaw = get("categoria");

    let parcAtual: number | null = null;
    let parcTotal: number | null = null;
    const parcStr = get("parcela");
    const totalStr = get("totalParcelas");
    if (parcStr) {
      const p = parseParcela(parcStr);
      if (p) {
        parcAtual = p.atual;
        parcTotal = p.total;
      } else {
        const n = Number(parcStr);
        if (Number.isFinite(n) && n > 0) parcAtual = Math.floor(n);
      }
    }
    if (totalStr) {
      const n = Number(totalStr.replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n > 1) parcTotal = Math.floor(n);
    }
    // Tenta extrair da descrição também
    if ((parcAtual === null || parcTotal === null) && descricao) {
      const ext = extractParcelaFromDescricao(descricao);
      if (ext.parcela) {
        descricao = ext.descricaoLimpa;
        parcAtual = ext.parcela.atual;
        parcTotal = ext.parcela.total;
      }
    }

    const sugerida =
      catRaw && catRaw.trim()
        ? catRaw.trim().toLowerCase()
        : suggestCategoryFromDescription(descricao);

    let confianca: "alta" | "media" | "baixa" = "alta";
    if (valor === null || data === null || !descricao) confianca = "baixa";

    const horario =
      extractHorario(get("data")) || extractHorario(get("descricao")) || extractHorario(obs);

    return {
      descricao: descricao || null,
      estabelecimento,
      valor,
      data,
      horario,
      parcelaAtual: parcAtual,
      totalParcelas: parcTotal,
      categoriaSugerida: sugerida,
      confianca,
      observacao: obs,
    };
  });
}

/* --------------------------------------------------------------------------
 * Chave de duplicidade
 * ------------------------------------------------------------------------ */

export function dupKey(cartaoId: string, data: string, descricao: string, valor: number): string {
  const desc = descricao
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${cartaoId}|${data}|${desc}|${valor.toFixed(2)}`;
}
