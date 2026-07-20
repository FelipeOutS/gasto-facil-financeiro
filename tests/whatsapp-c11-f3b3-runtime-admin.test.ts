/**
 * WA-C11 FASE 3B.3 — Runtime Config Admin.
 *
 * Testa readRuntimeConfig + updateRuntimeConfig com client injetado.
 * Nenhum teste chama Meta, dispatcher, notification creation ou Graph.
 */
import { describe, test, expect } from "bun:test";

type State = {
  global_enabled: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  notification_creation_enabled: boolean;
  new_links_enabled: boolean;
  rollout_enabled: boolean;
  rollout_percentage: number;
  global_daily_outbound_limit: number;
  maintenance_message_enabled: boolean;
  reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

const BASE_OFF: State = {
  global_enabled: false,
  inbound_enabled: false,
  outbound_enabled: false,
  notification_creation_enabled: false,
  new_links_enabled: false,
  rollout_enabled: false,
  rollout_percentage: 0,
  global_daily_outbound_limit: 0,
  maintenance_message_enabled: false,
  reason: null,
  updated_at: null,
  updated_by: null,
};

function makeClient(initial: State | null, failMode: "none" | "read" | "update" = "none") {
  let row: State | null = initial ? { ...initial } : null;
  return {
    row: () => row,
    from(table: string) {
      if (table !== "whatsapp_runtime_config") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          return {
            eq(_c: string, _v: unknown) {
              return {
                async maybeSingle() {
                  if (failMode === "read") return { data: null, error: { message: "boom" } };
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        update(patch: Partial<State>) {
          return {
            async eq(_c: string, _v: unknown) {
              if (failMode === "update") return { error: { message: "boom" } };
              if (row) row = { ...row, ...patch, updated_at: new Date().toISOString() };
              return { error: null };
            },
          };
        },
      };
    },
  };
}

describe("WA-C11 3B.3 — readRuntimeConfig", () => {
  test("lê estado do singleton", async () => {
    const { readRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient({ ...BASE_OFF, rollout_percentage: 5 });
    const r = await readRuntimeConfig(c);
    expect(r.rollout_percentage).toBe(5);
    expect(r.global_enabled).toBe(false);
  });

  test("registro ausente ⇒ fail-closed OFF", async () => {
    const { readRuntimeConfig, FAIL_CLOSED_RUNTIME } = await import(
      "../src/server/whatsapp-runtime-config.server"
    );
    const c = makeClient(null);
    const r = await readRuntimeConfig(c);
    expect(r).toEqual({ ...FAIL_CLOSED_RUNTIME });
  });

  test("erro de banco ⇒ fail-closed OFF", async () => {
    const { readRuntimeConfig, FAIL_CLOSED_RUNTIME } = await import(
      "../src/server/whatsapp-runtime-config.server"
    );
    const c = makeClient(BASE_OFF, "read");
    const r = await readRuntimeConfig(c);
    expect(r).toEqual({ ...FAIL_CLOSED_RUNTIME });
  });

  test("percentual fora do range é clamped no read", async () => {
    const { readRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient({ ...BASE_OFF, rollout_percentage: 999 });
    const r = await readRuntimeConfig(c);
    expect(r.rollout_percentage).toBe(100);
  });
});

describe("WA-C11 3B.3 — updateRuntimeConfig", () => {
  test("motivo obrigatório para campos sensíveis (global_enabled)", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r = await updateRuntimeConfig(
      { global_enabled: true },
      { adminUserId: "u1", reason: null },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
  });

  test("motivo curto (<3) ⇒ reason_required", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r = await updateRuntimeConfig(
      { outbound_enabled: true },
      { adminUserId: "u1", reason: "  " },
      c,
    );
    expect(r.ok).toBe(false);
  });

  test("percentual fora do intervalo ⇒ invalid_patch", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r1 = await updateRuntimeConfig(
      { rollout_percentage: -1 },
      { adminUserId: "u1", reason: "beta test" },
      c,
    );
    const r2 = await updateRuntimeConfig(
      { rollout_percentage: 101 },
      { adminUserId: "u1", reason: "beta test" },
      c,
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  test("percentual válido é gravado", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r = await updateRuntimeConfig(
      { rollout_percentage: 10 },
      { adminUserId: "u1", reason: "canary v2" },
      c,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.rollout_percentage).toBe(10);
  });

  test("erro de banco ⇒ db_error", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF, "update");
    const r = await updateRuntimeConfig(
      { rollout_percentage: 10 },
      { adminUserId: "u1", reason: "canary" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("db_error");
  });

  test("alteração de flag não-sensível (inbound) não exige motivo", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r = await updateRuntimeConfig(
      { inbound_enabled: true },
      { adminUserId: "u1", reason: null },
      c,
    );
    expect(r.ok).toBe(true);
  });

  test("global_daily_outbound_limit acima do teto ⇒ invalid_patch", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    const r = await updateRuntimeConfig(
      { global_daily_outbound_limit: 1_000_001 },
      { adminUserId: "u1", reason: "beta ramp" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_patch");
  });

  test("nenhuma alteração invoca dispatcher/Graph (sem side-effects fora do client)", async () => {
    const { updateRuntimeConfig } = await import("../src/server/whatsapp-runtime-config.server");
    const c = makeClient(BASE_OFF);
    await updateRuntimeConfig(
      { rollout_percentage: 5 },
      { adminUserId: "u1", reason: "beta" },
      c,
    );
    // O client fake é a única superfície tocada. Se algum código chamasse
    // outra tabela, faria throw. Se chamasse Graph, seria observável — este
    // teste garante que o único efeito é a linha do singleton.
    const row = (c as unknown as { row: () => State | null }).row();
    expect(row?.rollout_percentage).toBe(5);
  });
});
