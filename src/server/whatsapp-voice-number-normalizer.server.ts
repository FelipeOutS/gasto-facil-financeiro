/**
 * WA-V1.2 — Normalizador de valores monetários falados em PT-BR.
 *
 * Roda APENAS para mensagens com `source: "audio"`, entre a transcrição
 * em memória e o pipeline textual existente (`processarMensagemWhatsApp`).
 *
 * Política de segurança:
 *   - NÃO persiste transcrição, texto normalizado, valor extraído nem
 *     qualquer dado financeiro. Tudo é estritamente em memória.
 *   - NÃO loga conteúdo. O chamador emite apenas o evento agregado
 *     `wa_audio_money_normalization` com flags booleanas/contadores.
 *   - Em caso de ambiguidade, NÃO converte — o pipeline textual segue
 *     pedindo o valor ao usuário (comportamento original preservado).
 *
 * Estratégia conservadora:
 *   Só convertemos quando há gatilho monetário explícito adjacente ao
 *   número: as palavras `real`, `reais`, `centavo`, `centavos` ou o
 *   prefixo `R$`. Isso protege automaticamente casos como "dia cinco",
 *   "em três parcelas", "cartão final quarenta e dois", "às oito horas",
 *   "comprei dois produtos" — nenhum desses traz o gatilho.
 */

export type VoiceNormalizationResult = {
  normalizedText: string;
  moneyDetected: boolean;
  normalizedValuesCount: number;
};

// ---------------------------------------------------------------------------
// Léxico de numerais por extenso em PT-BR
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  meia: 6, // "meia dúzia"? raro; mas "meia" em valores normalmente é 0,5 — evitamos.
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

// "meia" é ambíguo (meia hora, meia dúzia) — removemos do léxico de valor.
delete (UNITS as Record<string, number>).meia;

const TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};

const SCALE: Record<string, number> = {
  mil: 1000,
  milhao: 1_000_000,
  milhoes: 1_000_000,
};

const CURRENCY_WORDS = new Set(["real", "reais"]);
const CENTS_WORDS = new Set(["centavo", "centavos"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stripAccents = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const isNumberWord = (w: string): boolean =>
  w in UNITS || w in TENS || w in HUNDREDS || w in SCALE;

/**
 * Tenta interpretar uma sequência de tokens (já normalizada sem acento,
 * minúscula) como um numeral por extenso. Aceita "e" como conector.
 * Retorna o valor numérico e o número de tokens consumidos; ou null se
 * a sequência não formar um numeral válido.
 */
function parseNumberWords(tokens: string[], start: number): { value: number; consumed: number } | null {
  let total = 0;
  let current = 0;
  let consumed = 0;
  let i = start;
  let sawAnything = false;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "e" && sawAnything && i + 1 < tokens.length && isNumberWord(tokens[i + 1])) {
      i += 1;
      consumed += 1;
      continue;
    }
    if (t in SCALE) {
      const scale = SCALE[t];
      // "mil" sozinho = 1000
      const multiplier = current === 0 ? 1 : current;
      total += multiplier * scale;
      current = 0;
      sawAnything = true;
      i += 1;
      consumed += 1;
      continue;
    }
    if (t in HUNDREDS) {
      current += HUNDREDS[t];
      sawAnything = true;
      i += 1;
      consumed += 1;
      continue;
    }
    if (t in TENS) {
      current += TENS[t];
      sawAnything = true;
      i += 1;
      consumed += 1;
      continue;
    }
    if (t in UNITS) {
      current += UNITS[t];
      sawAnything = true;
      i += 1;
      consumed += 1;
      continue;
    }
    break;
  }

  if (!sawAnything) return null;
  // Remover "e" final pendente se houver
  while (consumed > 0 && tokens[start + consumed - 1] === "e") {
    consumed -= 1;
  }
  if (consumed === 0) return null;
  return { value: total + current, consumed };
}

function formatBRL(reais: number, centavos: number): string {
  const cents = Math.max(0, Math.min(99, Math.round(centavos)));
  const intPart = Math.max(0, Math.floor(reais));
  const intStr = intPart.toLocaleString("pt-BR");
  const centStr = cents.toString().padStart(2, "0");
  return `R$ ${intStr},${centStr}`;
}

// ---------------------------------------------------------------------------
// Tokenização preservando offsets para reconstrução do texto
// ---------------------------------------------------------------------------

type Token = {
  raw: string; // como aparece no texto original
  norm: string; // minúscula + sem acento
  start: number; // índice de char no texto original
  end: number; // exclusivo
};

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Palavras (com acento e dígitos) — separadores são qualquer não-letra/dígito/$
  const re = /[A-Za-zÀ-ÿ]+|\d+(?:[.,]\d+)?|R\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    tokens.push({
      raw,
      norm: stripAccents(raw.toLowerCase()),
      start: m.index,
      end: m.index + raw.length,
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Detecção de contexto financeiro (apenas para log; não relaxamos protecções)
// ---------------------------------------------------------------------------

const FINANCIAL_VERBS = new Set([
  "gastei",
  "gasto",
  "paguei",
  "comprei",
  "recebi",
  "ganhei",
  "caiu",
  "entrou",
  "transferi",
  "depositei",
]);

function hasFinancialContext(tokens: Token[]): boolean {
  for (const t of tokens) {
    if (FINANCIAL_VERBS.has(t.norm)) return true;
    if (CURRENCY_WORDS.has(t.norm) || CENTS_WORDS.has(t.norm)) return true;
    if (t.raw === "R$") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Substituição
// ---------------------------------------------------------------------------

type Replacement = {
  start: number; // posição no texto original (inclusivo)
  end: number; // exclusivo
  text: string; // texto substituto
};

/**
 * Verifica se o token imediatamente anterior bloqueia a interpretação
 * como valor monetário (ex.: "dia", "cartão", "final", "às", "parcela").
 */
const LEFT_BLOCKERS = new Set([
  "dia",
  "dias",
  "cartao",
  "final",
  "as",
  "hora",
  "horas",
  "parcela",
  "parcelas",
  "vezes",
]);
const RIGHT_BLOCKERS = new Set([
  "parcela",
  "parcelas",
  "vezes",
  "produtos",
  "produto",
  "itens",
  "unidades",
  "horas",
  "hora",
]);

function build(tokens: Token[], text: string): Replacement[] {
  const out: Replacement[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // Caso 1: "R$" explícito ou número decimal seguido por "reais"
    // (deixamos R$ intacto, mas normalizamos "42 reais" → "R$ 42,00").
    const numericMatch = /^\d+(?:[.,]\d+)?$/.test(t.norm);
    if (numericMatch) {
      // Lookahead por "reais"/"real" possivelmente com "e Y centavos"
      const reaisIdx = tokens[i + 1] && CURRENCY_WORDS.has(tokens[i + 1].norm) ? i + 1 : -1;
      if (reaisIdx === -1) {
        i += 1;
        continue;
      }
      // Confirma blockers à esquerda
      const prev = tokens[i - 1];
      if (prev && LEFT_BLOCKERS.has(prev.norm)) {
        i += 1;
        continue;
      }
      const parts = t.norm.replace(",", ".").split(".");
      const reaisPart = parseInt(parts[0], 10);
      let centsPart = 0;
      if (parts.length === 2) {
        const c = parts[1].slice(0, 2).padEnd(2, "0");
        centsPart = parseInt(c, 10);
      }
      let endTokenIdx = reaisIdx;
      // "e <numero> centavos"
      if (
        tokens[reaisIdx + 1]?.norm === "e" &&
        tokens[reaisIdx + 2]
      ) {
        const parsed = parseNumberWords(
          tokens.map((x) => x.norm),
          reaisIdx + 2,
        );
        if (parsed) {
          const after = tokens[reaisIdx + 2 + parsed.consumed];
          if (after && CENTS_WORDS.has(after.norm)) {
            centsPart = parsed.value;
            endTokenIdx = reaisIdx + 2 + parsed.consumed;
          }
        }
      }
      out.push({
        start: t.start,
        end: tokens[endTokenIdx].end,
        text: formatBRL(reaisPart, centsPart),
      });
      i = endTokenIdx + 1;
      continue;
    }

    // Caso 2: numeral por extenso
    if (isNumberWord(t.norm)) {
      // Blocker à esquerda
      const prev = tokens[i - 1];
      if (prev && LEFT_BLOCKERS.has(prev.norm)) {
        i += 1;
        continue;
      }
      const parsed = parseNumberWords(
        tokens.map((x) => x.norm),
        i,
      );
      if (!parsed) {
        i += 1;
        continue;
      }
      const afterIdx = i + parsed.consumed;
      const after = tokens[afterIdx];

      // Precisa terminar em "reais"/"real" OU "centavos"/"centavo"
      // (gatilho monetário obrigatório para conservadorismo).
      let reais = 0;
      let cents = 0;
      let endTokenIdx = -1;

      if (after && CURRENCY_WORDS.has(after.norm)) {
        reais = parsed.value;
        endTokenIdx = afterIdx;
        // opcional: "e <num> centavos"
        if (tokens[afterIdx + 1]?.norm === "e" && tokens[afterIdx + 2]) {
          const p2 = parseNumberWords(
            tokens.map((x) => x.norm),
            afterIdx + 2,
          );
          if (p2) {
            const after2 = tokens[afterIdx + 2 + p2.consumed];
            if (after2 && CENTS_WORDS.has(after2.norm)) {
              cents = p2.value;
              endTokenIdx = afterIdx + 2 + p2.consumed;
            }
          }
        }
      } else if (after && CENTS_WORDS.has(after.norm)) {
        // "cinquenta centavos" → R$ 0,50
        reais = 0;
        cents = parsed.value;
        endTokenIdx = afterIdx;
      } else {
        i = afterIdx;
        continue;
      }

      // Blocker à direita após a expressão completa
      const right = tokens[endTokenIdx + 1];
      if (right && RIGHT_BLOCKERS.has(right.norm)) {
        i = endTokenIdx + 1;
        continue;
      }

      out.push({
        start: t.start,
        end: tokens[endTokenIdx].end,
        text: formatBRL(reais, cents),
      });
      i = endTokenIdx + 1;
      continue;
    }

    i += 1;
  }
  return out;
}

function applyReplacements(text: string, repls: Replacement[]): string {
  if (repls.length === 0) return text;
  const sorted = [...repls].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue; // sobreposição — ignora
    out += text.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  out += text.slice(cursor);
  return out;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function normalizeVoiceMoney(text: string): VoiceNormalizationResult {
  if (!text || typeof text !== "string") {
    return { normalizedText: text ?? "", moneyDetected: false, normalizedValuesCount: 0 };
  }
  const tokens = tokenize(text);
  const moneyDetected = hasFinancialContext(tokens);
  const repls = build(tokens, text);
  const normalizedText = applyReplacements(text, repls);
  return {
    normalizedText,
    moneyDetected: moneyDetected || repls.length > 0,
    normalizedValuesCount: repls.length,
  };
}
