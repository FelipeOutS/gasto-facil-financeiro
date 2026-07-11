/**
 * WA-B-Precedence — Reconhecimento de mês nomeado em consultas.
 *
 * Utilitário puro (sem dependências de banco) que:
 * - detecta consultas mensais com nome de mês ("quanto gastei em julho");
 * - extrai `month`/`year` respeitando `America/Sao_Paulo`;
 * - remove um sufixo de mês nomeado de um termo textual quando o termo
 *   descreve uma consulta específica com período ("mercado em julho").
 *
 * NÃO decide sobre criação de gastos. NÃO acessa banco. Não escreve.
 * Retornos são sempre estruturados e seguros.
 */

const APP_TZ = "America/Sao_Paulo";

/** Nomes de mês aceitos (forma NFD-sem-acento). */
const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3, // "março" → após NFD strip
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** Nomes por número (forma canônica com acento, para exibição). */
const MES_LABELS: Record<number, string> = {
  1: "janeiro",
  2: "fevereiro",
  3: "março",
  4: "abril",
  5: "maio",
  6: "junho",
  7: "julho",
  8: "agosto",
  9: "setembro",
  10: "outubro",
  11: "novembro",
  12: "dezembro",
};

const MES_ALT = Object.keys(MESES).join("|");

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ano corrente no fuso `America/Sao_Paulo` (não usar `new Date().getFullYear()` direto). */
export function anoCorrenteSaoPaulo(now: Date = new Date()): number {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
  }).format(now);
  return Number(s);
}

export function mesLabel(month: number): string {
  return MES_LABELS[month] ?? "";
}

export type MesNomeadoOutcome =
  | { kind: "ok"; month: number; year: number; hadExplicitYear: boolean }
  | { kind: "ano_invalido"; month: number; yearRaw: number };

/**
 * Detecta consultas mensais com mês nomeado.
 *
 * Estrutura aceita (após normalização NFD/lowercase):
 *   <gatilho> <preposição> [mes de] <mês> [de <YYYY>]
 *
 * Gatilhos: "quanto (eu) gastei", "gastos", "gastos totais", "total de
 * gastos". Preposições: "em/no/do/de". Exemplos aceitos:
 *   - "quanto gastei em julho"
 *   - "quanto eu gastei em julho"
 *   - "quanto gastei no mês de julho"
 *   - "gastos de julho"
 *   - "gastos em julho"
 *   - "quanto gastei em julho de 2026"
 *   - "quanto gastei em janeiro de 2025"
 *
 * NÃO aceita "quanto gastei com julho" (usuário usou `com` — vira
 * descrição, se aplicável) e NÃO aceita "quanto gastei com mercado em
 * julho" (existe termo textual entre o gatilho e o mês; isso é consulta
 * por descrição com período, resolvida em outra camada).
 *
 * Regras de ano:
 * - Com ano explícito → usa o ano informado.
 * - Sem ano explícito → ano corrente em America/Sao_Paulo (não retrocede,
 *   mesmo se o mês já tiver passado; mês futuro no mesmo ano permanece).
 * - Ano inválido (< 1970 ou > ano corrente + 50) → retorna
 *   `{ kind: "ano_invalido" }` para resposta segura.
 */
export function detectConsultaMensalNomeada(
  texto: string,
  opts?: { now?: Date },
): MesNomeadoOutcome | null {
  const t = norm(texto);
  if (!t) return null;

  // Padrões de trigger + preposição + mês (+ ano opcional).
  // Ordem: trigger primeiro para descartar "com <termo> em <mês>".
  const patterns: RegExp[] = [
    // "quanto (eu) gastei em|no|do|de [mes de] <MES> [de YYYY]"
    new RegExp(
      `^\\s*quanto\\s+(?:eu\\s+)?gastei\\s+(?:em|no|do|de)\\s+(?:m[eê]s\\s+de\\s+)?(${MES_ALT})(?:\\s+de\\s+(\\d{2,4}))?\\s*$`,
    ),
    // "gastos [totais] em|no|do|de [mes de] <MES> [de YYYY]"
    new RegExp(
      `^\\s*(?:total\\s+de\\s+)?gastos?(?:\\s+totais)?\\s+(?:em|no|do|de)\\s+(?:m[eê]s\\s+de\\s+)?(${MES_ALT})(?:\\s+de\\s+(\\d{2,4}))?\\s*$`,
    ),
    // "meus gastos em|de <MES> ..."
    new RegExp(
      `^\\s*(?:meus\\s+|os\\s+)?gastos?\\s+(?:em|de|do)\\s+(${MES_ALT})(?:\\s+de\\s+(\\d{2,4}))?\\s*$`,
    ),
    // "quanto foi gasto em|no|de <MES> ..."
    new RegExp(
      `^\\s*quanto\\s+foi\\s+gasto\\s+(?:em|no|do|de)\\s+(?:m[eê]s\\s+de\\s+)?(${MES_ALT})(?:\\s+de\\s+(\\d{2,4}))?\\s*$`,
    ),
  ];

  let mesTxt: string | null = null;
  let anoTxt: string | undefined;
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      mesTxt = m[1];
      anoTxt = m[2];
      break;
    }
  }
  if (!mesTxt) return null;

  const month = MESES[mesTxt];
  if (!month) return null;

  const anoCorr = anoCorrenteSaoPaulo(opts?.now ?? new Date());

  if (anoTxt != null) {
    const raw = Number(anoTxt);
    // 2 dígitos → assumimos 20xx conservador
    const year = raw < 100 ? 2000 + raw : raw;
    if (!Number.isFinite(year) || year < 1970 || year > anoCorr + 50) {
      return { kind: "ano_invalido", month, yearRaw: raw };
    }
    return { kind: "ok", month, year, hadExplicitYear: true };
  }

  return { kind: "ok", month, year: anoCorr, hadExplicitYear: false };
}

/**
 * Remove um sufixo de mês nomeado (com ou sem ano) de um termo textual.
 * Serve para consultas do tipo "quanto gastei com mercado em julho" —
 * o parser específico captura "mercado em julho" como termo; aqui
 * separamos o período do termo real.
 *
 * Retorna também o período detectado quando aplicável, para que o
 * chamador consiga aplicar o filtro temporal na consulta.
 */
export function extractPeriodoSuffix(
  raw: string,
  opts?: { now?: Date },
): {
  termo: string;
  periodo: { month: number; year: number; hadExplicitYear: boolean } | null;
} {
  const original = raw.trim();
  if (!original) return { termo: "", periodo: null };

  // Só considera sufixos com preposição explícita (em|de|no|do), evitando
  // remover nomes de mês quando fazem parte real do termo (ex.: usuário
  // criou uma descrição literal chamada "julho").
  const n = norm(original);
  const re = new RegExp(
    `\\b(?:em|no|do|de)\\s+(?:m[eê]s\\s+de\\s+)?(${MES_ALT})(?:\\s+de\\s+(\\d{2,4}))?\\s*$`,
  );
  const m = n.match(re);
  if (!m) return { termo: original, periodo: null };

  const month = MESES[m[1]];
  if (!month) return { termo: original, periodo: null };

  const anoCorr = anoCorrenteSaoPaulo(opts?.now ?? new Date());
  let year = anoCorr;
  let hadExplicitYear = false;
  if (m[2] != null) {
    const rawY = Number(m[2]);
    const y = rawY < 100 ? 2000 + rawY : rawY;
    if (!Number.isFinite(y) || y < 1970 || y > anoCorr + 50) {
      // Ano inválido → mantém o termo original para segurança.
      return { termo: original, periodo: null };
    }
    year = y;
    hadExplicitYear = true;
  }

  // Fatia o termo pela posição em que o sufixo casou no texto normalizado.
  // Como norm() preserva a ordem/quantidade de tokens (só remove acento e
  // pontuação), usar o índice do início do match na versão normalizada
  // aproxima com segurança o corte no texto original: pegamos os tokens
  // do original antes do primeiro token do sufixo.
  const beforeNorm = n.slice(0, m.index ?? 0).trim();
  const beforeTokens = beforeNorm.split(/\s+/).filter(Boolean).length;
  const originalTokens = original.split(/\s+/);
  const termo = originalTokens.slice(0, beforeTokens).join(" ").trim();

  return {
    termo: termo.replace(/[?!.,;:]+$/g, "").trim(),
    periodo: { month, year, hadExplicitYear },
  };
}

/** Janela [from, toExclusive) em ISO (yyyy-mm-dd) para (month, year). */
export function janelaMes(month: number, year: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const from = `${year}-${mm}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nmm = String(nextMonth).padStart(2, "0");
  const to = `${nextYear}-${nmm}-01`;
  return { from, to };
}
