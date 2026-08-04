/**
 * Cliente leve para a API pública do Banco Central — SGS (Sistema Gerenciador
 * de Séries Temporais). Sem chave, sem custo, com CORS aberto.
 *
 * Códigos de série usados (validados em https://www3.bcb.gov.br/sgspub):
 *   - 432  → Meta para a taxa Selic (% a.a.)
 *   - 4389 → Taxa de juros — CDI anualizada base 252 (% a.a.)
 *   - 433  → IPCA — variação mensal (%)
 *
 * Cache: localStorage por indicador, TTL de 6h para Selic/CDI e 24h para o IPCA.
 * Em caso de falha de rede/API, devolvemos o último valor em cache marcado
 * como "stale" para o card poder exibir aviso discreto sem quebrar o layout.
 */

export type BcbIndicatorKey = "SELIC" | "CDI" | "IPCA";

export interface BcbIndicator {
  key: BcbIndicatorKey;
  /** Valor numérico mais recente. */
  value: number;
  /** Data de referência da observação (dd/mm/yyyy → ISO). */
  referenceDate: string;
  /** ISO de quando este valor foi obtido/atualizado em cache. */
  fetchedAt: string;
  /** Se veio de cache antigo (após falha de rede). */
  stale: boolean;
}

interface SgsRow {
  data: string; // "dd/mm/yyyy"
  valor: string; // número como string
}

const SERIES: Record<BcbIndicatorKey, { code: number; ttlMs: number }> = {
  SELIC: { code: 432, ttlMs: 6 * 60 * 60 * 1000 },
  CDI: { code: 4389, ttlMs: 6 * 60 * 60 * 1000 },
  IPCA: { code: 433, ttlMs: 24 * 60 * 60 * 1000 },
};

const CACHE_PREFIX = "gi:bcb:";
const FETCH_TIMEOUT_MS = 8000;

function cacheKey(key: BcbIndicatorKey): string {
  return `${CACHE_PREFIX}${key}`;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCache(key: BcbIndicatorKey): BcbIndicator | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(cacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BcbIndicator;
    if (!parsed || typeof parsed.value !== "number" || !Number.isFinite(parsed.value)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(ind: BcbIndicator): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(cacheKey(ind.key), JSON.stringify(ind));
  } catch {
    /* quota / privacidade — ignorar */
  }
}

function isFresh(ind: BcbIndicator, ttlMs: number): boolean {
  const t = new Date(ind.fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < ttlMs;
}

function parseBRDate(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) return new Date().toISOString();
  return `${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`;
}

async function fetchSgs(code: number): Promise<SgsRow[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`BCB SGS ${code} HTTP ${res.status}`);
    const data = (await res.json()) as SgsRow[];
    if (!Array.isArray(data) || data.length === 0) throw new Error(`BCB SGS ${code} sem dados`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function loadOne(
  key: BcbIndicatorKey,
  opts: { force?: boolean } = {},
): Promise<BcbIndicator> {
  const cfg = SERIES[key];
  const cached = readCache(key);
  if (!opts.force && cached && isFresh(cached, cfg.ttlMs)) {
    return { ...cached, stale: false };
  }
  try {
    const rows = await fetchSgs(cfg.code);
    const last = rows[rows.length - 1]!;
    const value = parseFloat(String(last.valor).replace(",", "."));
    if (!Number.isFinite(value)) throw new Error("valor inválido");
    const ind: BcbIndicator = {
      key,
      value,
      referenceDate: parseBRDate(last.data),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    writeCache(ind);
    return ind;
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

export interface BcbRadarResult {
  indicators: BcbIndicator[];
  /** true quando ao menos um indicador veio de cache antigo após falha. */
  partiallyStale: boolean;
  /** true quando não conseguimos nem cache nem rede para nenhum indicador. */
  failed: boolean;
}

/**
 * Carrega os 3 indicadores em paralelo, tolerando falhas parciais.
 * Passe `force: true` para ignorar o TTL do cache (botão "Atualizar" manual).
 */
export async function loadBcbRadar(opts: { force?: boolean } = {}): Promise<BcbRadarResult> {
  const keys: BcbIndicatorKey[] = ["SELIC", "CDI", "IPCA"];
  const settled = await Promise.allSettled(keys.map((k) => loadOne(k, opts)));
  const indicators: BcbIndicator[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") indicators.push(r.value);
  }
  return {
    indicators,
    partiallyStale: indicators.some((i) => i.stale),
    failed: indicators.length === 0,
  };
}
