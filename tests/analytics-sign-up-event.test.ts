import { describe, it, expect, beforeEach } from "bun:test";
import {
  trackSignUpCompleted,
  analyticsAllowed,
  __resetAnalyticsEventsForTests,
} from "../src/lib/analytics-events";

const COOKIE = "gi_cookie_consent_v1";

type BrowserGlobals = Record<string, unknown>;

/** Ambiente de navegador mínimo (sem jsdom). */
function installBrowserGlobals() {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const g = globalThis as unknown as BrowserGlobals;
  g.window = { dataLayer: [] as unknown[], sessionStorage };
  g.document = { cookie: "" };
}

function setConsent(value: string | null) {
  const g = globalThis as unknown as BrowserGlobals;
  (g.document as { cookie: string }).cookie = value === null ? "" : `${COOKIE}=${value}`;
}

function dataLayer(): unknown[] {
  const g = globalThis as unknown as BrowserGlobals;
  return (g.window as { dataLayer: unknown[] }).dataLayer;
}

/** Simula um novo carregamento de página (module scope zerado, sessão preservada). */
function simulatePageReload() {
  const g = globalThis as unknown as BrowserGlobals;
  const win = g.window as { dataLayer: unknown[] };
  win.dataLayer = [];
  __resetAnalyticsEventsForTests({ keepSessionMarker: true });
}

describe("analytics sign_up", () => {
  beforeEach(() => {
    installBrowserGlobals();
    setConsent(null);
    __resetAnalyticsEventsForTests();
  });

  it("não dispara quando Analytics foi recusado", () => {
    setConsent("a0m0");
    expect(analyticsAllowed()).toBe(false);
    trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });

  it("não dispara quando ainda não há escolha salva", () => {
    trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });

  it("dispara exatamente um sign_up sem parâmetros extras quando autorizado", () => {
    setConsent("a1m0");
    trackSignUpCompleted();
    trackSignUpCompleted(); // clique duplo / re-render
    expect(dataLayer()).toEqual([{ event: "sign_up" }]);
  });

  it("não repete após reload da página", () => {
    setConsent("a1m0");
    trackSignUpCompleted();
    simulatePageReload();
    trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });

  it("não envia retroativamente se o consentimento vier depois", () => {
    trackSignUpCompleted();
    setConsent("a1m0");
    trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });
});
