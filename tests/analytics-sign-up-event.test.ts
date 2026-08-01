import { describe, it, expect, beforeEach, vi } from "vitest";

const COOKIE = "gi_cookie_consent_v1";

/** Ambiente de navegador mínimo (evita dependência de jsdom). */
function installBrowserGlobals() {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const win: Record<string, unknown> = { dataLayer: [], sessionStorage };
  (globalThis as unknown as Record<string, unknown>).window = win;
  (globalThis as unknown as Record<string, unknown>).document = { cookie: "" };
  return win;
}

function setConsent(value: string | null) {
  ((globalThis as unknown as Record<string, unknown>).document as { cookie: string }).cookie =
    value === null ? "" : `${COOKIE}=${value}`;
}

async function freshModule() {
  vi.resetModules();
  return await import("../src/lib/analytics-events");
}

function dataLayer(): unknown[] {
  return ((globalThis as unknown as Record<string, unknown>).window as { dataLayer: unknown[] })
    .dataLayer;
}

describe("analytics sign_up", () => {
  beforeEach(() => {
    installBrowserGlobals();
    setConsent(null);
  });

  it("não dispara quando Analytics foi recusado", async () => {
    setConsent("a0m0");
    const m = await freshModule();
    m.trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });

  it("não dispara quando ainda não há escolha salva", async () => {
    const m = await freshModule();
    m.trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });

  it("dispara exatamente um sign_up sem parâmetros extras quando autorizado", async () => {
    setConsent("a1m0");
    const m = await freshModule();
    m.trackSignUpCompleted();
    m.trackSignUpCompleted(); // clique duplo / re-render
    expect(dataLayer()).toEqual([{ event: "sign_up" }]);
  });

  it("não repete após reload da página (marcador de sessão)", async () => {
    setConsent("a1m0");
    const first = await freshModule();
    first.trackSignUpCompleted();
    const afterReload = await freshModule(); // novo module scope = novo page load
    afterReload.trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(1);
  });

  it("não envia retroativamente se o consentimento vier depois", async () => {
    const m = await freshModule();
    m.trackSignUpCompleted();
    setConsent("a1m0");
    m.trackSignUpCompleted();
    expect(dataLayer()).toHaveLength(0);
  });
});
