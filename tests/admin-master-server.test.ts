/**
 * tests/admin-master-server.test.ts
 *
 * Cobre a fonte única server-side de Admin Master (WA-B1).
 */
import { test, expect, beforeEach, afterEach, describe } from "bun:test";

const MODULE_PATH = "../src/server/admin-master.server";

async function load() {
  const mod = await import(MODULE_PATH);
  mod.__resetAdminMasterCacheForTests();
  return mod;
}


const ORIGINAL = process.env.ADMIN_MASTER_EMAILS;

beforeEach(async () => {
  const mod = await import(MODULE_PATH);
  mod.__resetAdminMasterCacheForTests();
});

afterEach(async () => {
  if (typeof ORIGINAL === "string") {
    process.env.ADMIN_MASTER_EMAILS = ORIGINAL;
  } else {
    delete process.env.ADMIN_MASTER_EMAILS;
  }
  const mod = await import(MODULE_PATH);
  mod.__resetAdminMasterCacheForTests();
});

describe("admin-master.server", () => {
  test("default: e-mail admin embutido é reconhecido", async () => {
    delete process.env.ADMIN_MASTER_EMAILS;
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    expect(isAdminMasterEmail("felipe.out.silva@outlook.com")).toBe(true);
    expect(isAdminMasterEmail("michael@medeiroscenografia.com.br")).toBe(true);
    expect(getAdminMasterSource()).toBe("default");
    expect(getAdminMasterEmails().length).toBeGreaterThan(0);
  });

  test("env override: lista vinda de ADMIN_MASTER_EMAILS é honrada", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com, bob@example.com";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    expect(getAdminMasterSource()).toBe("env");
    expect(getAdminMasterEmails()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(isAdminMasterEmail("alice@example.com")).toBe(true);
    expect(isAdminMasterEmail("bob@example.com")).toBe(true);
    expect(isAdminMasterEmail("felipe.out.silva@outlook.com")).toBe(false);
  });

  test("case-insensitive: maiúsculas/minúsculas são equivalentes", async () => {
    process.env.ADMIN_MASTER_EMAILS = "Alice@Example.COM";
    const { isAdminMasterEmail } = await load();
    expect(isAdminMasterEmail("ALICE@example.com")).toBe(true);
    expect(isAdminMasterEmail("alice@example.com")).toBe(true);
    expect(isAdminMasterEmail("alice@EXAMPLE.com")).toBe(true);
  });

  test("espaços extras são ignorados na configuração e na entrada", async () => {
    process.env.ADMIN_MASTER_EMAILS = "  alice@example.com  ,  bob@example.com  ";
    const { isAdminMasterEmail, getAdminMasterEmails } = await load();
    expect(getAdminMasterEmails()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(isAdminMasterEmail("   alice@example.com   ")).toBe(true);
  });

  test("e-mail não-admin é rejeitado", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com";
    const { isAdminMasterEmail } = await load();
    expect(isAdminMasterEmail("eve@example.com")).toBe(false);
    expect(isAdminMasterEmail(null)).toBe(false);
    expect(isAdminMasterEmail(undefined)).toBe(false);
    expect(isAdminMasterEmail("")).toBe(false);
    expect(isAdminMasterEmail("not-an-email")).toBe(false);
  });

  test("ADMIN_MASTER_EMAILS vazia/inválida → fallback seguro (default), nunca abre para todos", async () => {
    process.env.ADMIN_MASTER_EMAILS = "   , , ";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    // Strings inválidas filtradas → cai para default (fail-safe).
    expect(getAdminMasterSource()).toBe("default");
    expect(getAdminMasterEmails().length).toBeGreaterThan(0);
    expect(isAdminMasterEmail("eve@example.com")).toBe(false);
  });

  test("duplicatas na env são deduplicadas", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com,ALICE@example.com, alice@example.com";
    const { getAdminMasterEmails } = await load();
    expect(getAdminMasterEmails()).toEqual(["alice@example.com"]);
  });
});

describe("WA-B1 — fonte única de Admin Master", () => {
  test("webhook, authz e comprovantes usam o mesmo módulo central", async () => {
    const { readFileSync } = await import("fs");
    const authz = readFileSync("src/server/whatsapp-authz.server.ts", "utf8");
    const webhook = readFileSync("src/routes/api/public.whatsapp.expense.ts", "utf8");
    const comprov = readFileSync("src/server/whatsapp-comprovantes.server.ts", "utf8");
    const apiAuth = readFileSync("src/server/api-auth.ts", "utf8");

    expect(authz).toContain("admin-master.server");
    expect(comprov).toContain("admin-master.server");
    expect(apiAuth).toContain("admin-master.server");

    // Webhook não pode mais ter lista hardcoded.
    expect(webhook).not.toContain("felipe.out.silva@outlook.com");
    expect(authz).not.toMatch(/const\s+ADMIN_MASTER_EMAILS\s*=/);
    expect(comprov).not.toMatch(/const\s+adminEmails\s*=\s*\[/);
    expect(apiAuth).not.toMatch(/const\s+ADMIN_MASTER_EMAILS\s*:/);
  });

  test("nenhum arquivo server-side fora do módulo central tem lista hardcoded de admin", async () => {
    const { execSync } = await import("child_process");
    // Busca por e-mails de admin master hardcoded em qualquer arquivo
    // server-side, exceto o próprio módulo central e os testes.
    let hits = "";
    try {
      hits = execSync(
        `grep -rln "felipe.out.silva@outlook.com\\|michael@medeiroscenografia.com.br" src/server 2>/dev/null || true`,
        { encoding: "utf8" },
      ).trim();
    } catch {
      hits = "";
    }
    const offenders = hits
      .split("\n")
      .filter((p) => p && !p.endsWith("admin-master.server.ts"));

    expect(offenders).toEqual([]);
  });
});
