/**
 * WA-C11 FASE 3B.3 — Autorização Admin dos endpoints administrativos
 * de runtime/quota. Cobre fail-closed do assertAdminMaster e sanitização
 * do motivo.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

const RESET_ENV = process.env.ADMIN_MASTER_EMAILS;

async function loadAdminMaster() {
  const mod = await import("../src/server/admin-master.server");
  mod.__resetAdminMasterCacheForTests();
  return mod;
}

beforeEach(async () => {
  process.env.ADMIN_MASTER_EMAILS = "root@example.com";
  await loadAdminMaster();
});
afterEach(async () => {
  if (typeof RESET_ENV === "string") process.env.ADMIN_MASTER_EMAILS = RESET_ENV;
  else delete process.env.ADMIN_MASTER_EMAILS;
  await loadAdminMaster();
});

describe("WA-C11 3B.3 — Admin master gate", () => {
  test("aceita email cadastrado em ADMIN_MASTER_EMAILS", async () => {
    const { isAdminMasterEmail } = await loadAdminMaster();
    expect(isAdminMasterEmail("root@example.com")).toBe(true);
  });

  test("rejeita usuário comum", async () => {
    const { isAdminMasterEmail } = await loadAdminMaster();
    expect(isAdminMasterEmail("user@example.com")).toBe(false);
  });

  test("rejeita string forjada, null, undefined e vazio", async () => {
    const { isAdminMasterEmail } = await loadAdminMaster();
    expect(isAdminMasterEmail(null)).toBe(false);
    expect(isAdminMasterEmail(undefined)).toBe(false);
    expect(isAdminMasterEmail("")).toBe(false);
    expect(isAdminMasterEmail("  ")).toBe(false);
    expect(isAdminMasterEmail("not-an-email")).toBe(false);
    expect(isAdminMasterEmail("root@example.com  X")).toBe(false);
  });

  test("case-insensitive e tolerante a espaços laterais", async () => {
    const { isAdminMasterEmail } = await loadAdminMaster();
    expect(isAdminMasterEmail("ROOT@example.com")).toBe(true);
    expect(isAdminMasterEmail("  root@example.com  ")).toBe(true);
  });

  test("env ausente ⇒ fail-closed (todo mundo rejeitado)", async () => {
    delete process.env.ADMIN_MASTER_EMAILS;
    const { isAdminMasterEmail } = await loadAdminMaster();
    expect(isAdminMasterEmail("root@example.com")).toBe(false);
  });
});

describe("WA-C11 3B.3 — sanitizeReason", () => {
  test("aceita motivo válido", async () => {
    const { sanitizeReason } = await import("../src/server/whatsapp-quota-admin.server");
    expect(sanitizeReason("Ajuste plano beta")).toBe("Ajuste plano beta");
    expect(sanitizeReason("  Ajuste plano beta  ")).toBe("Ajuste plano beta");
  });

  test("rejeita vazio, curto, só espaços, HTML e não-string", async () => {
    const { sanitizeReason } = await import("../src/server/whatsapp-quota-admin.server");
    expect(sanitizeReason("")).toBeNull();
    expect(sanitizeReason("  ")).toBeNull();
    expect(sanitizeReason("ab")).toBeNull();
    expect(sanitizeReason("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeReason("linha1\u0000linha2")).toBeNull();
    expect(sanitizeReason(null)).toBeNull();
    expect(sanitizeReason(undefined)).toBeNull();
    expect(sanitizeReason(42)).toBeNull();
  });

  test("rejeita motivo excessivamente longo", async () => {
    const { sanitizeReason } = await import("../src/server/whatsapp-quota-admin.server");
    expect(sanitizeReason("a".repeat(501))).toBeNull();
    expect(sanitizeReason("a".repeat(500))).toBe("a".repeat(500));
  });
});
