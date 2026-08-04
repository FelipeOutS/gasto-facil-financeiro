/**
 * tests/admin-master-server.test.ts
 *
 * Cobre a fonte única server-side de Admin Master (WA-B1 + WA-B4 fail-closed).
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

describe("admin-master.server — fail-closed (WA-B4)", () => {
  test("env válida: e-mails são reconhecidos", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com, bob@example.com";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails, isAdminMasterConfigured } =
      await load();
    expect(getAdminMasterSource()).toBe("env");
    expect(isAdminMasterConfigured()).toBe(true);
    expect(getAdminMasterEmails()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(isAdminMasterEmail("alice@example.com")).toBe(true);
    expect(isAdminMasterEmail("bob@example.com")).toBe(true);
  });

  test("env ausente: lista vazia, ninguém vira admin (fail-closed)", async () => {
    delete process.env.ADMIN_MASTER_EMAILS;
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails, isAdminMasterConfigured } =
      await load();
    expect(getAdminMasterSource()).toBe("none");
    expect(isAdminMasterConfigured()).toBe(false);
    expect(getAdminMasterEmails()).toEqual([]);
    expect(isAdminMasterEmail("alice@example.com")).toBe(false);
    expect(isAdminMasterEmail("anyone@anywhere.com")).toBe(false);
  });

  test("env vazia: lista vazia (fail-closed)", async () => {
    process.env.ADMIN_MASTER_EMAILS = "";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    expect(getAdminMasterSource()).toBe("none");
    expect(getAdminMasterEmails()).toEqual([]);
    expect(isAdminMasterEmail("alice@example.com")).toBe(false);
  });

  test("env só com vírgulas/espaços: lista vazia (fail-closed)", async () => {
    process.env.ADMIN_MASTER_EMAILS = "  , , ";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    expect(getAdminMasterSource()).toBe("none");
    expect(getAdminMasterEmails()).toEqual([]);
    expect(isAdminMasterEmail("eve@example.com")).toBe(false);
  });

  test("env com itens inválidos: apenas inválidos são filtrados; se sobrar 0, fail-closed", async () => {
    process.env.ADMIN_MASTER_EMAILS = "not-an-email, @nope, foo@, ";
    const { isAdminMasterEmail, getAdminMasterSource, getAdminMasterEmails } = await load();
    expect(getAdminMasterSource()).toBe("none");
    expect(getAdminMasterEmails()).toEqual([]);
    expect(isAdminMasterEmail("alice@example.com")).toBe(false);
  });

  test("case-insensitive e tolerante a espaços", async () => {
    process.env.ADMIN_MASTER_EMAILS = "  Alice@Example.COM  ";
    const { isAdminMasterEmail, getAdminMasterEmails } = await load();
    expect(getAdminMasterEmails()).toEqual(["alice@example.com"]);
    expect(isAdminMasterEmail("ALICE@example.com")).toBe(true);
    expect(isAdminMasterEmail("  alice@example.com  ")).toBe(true);
  });

  test("e-mail não-admin, null, undefined, vazio são rejeitados", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com";
    const { isAdminMasterEmail } = await load();
    expect(isAdminMasterEmail("eve@example.com")).toBe(false);
    expect(isAdminMasterEmail(null)).toBe(false);
    expect(isAdminMasterEmail(undefined)).toBe(false);
    expect(isAdminMasterEmail("")).toBe(false);
    expect(isAdminMasterEmail("not-an-email")).toBe(false);
  });

  test("duplicatas na env são deduplicadas", async () => {
    process.env.ADMIN_MASTER_EMAILS = "alice@example.com,ALICE@example.com, alice@example.com";
    const { getAdminMasterEmails } = await load();
    expect(getAdminMasterEmails()).toEqual(["alice@example.com"]);
  });

  test("sem env, nenhum log inclui valor da variável, e-mails ou segredos", async () => {
    delete process.env.ADMIN_MASTER_EMAILS;
    const captured: string[] = [];
    const origLog = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    try {
      const mod = await import(MODULE_PATH);
      mod.__resetAdminMasterCacheForTests();
      mod.getAdminMasterEmails(); // Triggers the warn immediately
    } finally {
      console.warn = origLog;
    }
    const joined = captured.join("\n");
    // Se o log não apareceu, vamos imprimir o que foi capturado para depurar
    if (!joined.includes("admin_master_config_missing")) {
      console.log("DEBUG: joined logs:", `"${joined}"`);
    }
    expect(joined).toContain("admin_master_config_missing");
    expect(joined).not.toMatch(/@/);
    expect(joined).not.toMatch(/ADMIN_MASTER_EMAILS\s*=/);
  });
});

describe("WA-B1 + WA-B4 — fonte única, sem fallback compilado em src/server", () => {
  test("webhook, authz, comprovantes e api-auth usam o módulo central", async () => {
    const { readFileSync } = await import("fs");
    const authz = readFileSync("src/server/whatsapp-authz.server.ts", "utf8");
    const webhook = readFileSync("src/routes/api/public.whatsapp.expense.ts", "utf8");
    const comprov = readFileSync("src/server/whatsapp-comprovantes.server.ts", "utf8");
    const apiAuth = readFileSync("src/server/api-auth.ts", "utf8");

    expect(authz).toContain("admin-master.server");
    expect(comprov).toContain("admin-master.server");
    expect(apiAuth).toContain("admin-master.server");
    expect(webhook).not.toContain("felipe.out.silva@outlook.com");
    expect(authz).not.toMatch(/const\s+ADMIN_MASTER_EMAILS\s*=/);
    expect(comprov).not.toMatch(/const\s+adminEmails\s*=\s*\[/);
    expect(apiAuth).not.toMatch(/const\s+ADMIN_MASTER_EMAILS\s*:/);
  });

  test("nenhum arquivo em src/server tem fallback compilado de admin (incluindo o módulo central)", async () => {
    const { execSync } = await import("child_process");
    let hits = "";
    try {
      hits = execSync(
        `grep -rln "felipe.out.silva@outlook.com\\|michael@medeiroscenografia.com.br" src/server 2>/dev/null || true`,
        { encoding: "utf8" },
      ).trim();
    } catch {
      hits = "";
    }
    const offenders = hits.split("\n").filter((p) => p.length > 0);
    expect(offenders).toEqual([]);
  });

  test("WhatsApp authz continua fail-closed: sem env, e-mail admin não passa por bypass", async () => {
    delete process.env.ADMIN_MASTER_EMAILS;
    const { isAdminMasterEmail } = await load();
    // Mesmo um e-mail que historicamente era admin não pode mais bypassar.
    expect(isAdminMasterEmail("felipe.out.silva@outlook.com")).toBe(false);
    expect(isAdminMasterEmail("michael@medeiroscenografia.com.br")).toBe(false);
  });
});
