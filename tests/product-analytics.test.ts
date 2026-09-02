import { describe, it, expect, beforeEach } from "bun:test";
import {
  PRODUCT_EVENTS,
  buildProductEventPayload,
  isDeniedKey,
  normalizeRoute,
  sanitizeProps,
  trackProductEvent,
  __resetProductAnalyticsForTests,
} from "../src/lib/product-analytics";

const COOKIE = "gi_cookie_consent_v1";
type G = Record<string, unknown>;

function installBrowser(consent: string | null) {
  const store = new Map<string, string>();
  const g = globalThis as unknown as G;
  g.window = {
    dataLayer: [] as unknown[],
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    innerWidth: 1440,
    matchMedia: () => ({ matches: false }),
    navigator: {},
    location: { pathname: "/" },
  };
  g.document = { cookie: consent ? `${COOKIE}=${consent}` : "" };
}

function dataLayer(): unknown[] {
  return ((globalThis as unknown as G).window as { dataLayer: unknown[] }).dataLayer;
}

describe("normalizeRoute", () => {
  it("remove querystring, hash e prefixo de idioma", () => {
    expect(normalizeRoute("/pt/gastos?mes=2026-08#topo")).toBe("/gastos");
    expect(normalizeRoute("/en")).toBe("/");
  });

  it("substitui identificadores dinâmicos", () => {
    expect(normalizeRoute("/bens/123")).toBe("/bens/:id");
    expect(normalizeRoute("/bens/6a4f3b2c-1111-2222-3333-444455556666")).toBe("/bens/:id");
    expect(normalizeRoute("/relatorios/2026-08")).toBe("/relatorios/:periodo");
  });
});

describe("PII protection", () => {
  it("marca chaves sensíveis", () => {
    for (const key of ["email", "userEmail", "cpf", "valor_total", "amount", "user_id", "senha"]) {
      expect(isDeniedKey(key)).toBe(true);
    }
    expect(isDeniedKey("source")).toBe(false);
  });

  it("descarta valores sensíveis mesmo em chaves permitidas", () => {
    const clean = sanitizeProps({
      tab: "resumo",
      count: 3,
      ok: true,
      livre: "felipe@teste.com",
      doc: "12345678901",
      money: "R$ 1.200,00",
    });
    expect(clean).toEqual({ tab: "resumo", count: 3, ok: true });
  });
});

describe("trackProductEvent", () => {
  beforeEach(() => {
    __resetProductAnalyticsForTests();
  });

  it("não envia nada sem consentimento de Analytics", () => {
    installBrowser("a0m0");
    trackProductEvent({ event: PRODUCT_EVENTS.pageView, route: "/gastos" });
    expect(dataLayer()).toHaveLength(0);
  });

  it("envia rota normalizada quando autorizado", () => {
    installBrowser("a1m0");
    trackProductEvent({
      event: PRODUCT_EVENTS.navClick,
      route: "/bens/42",
      source: "bottom_nav",
      target: "/gastos",
    });
    expect(dataLayer()).toHaveLength(1);
    expect(dataLayer()[0]).toMatchObject({
      event: "nav_click",
      pa_route: "/bens/:id",
      pa_source: "bottom_nav",
      pa_target: "/gastos",
    });
  });

  it("payload nunca contém e-mail, valores ou ids reais", () => {
    installBrowser("a1m0");
    const payload = buildProductEventPayload({
      event: PRODUCT_EVENTS.featureAction,
      route: "/gastos/6a4f3b2c-1111-2222-3333-444455556666",
      props: { email: "a@b.com", valor: 199.9, tab: "lista" },
    });
    expect(payload?.route).toBe("/gastos/:id");
    expect(payload?.props).toEqual({ tab: "lista" });
  });

  it("rejeita eventos fora da taxonomia", () => {
    installBrowser("a1m0");
    // @ts-expect-error validação em runtime
    expect(buildProductEventPayload({ event: "evento_inventado" })).toBeNull();
  });
});
