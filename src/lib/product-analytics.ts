/**
 * Fase 2 — Analytics de Produto (navegação e descoberta de funcionalidades).
 *
 * Regras invioláveis:
 * - só roda no navegador;
 * - só envia quando o visitante autorizou a categoria Analytics;
 * - NUNCA envia dados pessoais ou financeiros (denylist aplicada em runtime);
 * - rotas dinâmicas são normalizadas (/bens/123 -> /bens/:id);
 * - nenhum evento é enfileirado para envio posterior sem consentimento.
 */

import { analyticsAllowed } from "./analytics-events";
import { BUILD_ID } from "./build-id";

/* ------------------------------------------------------------- taxonomia */

export const PRODUCT_EVENTS = {
  pageView: "page_view",
  navClick: "nav_click",
  featureOpen: "feature_open",
  featureAction: "feature_action",
  searchUsed: "search_used",
  importStarted: "import_started",
  importCompleted: "import_completed",
  exportUsed: "export_used",
  upsellSeen: "upsell_seen",
  upsellClick: "upsell_click",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS];

const ALLOWED_EVENTS: ReadonlySet<string> = new Set(Object.values(PRODUCT_EVENTS));

/** Origem do clique/uso — usada para entender como a feature foi descoberta. */
export type ProductEventSource =
  | "bottom_nav"
  | "sidebar"
  | "more_menu"
  | "dashboard"
  | "topbar"
  | "deep_link"
  | "other";

export type ProductEventInput = {
  event: ProductEventName;
  /** rota atual (será normalizada) */
  route?: string;
  /** rota anterior (será normalizada) */
  prevRoute?: string;
  source?: ProductEventSource;
  /** identificador não sensível do alvo (slug da rota, nome do botão) */
  target?: string;
  /** propriedades adicionais — somente chaves não sensíveis e valores curtos */
  props?: Record<string, unknown>;
};

/* --------------------------------------------------------- PII denylist */

/** Chaves proibidas: qualquer chave que contenha um destes trechos é descartada. */
export const PII_DENYLIST: ReadonlyArray<string> = [
  "email",
  "mail",
  "name",
  "nome",
  "cpf",
  "cnpj",
  "phone",
  "telefone",
  "whatsapp",
  "amount",
  "valor",
  "saldo",
  "price",
  "preco",
  "total",
  "descricao",
  "description",
  "address",
  "endereco",
  "cep",
  "birth",
  "nascimento",
  "token",
  "password",
  "senha",
  "secret",
  "card",
  "cartao_numero",
  "pix",
  "iban",
  "account",
  "conta_numero",
  "user_id",
  "userid",
  "id",
];

const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // e-mail
  /\b\d{9,}\b/, // telefone/CPF/CNPJ/valores longos
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // UUID
  /eyJ[A-Za-z0-9_-]{10,}\./, // JWT
  /R\$\s?\d/, // moeda
];

export function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return PII_DENYLIST.some((bad) => k.includes(bad));
}

function isSafeValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  if (value.length > 64) return false;
  return !SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value));
}

/** Mantém apenas chaves permitidas com valores curtos e não sensíveis. */
export function sanitizeProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= 10) break;
    if (isDeniedKey(key)) continue;
    if (!isSafeValue(value)) continue;
    out[key] = value;
    count += 1;
  }
  return out;
}

/* ------------------------------------------------ normalização de rotas */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove querystring/hash, prefixo de idioma e substitui segmentos dinâmicos
 * por `:id`. Nunca retorna identificadores reais.
 */
export function normalizeRoute(raw: string | null | undefined): string {
  if (!raw) return "/";
  let path = raw.split("?")[0]?.split("#")[0] ?? "/";
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    /* mantém o valor bruto */
  }
  path = path.replace(/^\/(pt|en)(?=\/|$)/, "") || "/";
  const segments = path.split("/").filter(Boolean).slice(0, 6);
  const normalized = segments.map((seg) => {
    const decoded = decodeURIComponent(seg);
    if (UUID_RE.test(decoded)) return ":id";
    if (/^\d+$/.test(decoded)) return ":id";
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(decoded)) return ":periodo";
    if (decoded.length > 24) return ":id";
    if (/@/.test(decoded)) return ":id";
    return decoded.toLowerCase();
  });
  return `/${normalized.join("/")}`.replace(/\/+$/, "") || "/";
}

/* -------------------------------------------------------------- sessão */

const SESSION_KEY = "gi_pa_session";

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "no-storage";
  }
}

function getPlatform(): string {
  if (typeof window === "undefined") return "ssr";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return "pwa";
  return window.innerWidth < 1024 ? "web_mobile" : "web_desktop";
}

/* ------------------------------------------------------- payload/envio */

export type ProductEventPayload = {
  event_name: string;
  route: string;
  prev_route: string | null;
  source: string | null;
  target: string | null;
  session_id: string;
  platform: string;
  build_id: string;
  props: Record<string, string | number | boolean>;
};

export function buildProductEventPayload(input: ProductEventInput): ProductEventPayload | null {
  if (!ALLOWED_EVENTS.has(input.event)) return null;
  const target = input.target && isSafeValue(input.target) ? normalizeTarget(input.target) : null;
  return {
    event_name: input.event,
    route: normalizeRoute(input.route ?? (typeof location !== "undefined" ? location.pathname : "/")),
    prev_route: input.prevRoute ? normalizeRoute(input.prevRoute) : null,
    source: input.source ?? null,
    target,
    session_id: getSessionId(),
    platform: getPlatform(),
    build_id: BUILD_ID,
    props: sanitizeProps(input.props),
  };
}

function normalizeTarget(raw: string): string {
  const value = raw.startsWith("/") ? normalizeRoute(raw) : raw.trim().slice(0, 48);
  return value;
}

type DataLayerWindow = Window & { dataLayer?: unknown[] };

let sender: ((events: ProductEventPayload[]) => Promise<void>) | null = null;

/** Registrado uma vez no cliente (evita import de serverFn em código SSR-crítico). */
export function registerProductAnalyticsSender(
  fn: (events: ProductEventPayload[]) => Promise<void>,
): void {
  sender = fn;
}

let queue: ProductEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  if (queue.length === 0 || !sender) {
    queue = [];
    return;
  }
  const batch = queue.slice(0, 25);
  queue = [];
  void sender(batch).catch(() => {
    /* telemetria nunca quebra a experiência */
  });
}

/**
 * Único ponto de saída de eventos de produto.
 * Sem consentimento de Analytics: nada é enviado nem enfileirado.
 */
export function trackProductEvent(input: ProductEventInput): void {
  if (typeof window === "undefined") return;
  if (!analyticsAllowed()) return;
  const payload = buildProductEventPayload(input);
  if (!payload) return;

  // GTM/GA4 (externo)
  try {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({
      event: payload.event_name,
      pa_route: payload.route,
      pa_prev_route: payload.prev_route,
      pa_source: payload.source,
      pa_target: payload.target,
      pa_platform: payload.platform,
    });
  } catch {
    /* ignore */
  }

  // Painel interno (agregado, admin-only)
  queue.push(payload);
  if (!flushTimer) flushTimer = setTimeout(flush, 1500);
}

/** Uso exclusivo em testes. */
export function __resetProductAnalyticsForTests(): void {
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  sender = null;
}
