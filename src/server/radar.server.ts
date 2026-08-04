/**
 * Radar Econômico — fetchers e cache.
 *
 * Server-only. Nunca importar a partir de código de cliente.
 *
 * Fontes:
 *  - AwesomeAPI para cotações de moeda (USD/BRL, EUR/BRL)
 *  - Banco Central / SGS para Selic (série 432 — meta anual %) e
 *    IPCA (série 433 — variação mensal %).
 *
 * Cache em public.economic_indicators via service role.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type IndicatorStatus = "atualizado" | "cache" | "desatualizado";

export interface IndicatorDTO {
  key: string;
  name: string;
  code?: "USD" | "EUR" | string;
  label?: string;
  value: number;
  valueBRL?: number;
  currency: string | null;
  source: string;
  variationPercent: number | null;
  high: number | null;
  low: number | null;
  fetchedAt: string; // ISO
  updatedAt: string; // ISO de referência exibível para o usuário
  status: IndicatorStatus;
  /** Data de referência do indicador (ex.: mês do IPCA). ISO ou null. */
  referenceDate?: string | null;
  /** Unidade textual (ex.: "% ao ano", "% no mês", "BRL"). */
  unit?: string | null;
}

export interface RadarResult {
  indicators: IndicatorDTO[];
  currencies: IndicatorDTO[];
  status: IndicatorStatus;
  fetchedAt: string;
  updatedAt: string;
  message?: string;
}

/** Indicadores suportados. Fácil estender depois. */
const SUPPORTED = [
  {
    key: "USD_BRL",
    name: "Dólar Comercial",
    currency: "USD",
    source: "awesomeapi",
    unit: "BRL",
    ttlMs: 60 * 60 * 1000, // 1h — evita estourar limite da AwesomeAPI (429)
  },
  {
    key: "EUR_BRL",
    name: "Euro",
    currency: "EUR",
    source: "awesomeapi",
    unit: "BRL",
    ttlMs: 60 * 60 * 1000, // 1h
  },
  {
    key: "SELIC",
    name: "Selic (meta)",
    currency: null,
    source: "bcb-sgs",
    unit: "% a.a.",
    ttlMs: 24 * 60 * 60 * 1000, // 24h — só muda em reuniões do Copom
  },
  {
    key: "IPCA",
    name: "IPCA (mensal)",
    currency: null,
    source: "bcb-sgs",
    unit: "% no mês",
    ttlMs: 24 * 60 * 60 * 1000, // 24h — divulgação mensal
  },
] as const;

type SupportedKey = (typeof SUPPORTED)[number]["key"];

const AWESOMEAPI_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL";

const PTAX_BASE_URL = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

const CURRENCY_KEYS = ["USD_BRL", "EUR_BRL"] as const;

/** Códigos das séries no SGS do Banco Central. */
const SGS_CODES: Record<"SELIC" | "IPCA", number> = {
  SELIC: 432, // Meta para a taxa Selic — % a.a.
  IPCA: 433, // IPCA — variação mensal %
};

function sgsUrl(code: number): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/2?formato=json`;
}

/** Timeout do fetch externo. */
const FETCH_TIMEOUT_MS = 10000;

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

interface SgsRow {
  data: string; // dd/mm/yyyy
  valor: string;
}

interface PtaxRow {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseBRDate(d: string): string | null {
  // dd/mm/yyyy → ISO
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`;
}

function parseAwesomeDate(d: string | undefined): string | null {
  if (!d) return null;
  const normalized = d.trim().replace(" ", "T");
  const parsed = new Date(`${normalized}-03:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function ptaxDate(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(
    2,
    "0",
  )}-${d.getUTCFullYear()}`;
}

function pctChange(current: number, previous: number | null): number | null {
  if (!previous || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAwesomeApi(): Promise<Record<string, AwesomeApiQuote>> {
  console.info("[radar] buscando cotações na AwesomeAPI");
  const res = await fetchWithTimeout(AWESOMEAPI_URL);
  console.info(`[radar] AwesomeAPI status HTTP: ${res.status}`);
  const body = await res.text();
  console.info(`[radar] AwesomeAPI corpo: ${body.slice(0, 1500)}`);
  if (!res.ok) throw new Error(`AwesomeAPI respondeu ${res.status}`);
  const data = JSON.parse(body) as Record<string, AwesomeApiQuote>;
  console.info(`[radar] AwesomeAPI chaves recebidas: ${Object.keys(data).join(",")}`);
  return data;
}

async function fetchPtaxDay(currency: "USD" | "EUR", date: Date): Promise<PtaxRow[]> {
  const dataCotacao = ptaxDate(date);
  const url = `${PTAX_BASE_URL}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${currency}'&@dataCotacao='${dataCotacao}'&$top=100&$format=json`;
  try {
    const res = await fetchWithTimeout(url);
    const body = await res.text();
    if (!res.ok) {
      console.error(
        `[radar] PTAX ${currency} ${dataCotacao} respondeu ${res.status}: ${body.slice(0, 800)}`,
      );
      return [];
    }
    const parsed = JSON.parse(body) as { value?: PtaxRow[] };
    return Array.isArray(parsed.value) ? parsed.value : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[radar] PTAX ${currency} ${dataCotacao} falhou: ${msg}`);
    return [];
  }
}

async function fetchSgs(code: number): Promise<SgsRow[]> {
  const res = await fetchWithTimeout(sgsUrl(code));
  if (!res.ok) throw new Error(`BCB SGS ${code} respondeu ${res.status}`);
  const data = (await res.json()) as SgsRow[];
  if (!Array.isArray(data)) throw new Error(`BCB SGS ${code} payload inesperado`);
  return data;
}

interface PersistRow {
  indicator_key: string;
  name: string;
  value: number;
  currency: string | null;
  source: string;
  variation_percent: number | null;
  high: number | null;
  low: number | null;
  fetched_at: string;
  raw_payload: Record<string, unknown>;
}

function rowFromAwesome(
  cfg: (typeof SUPPORTED)[number],
  q: AwesomeApiQuote | undefined,
  now: string,
): PersistRow | null {
  if (!q) return null;
  const value = num(q.bid);
  if (value === null) return null;
  const createDateIso = parseAwesomeDate(q.create_date);
  return {
    indicator_key: cfg.key,
    name: cfg.name,
    value,
    currency: cfg.currency,
    source: cfg.source,
    variation_percent: num(q.pctChange),
    high: num(q.high),
    low: num(q.low),
    fetched_at: now,
    raw_payload: {
      ...q,
      create_date_iso: createDateIso,
      unit: cfg.unit,
    } as unknown as Record<string, unknown>,
  };
}

async function rowFromPtax(
  cfg: (typeof SUPPORTED)[number],
  currency: "USD" | "EUR",
  now: string,
): Promise<PersistRow | null> {
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    return d;
  });

  let latest: PtaxRow[] = [];
  let previous: PtaxRow[] = [];
  for (const day of days) {
    const rows = await fetchPtaxDay(currency, day);
    if (rows.length === 0) continue;
    if (latest.length === 0) latest = rows;
    else {
      previous = rows;
      break;
    }
  }

  const closing = latest.find((r) => r.tipoBoletim.toLowerCase().includes("fechamento"));
  const current = closing ?? latest[latest.length - 1];
  if (!current) return null;
  const previousClosing = previous.find((r) => r.tipoBoletim.toLowerCase().includes("fechamento"));
  const previousCurrent = previousClosing ?? previous[previous.length - 1];
  const value = num(current.cotacaoVenda);
  if (value === null) return null;
  const dayValues = latest.map((r) => num(r.cotacaoVenda)).filter((v): v is number => v !== null);

  return {
    indicator_key: cfg.key,
    name: cfg.name,
    value,
    currency: cfg.currency,
    source: "bcb-ptax",
    variation_percent: pctChange(value, previousCurrent ? num(previousCurrent.cotacaoVenda) : null),
    high: dayValues.length ? Math.max(...dayValues) : value,
    low: dayValues.length ? Math.min(...dayValues) : value,
    fetched_at: now,
    raw_payload: {
      dataHoraCotacao: current.dataHoraCotacao,
      tipoBoletim: current.tipoBoletim,
      cotacaoCompra: current.cotacaoCompra,
      cotacaoVenda: current.cotacaoVenda,
      previousCotacaoVenda: previousCurrent?.cotacaoVenda ?? null,
      unit: cfg.unit,
      fallbackSource: "bcb-ptax",
    },
  };
}

function rowFromSgs(
  cfg: (typeof SUPPORTED)[number],
  rows: SgsRow[] | undefined,
  now: string,
): PersistRow | null {
  if (!rows || rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  const prev = rows.length > 1 ? rows[rows.length - 2] : undefined;
  const value = num(last.valor);
  if (value === null) return null;
  const prevValue = prev ? num(prev.valor) : null;
  // Variação em pontos percentuais entre a leitura anterior e a atual.
  const variation = prevValue !== null && Number.isFinite(prevValue) ? value - prevValue : null;
  const referenceIso = parseBRDate(last.data);
  return {
    indicator_key: cfg.key,
    name: cfg.name,
    value,
    currency: cfg.currency,
    source: cfg.source,
    variation_percent: variation,
    high: null,
    low: null,
    fetched_at: now,
    raw_payload: {
      data_referencia: last.data,
      data_referencia_iso: referenceIso,
      valor: last.valor,
      anterior: prev?.valor ?? null,
      unit: cfg.unit,
    },
  };
}

function dtoFromCache(row: {
  indicator_key: string;
  name: string;
  value: number | string;
  currency: string | null;
  source: string | null;
  variation_percent: number | string | null;
  high: number | string | null;
  low: number | string | null;
  fetched_at: string;
  raw_payload?: Record<string, unknown> | null;
}): IndicatorDTO {
  const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
  const key = row.indicator_key;
  const isCurrency = key === "USD_BRL" || key === "EUR_BRL";
  const value = Number(row.value);
  const updatedAt =
    (raw.create_date_iso as string | undefined) ??
    (raw.dataHoraCotacao as string | undefined) ??
    row.fetched_at;
  return {
    key,
    name: row.name,
    code: key === "USD_BRL" ? "USD" : key === "EUR_BRL" ? "EUR" : key,
    label: key === "USD_BRL" ? "Dólar" : key === "EUR_BRL" ? "Euro" : row.name,
    value,
    valueBRL: isCurrency ? value : undefined,
    currency: row.currency ?? null,
    source: row.source ?? "",
    variationPercent: row.variation_percent === null ? null : Number(row.variation_percent),
    high: row.high === null ? null : Number(row.high),
    low: row.low === null ? null : Number(row.low),
    fetchedAt: row.fetched_at,
    updatedAt,
    status: "cache",
    referenceDate: (raw.data_referencia_iso as string | undefined) ?? null,
    unit: (raw.unit as string | undefined) ?? null,
  };
}

function dtoFromRow(row: PersistRow): IndicatorDTO {
  const cfg = SUPPORTED.find((s) => s.key === row.indicator_key);
  const raw = row.raw_payload;
  const isCurrency = row.indicator_key === "USD_BRL" || row.indicator_key === "EUR_BRL";
  const updatedAt =
    (raw.create_date_iso as string | undefined) ??
    (raw.dataHoraCotacao as string | undefined) ??
    row.fetched_at;
  return {
    key: row.indicator_key,
    name: row.name,
    code:
      row.indicator_key === "USD_BRL"
        ? "USD"
        : row.indicator_key === "EUR_BRL"
          ? "EUR"
          : row.indicator_key,
    label:
      row.indicator_key === "USD_BRL"
        ? "Dólar"
        : row.indicator_key === "EUR_BRL"
          ? "Euro"
          : row.name,
    value: row.value,
    valueBRL: isCurrency ? row.value : undefined,
    currency: row.currency,
    source: row.source,
    variationPercent: row.variation_percent,
    high: row.high,
    low: row.low,
    fetchedAt: row.fetched_at,
    updatedAt,
    status: "atualizado",
    referenceDate: (raw.data_referencia_iso as string | undefined) ?? null,
    unit: cfg?.unit ?? null,
  };
}

async function readCache(): Promise<IndicatorDTO[]> {
  const keys = SUPPORTED.map((s) => s.key);
  console.info("[radar] lendo cache de indicadores");
  const { data, error } = await supabaseAdmin
    .from("economic_indicators")
    .select(
      "indicator_key, name, value, currency, source, variation_percent, high, low, fetched_at, raw_payload",
    )
    .in("indicator_key", keys);

  if (error) {
    console.error("[radar] erro lendo cache:", error.message);
    return [];
  }
  if (!data) return [];
  console.info(
    `[radar] cache encontrado: ${data.map((r) => r.indicator_key).join(",") || "vazio"}`,
  );
  return data.map((r) => dtoFromCache(r as Parameters<typeof dtoFromCache>[0]));
}

function isFresh(key: SupportedKey, fetchedAt: string): boolean {
  const cfg = SUPPORTED.find((s) => s.key === key);
  if (!cfg) return false;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < cfg.ttlMs;
}

async function persist(rows: PersistRow[]): Promise<void> {
  if (rows.length === 0) return;
  console.info(
    `[radar] gravando cache: ${rows.map((r) => `${r.indicator_key}=${r.value}`).join(", ")}`,
  );
  const { error } = await supabaseAdmin
    .from("economic_indicators")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(rows as any, { onConflict: "indicator_key" });
  if (error) console.error("[radar] erro gravando cache:", error.message);
  else console.info("[radar] cache gravado com sucesso");
}

/**
 * Atualiza, em paralelo, todos os indicadores cujo cache esteja expirado
 * (ou todos, se force = true). Retorna o conjunto consolidado de DTOs por
 * chave, combinando atualizações com o cache atual.
 */
async function refreshStale(opts: {
  cached: IndicatorDTO[];
  force: boolean;
}): Promise<{ map: Map<string, IndicatorDTO>; anyFailure: boolean }> {
  const map = new Map<string, IndicatorDTO>();
  for (const c of opts.cached) map.set(c.key, c);

  const now = new Date().toISOString();
  const needsAwesome =
    opts.force ||
    (["USD_BRL", "EUR_BRL"] as const).some((k) => {
      const c = map.get(k);
      return !c || !isFresh(k, c.fetchedAt);
    });
  const needsSelic =
    opts.force || !map.get("SELIC") || !isFresh("SELIC", map.get("SELIC")!.fetchedAt);
  const needsIpca = opts.force || !map.get("IPCA") || !isFresh("IPCA", map.get("IPCA")!.fetchedAt);

  const tasks: Array<Promise<PersistRow[]>> = [];

  if (needsAwesome) {
    tasks.push(
      (async () => {
        console.info("[radar] moedas sem cache fresco; iniciando atualização USD/EUR");
        try {
          const quotes = await fetchAwesomeApi();
          const out: PersistRow[] = [];
          for (const k of CURRENCY_KEYS) {
            const cfg = SUPPORTED.find((s) => s.key === k)!;
            const awesomeKey = k === "USD_BRL" ? "USDBRL" : "EURBRL";
            const row = rowFromAwesome(cfg, quotes[awesomeKey], now);
            if (row) out.push(row);
          }
          console.info(
            `[radar] AwesomeAPI parseada: ${out.map((r) => `${r.indicator_key}=${r.value}`).join(", ")}`,
          );
          if (out.length === CURRENCY_KEYS.length) return out;
          console.error("[radar] AwesomeAPI retornou payload incompleto; tentando fallback PTAX");
          const fallbackRows = await Promise.all(
            CURRENCY_KEYS.map((k) =>
              rowFromPtax(
                SUPPORTED.find((s) => s.key === k)!,
                k === "USD_BRL" ? "USD" : "EUR",
                now,
              ),
            ),
          );
          return fallbackRows.filter((r): r is PersistRow => r !== null);
        } catch (err) {
          console.error("[radar] falha AwesomeAPI:", (err as Error).message);
          console.info("[radar] tentando fallback PTAX para USD/EUR");
          const fallbackRows = await Promise.all(
            CURRENCY_KEYS.map((k) =>
              rowFromPtax(
                SUPPORTED.find((s) => s.key === k)!,
                k === "USD_BRL" ? "USD" : "EUR",
                now,
              ),
            ),
          );
          const valid = fallbackRows.filter((r): r is PersistRow => r !== null);
          console.info(
            `[radar] fallback PTAX parseado: ${valid.map((r) => `${r.indicator_key}=${r.value}`).join(", ") || "sem dados"}`,
          );
          return valid;
        }
      })(),
    );
  }

  if (needsSelic) {
    tasks.push(
      (async () => {
        try {
          const rows = await fetchSgs(SGS_CODES.SELIC);
          const cfg = SUPPORTED.find((s) => s.key === "SELIC")!;
          const r = rowFromSgs(cfg, rows, now);
          return r ? [r] : [];
        } catch (err) {
          console.error("[radar] falha SGS Selic:", (err as Error).message);
          return [];
        }
      })(),
    );
  }

  if (needsIpca) {
    tasks.push(
      (async () => {
        try {
          const rows = await fetchSgs(SGS_CODES.IPCA);
          const cfg = SUPPORTED.find((s) => s.key === "IPCA")!;
          const r = rowFromSgs(cfg, rows, now);
          return r ? [r] : [];
        } catch (err) {
          console.error("[radar] falha SGS IPCA:", (err as Error).message);
          return [];
        }
      })(),
    );
  }

  const settled = await Promise.all(tasks);
  const allRows = settled.flat();
  if (allRows.length > 0) await persist(allRows);

  for (const r of allRows) map.set(r.indicator_key, dtoFromRow(r));

  // Detecta falha: precisava atualizar algo mas a tarefa correspondente não trouxe linhas.
  const anyFailure =
    (needsAwesome &&
      !(["USD_BRL", "EUR_BRL"] as const).every((k) =>
        allRows.some((r) => r.indicator_key === k),
      )) ||
    (needsSelic && !allRows.some((r) => r.indicator_key === "SELIC")) ||
    (needsIpca && !allRows.some((r) => r.indicator_key === "IPCA"));

  return { map, anyFailure };
}

/**
 * Retorna os indicadores do Radar Econômico.
 *
 *  1. Lê cache.
 *  2. Para cada indicador expirado, busca na fonte oficial em paralelo.
 *  3. Persiste atualizações e devolve o estado consolidado.
 *  4. Em caso de falha externa, devolve o último cache marcado como "desatualizado".
 */
function radarResult(
  indicators: IndicatorDTO[],
  status: IndicatorStatus,
  fetchedAt: string,
  message?: string,
): RadarResult {
  const currencies = indicators.filter((i) =>
    CURRENCY_KEYS.includes(i.key as (typeof CURRENCY_KEYS)[number]),
  );
  const updatedAt = fetchedAt;
  console.info(
    `[radar] dados finais enviados: status=${status}; moedas=${
      currencies.map((i) => `${i.key}=${i.valueBRL ?? i.value}`).join(",") || "sem moedas"
    }; updatedAt=${updatedAt}`,
  );
  return { indicators, currencies, status, fetchedAt, updatedAt, ...(message ? { message } : {}) };
}

export async function getRadarIndicators(opts?: { force?: boolean }): Promise<RadarResult> {
  console.info(`[radar] início da chamada; force=${!!opts?.force}`);
  const cached = await readCache();

  // Se nada precisa atualizar (todos frescos), retorna direto do cache.
  const allFresh =
    SUPPORTED.every((s) => {
      const c = cached.find((x) => x.key === s.key);
      return c && isFresh(s.key, c.fetchedAt);
    }) && cached.length >= SUPPORTED.length;

  if (!opts?.force && allFresh) {
    const fetchedAt = cached
      .map((c) => c.fetchedAt)
      .sort()
      .reverse()[0]!;
    console.info("[radar] usando cache fresco");
    return radarResult(cached, "cache", fetchedAt);
  }

  const { map, anyFailure } = await refreshStale({
    cached,
    force: !!opts?.force,
  });

  const indicators = SUPPORTED.map((s) => map.get(s.key)).filter((x): x is IndicatorDTO => !!x);

  if (indicators.length === 0) {
    return radarResult(
      [],
      "desatualizado",
      new Date(0).toISOString(),
      "Não conseguimos carregar os indicadores no momento. Tente novamente em instantes.",
    );
  }

  const fetchedAt = indicators
    .map((c) => c.fetchedAt)
    .sort()
    .reverse()[0]!;

  if (anyFailure) {
    const staleIndicators: IndicatorDTO[] = indicators.map((c) =>
      // Marca como desatualizado apenas os que não foram atualizados nesta rodada.
      c.fetchedAt === fetchedAt && c.status === "atualizado"
        ? c
        : { ...c, status: "desatualizado" as IndicatorStatus },
    );
    return radarResult(
      staleIndicators,
      "desatualizado",
      fetchedAt,
      "Alguns indicadores não puderam ser atualizados agora. Mostrando os últimos valores conhecidos.",
    );
  }

  return radarResult(
    indicators,
    indicators.every((i) => i.status === "atualizado") ? "atualizado" : "cache",
    fetchedAt,
  );
}
