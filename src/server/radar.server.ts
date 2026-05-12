/**
 * Radar Econômico — fetchers e cache.
 *
 * Server-only. Nunca importar a partir de código de cliente.
 * Busca cotações na AwesomeAPI, normaliza e mantém cache em
 * public.economic_indicators via service role.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type IndicatorStatus = "atualizado" | "cache" | "desatualizado";

export interface IndicatorDTO {
  key: string;
  name: string;
  value: number;
  currency: string | null;
  source: string;
  variationPercent: number | null;
  high: number | null;
  low: number | null;
  fetchedAt: string; // ISO
  status: IndicatorStatus;
}

export interface RadarResult {
  indicators: IndicatorDTO[];
  status: IndicatorStatus;
  fetchedAt: string;
  message?: string;
}

/** Configuração dos pares suportados no MVP. Fácil estender depois. */
const SUPPORTED = [
  { key: "USD_BRL", awesome: "USDBRL", name: "Dólar Comercial", currency: "USD" },
  { key: "EUR_BRL", awesome: "EURBRL", name: "Euro", currency: "EUR" },
] as const;

const AWESOMEAPI_URL =
  "https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL";

/** Tempo de vida do cache em milissegundos (30 minutos). */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Timeout do fetch externo. */
const FETCH_TIMEOUT_MS = 5000;

interface AwesomeApiQuote {
  code: string;
  codein: string;
  name: string;
  high: string;
  low: string;
  varBid: string;
  pctChange: string;
  bid: string;
  ask: string;
  timestamp: string;
  create_date: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function fetchAwesomeApi(): Promise<Record<string, AwesomeApiQuote>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(AWESOMEAPI_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`AwesomeAPI respondeu ${res.status}`);
    }
    return (await res.json()) as Record<string, AwesomeApiQuote>;
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(): Promise<IndicatorDTO[]> {
  const keys = SUPPORTED.map((s) => s.key);
  const { data, error } = await supabaseAdmin
    .from("economic_indicators")
    .select(
      "indicator_key, name, value, currency, source, variation_percent, high, low, fetched_at",
    )
    .in("indicator_key", keys);

  if (error) {
    console.error("[radar] erro lendo cache:", error.message);
    return [];
  }
  if (!data) return [];

  return data.map((row) => ({
    key: row.indicator_key as string,
    name: row.name as string,
    value: Number(row.value),
    currency: (row.currency as string | null) ?? null,
    source: (row.source as string) ?? "awesomeapi",
    variationPercent: row.variation_percent === null ? null : Number(row.variation_percent),
    high: row.high === null ? null : Number(row.high),
    low: row.low === null ? null : Number(row.low),
    fetchedAt: row.fetched_at as string,
    status: "cache" as IndicatorStatus,
  }));
}

function isFresh(fetchedAt: string): boolean {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < CACHE_TTL_MS;
}

async function persist(quotes: Record<string, AwesomeApiQuote>): Promise<IndicatorDTO[]> {
  const now = new Date().toISOString();
  const rows = SUPPORTED.map((s) => {
    const q = quotes[s.awesome];
    if (!q) return null;
    const value = num(q.bid);
    if (value === null) return null;
    return {
      indicator_key: s.key,
      name: s.name,
      value,
      currency: s.currency,
      source: "awesomeapi",
      variation_percent: num(q.pctChange),
      high: num(q.high),
      low: num(q.low),
      fetched_at: now,
      raw_payload: q as unknown as Record<string, unknown>,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return [];

  const { error } = await supabaseAdmin
    .from("economic_indicators")
    .upsert(rows, { onConflict: "indicator_key" });

  if (error) {
    console.error("[radar] erro gravando cache:", error.message);
  }

  return rows.map((r) => ({
    key: r.indicator_key,
    name: r.name,
    value: r.value,
    currency: r.currency,
    source: r.source,
    variationPercent: r.variation_percent,
    high: r.high,
    low: r.low,
    fetchedAt: r.fetched_at,
    status: "atualizado" as IndicatorStatus,
  }));
}

/**
 * Retorna os indicadores do Radar Econômico.
 *
 * Fluxo:
 *  1. Lê cache no Supabase.
 *  2. Se TODOS os indicadores suportados estão presentes e frescos (<30 min),
 *     retorna direto do cache com status "cache".
 *  3. Caso contrário, busca na AwesomeAPI, persiste e retorna status "atualizado".
 *  4. Se a API externa falhar, retorna o último cache com status "desatualizado".
 *  5. Se nem cache nem API existirem, retorna lista vazia com mensagem.
 */
export async function getRadarIndicators(opts?: { force?: boolean }): Promise<RadarResult> {
  const cached = await readCache();
  const haveAll =
    cached.length >= SUPPORTED.length &&
    SUPPORTED.every((s) => cached.some((c) => c.key === s.key));
  const allFresh = haveAll && cached.every((c) => isFresh(c.fetchedAt));

  if (!opts?.force && allFresh) {
    return {
      indicators: cached,
      status: "cache",
      fetchedAt: cached
        .map((c) => c.fetchedAt)
        .sort()
        .reverse()[0]!,
    };
  }

  try {
    const quotes = await fetchAwesomeApi();
    const fresh = await persist(quotes);
    if (fresh.length === 0) {
      // API respondeu mas não trouxe dados utilizáveis — degrada para cache.
      throw new Error("AwesomeAPI retornou payload sem cotações válidas");
    }
    return {
      indicators: fresh,
      status: "atualizado",
      fetchedAt: fresh[0]!.fetchedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[radar] falha buscando AwesomeAPI:", msg);

    if (cached.length > 0) {
      return {
        indicators: cached.map((c) => ({ ...c, status: "desatualizado" })),
        status: "desatualizado",
        fetchedAt: cached
          .map((c) => c.fetchedAt)
          .sort()
          .reverse()[0]!,
        message:
          "Não foi possível atualizar as cotações agora. Mostrando os últimos valores conhecidos.",
      };
    }

    return {
      indicators: [],
      status: "desatualizado",
      fetchedAt: new Date(0).toISOString(),
      message:
        "Não conseguimos carregar as cotações no momento. Tente novamente em instantes.",
    };
  }
}
