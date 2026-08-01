/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const COOKIE = "gi_cookie_consent_v1";

function setConsent(value: string | null) {
  if (value === null) {
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0`;
    return;
  }
  document.cookie = `${COOKIE}=${value}; Path=/`;
}

async function freshModule() {
  vi.resetModules();
  return await import("@/lib/analytics-events");
}

describe("analytics sign_up", () => {
  beforeEach(() => {
    (window as any).dataLayer = [];
    window.sessionStorage.clear();
    setConsent(null);
  });

  it("não dispara quando Analytics foi recusado", async () => {
    setConsent("a0m0");
    const m = await freshModule();
    m.trackSignUpCompleted();
    expect((window as any).dataLayer).toHaveLength(0);
  });

  it("não dispara quando ainda não há escolha salva", async () => {
    const m = await freshModule();
    m.trackSignUpCompleted();
    expect((window as any).dataLayer).toHaveLength(0);
  });

  it("dispara exatamente um sign_up sem parâmetros extras quando autorizado", async () => {
    setConsent("a1m0");
    const m = await freshModule();
    m.trackSignUpCompleted();
    m.trackSignUpCompleted(); // clique duplo / re-render
    expect((window as any).dataLayer).toEqual([{ event: "sign_up" }]);
  });

  it("não repete após reload da página (marcador de sessão)", async () => {
    setConsent("a1m0");
    const first = await freshModule();
    first.trackSignUpCompleted();
    const afterReload = await freshModule(); // novo module scope = novo page load
    afterReload.trackSignUpCompleted();
    expect((window as any).dataLayer).toHaveLength(1);
  });

  it("não envia retroativamente se o consentimento vier depois", async () => {
    const m = await freshModule();
    m.trackSignUpCompleted();
    setConsent("a1m0");
    m.trackSignUpCompleted();
    expect((window as any).dataLayer).toHaveLength(0);
  });
});
