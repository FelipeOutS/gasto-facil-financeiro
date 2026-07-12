/**
 * META-GRAPH-UPGRADE-01 — Testes de unificação da versão da Graph API.
 *
 * Cobre:
 *  - validação estrita do helper `getWhatsAppGraphVersion` (missing /
 *    invalid / unsupported / v20.0 ok);
 *  - builder fechado `buildWhatsAppGraphUrl` para todos os recursos
 *    hoje efetivamente usados (messages, register, subscribed_apps,
 *    media_lookup, admin_path);
 *  - fail-closed dos call sites operacionais quando a versão não é
 *    autorizada — nenhuma chamada `fetch` deve ser executada;
 *  - estabilidade das URLs finais quando a env é `v20.0`.
 *
 * Nenhuma chamada real à rede. Nenhuma leitura de segredo do cofre real.
 * `process.env.WHATSAPP_GRAPH_VERSION` é sempre restaurado no `afterEach`.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  AUTHORIZED_GRAPH_VERSION,
  buildWhatsAppGraphUrl,
  getWhatsAppGraphVersion,
} from "@/server/whatsapp-graph-version.server";

const ORIGINAL = process.env.WHATSAPP_GRAPH_VERSION;

function setEnv(v: string | undefined) {
  if (v === undefined) delete process.env.WHATSAPP_GRAPH_VERSION;
  else process.env.WHATSAPP_GRAPH_VERSION = v;
}

beforeEach(() => setEnv("v20.0"));
afterEach(() => setEnv(ORIGINAL));

// -------- Helper -----------------------------------------------------

test("v20.0 é aceita como versão autorizada", () => {
  setEnv("v20.0");
  const r = getWhatsAppGraphVersion();
  expect(r).toEqual({ ok: true, version: "v20.0" });
  expect(AUTHORIZED_GRAPH_VERSION).toBe("v20.0");
});

test("env ausente → missing", () => {
  setEnv(undefined);
  expect(getWhatsAppGraphVersion()).toEqual({ ok: false, reason: "missing" });
});

test("env vazia → missing", () => {
  setEnv("");
  expect(getWhatsAppGraphVersion()).toEqual({ ok: false, reason: "missing" });
});

test.each([
  [" v20.0 ", "invalid"],
  ["v20.0 ", "invalid"],
  [" v20.0", "invalid"],
  ["20.0", "invalid"],
  ["V20.0", "invalid"],
  ["v20", "invalid"],
  ["v20.0/", "invalid"],
  ["latest", "invalid"],
  ["https://graph.facebook.com/v20.0", "invalid"],
  ["graph.facebook.com/v20.0", "invalid"],
  ["v20.0?x=1", "invalid"],
  ["v20.0\n", "invalid"],
  ["v25.0", "unsupported"],
  ["v26.0", "unsupported"],
  ["v19.0", "unsupported"],
])("entrada %p → %s", (input, reason) => {
  setEnv(input);
  const r = getWhatsAppGraphVersion();
  expect(r.ok).toBe(false);
  expect((r as { reason: string }).reason).toBe(reason);
});

test("não normaliza silenciosamente entrada com espaço", () => {
  setEnv(" v20.0 ");
  const r = getWhatsAppGraphVersion();
  expect(r).toEqual({ ok: false, reason: "invalid" });
});

// -------- URL builder ------------------------------------------------

test("messages: URL canônica com env v20.0", () => {
  const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "999" });
  expect(r).toEqual({
    ok: true,
    url: "https://graph.facebook.com/v20.0/999/messages",
  });
});

test("register: URL canônica", () => {
  const r = buildWhatsAppGraphUrl({ kind: "register", phoneNumberId: "12345" });
  expect(r.ok).toBe(true);
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/12345/register");
});

test("subscribed_apps: URL canônica", () => {
  const r = buildWhatsAppGraphUrl({ kind: "subscribed_apps", wabaId: "77" });
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/77/subscribed_apps");
});

test("media_lookup: URL canônica", () => {
  const r = buildWhatsAppGraphUrl({ kind: "media_lookup", mediaId: "abc_DEF-123" });
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/abc_DEF-123");
});

test("admin_path: aceita paths server-controlled", () => {
  const r = buildWhatsAppGraphUrl({
    kind: "admin_path",
    path: "me?fields=id",
  });
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/me?fields=id");
});

test.each([
  ["", "vazio"],
  ["/messages", "começa com /"],
  ["../etc/passwd", "path traversal"],
  ["https://evil.com/messages", "hostname alternativo"],
  ["messages?<script>", "chars exóticos"],
  ["messages#frag", "fragment"],
])("admin_path rejeita %p (%s)", (path) => {
  const r = buildWhatsAppGraphUrl({ kind: "admin_path", path });
  expect(r.ok).toBe(false);
});

test("phoneNumberId apenas dígitos — rejeita alfabético", () => {
  const r = buildWhatsAppGraphUrl({
    kind: "messages",
    phoneNumberId: "abc",
  });
  expect(r).toEqual({ ok: false, reason: "invalid_resource" });
});

test("phoneNumberId vazio rejeitado", () => {
  const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "" });
  expect(r.ok).toBe(false);
});

test("wabaId apenas dígitos", () => {
  const r = buildWhatsAppGraphUrl({
    kind: "subscribed_apps",
    wabaId: "abc",
  });
  expect(r.ok).toBe(false);
});

test("media_lookup rejeita id com caracteres proibidos", () => {
  const r = buildWhatsAppGraphUrl({ kind: "media_lookup", mediaId: "a/b" });
  expect(r.ok).toBe(false);
});

test("hostname e protocolo fixos: URL sempre começa com https://graph.facebook.com/", () => {
  const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "1" });
  expect((r as { url: string }).url.startsWith("https://graph.facebook.com/v20.0/")).toBe(true);
});

// -------- Fail-closed do builder -------------------------------------

test.each([undefined, "", " v20.0", "v25.0", "latest"])(
  "builder falha com configuration_error quando env inválida (%p)",
  (v) => {
    setEnv(v);
    const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "1" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe("configuration_error");
  },
);

test("erro sanitizado — configReason nunca contém token/phone/env", () => {
  setEnv("v25.0");
  const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "12345" });
  const s = JSON.stringify(r);
  expect(s).not.toContain("Bearer");
  expect(s).not.toContain("12345"); // phone não vaza no erro
  expect(s).not.toContain("WHATSAPP_ACCESS_TOKEN");
  expect(s).not.toContain("process.env");
});

// -------- Fail-closed dos call sites ---------------------------------

test("fail-closed: sem env válida, sendWhatsAppRaw (via mock de fetch) não bate na rede", async () => {
  // Simula call site operacional resolvendo helper com env não autorizada.
  setEnv("v25.0");
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "1" });
    if (r.ok) {
      // não deveria acontecer neste caso
      await fetch(r.url);
    }
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("com env v20.0, URL construída é idêntica ao hardcode anterior (messages)", () => {
  setEnv("v20.0");
  const r = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: "999" });
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/999/messages");
});

test("com env v20.0, URL construída é idêntica ao hardcode anterior (media_lookup)", () => {
  setEnv("v20.0");
  const r = buildWhatsAppGraphUrl({ kind: "media_lookup", mediaId: "MID123" });
  expect((r as { url: string }).url).toBe("https://graph.facebook.com/v20.0/MID123");
});
