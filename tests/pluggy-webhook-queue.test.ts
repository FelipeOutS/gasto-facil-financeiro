import { test, expect } from "bun:test";
import {
  drainWebhooks,
  reconcileItems,
  receiveWebhook,
  safeErrorCode,
  type ClaimedEvent,
  type QueueDb,
} from "../src/server/pluggy/pluggy-webhook-queue.server";
import type { PluggyStore } from "../src/server/pluggy/pluggy-sync.server";

const F = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const M = "47df50ce-df1e-4c54-8fae-0ffb5105478d";

/** Fila em memória com a mesma semântica das RPCs SQL. */
function memDb() {
  type Row = ClaimedEvent & { status: string; error: string | null };
  const rows = new Map<string, Row>();
  let n = 0;
  const db: QueueDb & { rows: typeof rows } = {
    rows,
    async enqueue(e) {
      const r = rows.get(e.eventId);
      if (!r) {
        rows.set(e.eventId, {
          id: e.eventId,
          event: e.event,
          item_id: e.itemId,
          transaction_ids: e.transactionIds,
          attempts: 0,
          max_attempts: 3,
          claim_token: "",
          status: "pendente",
          error: null,
        });
        return { status: "pendente", isNew: true };
      }
      if (r.status === "falhou") r.status = "pendente";
      return { status: r.status, isNew: false };
    },
    async claim(limit) {
      const out: ClaimedEvent[] = [];
      for (const r of rows.values()) {
        if (out.length >= limit || !["pendente", "falhou"].includes(r.status)) continue;
        r.status = "processando";
        r.attempts++;
        r.claim_token = `c${++n}`;
        out.push({ ...r });
      }
      return out;
    },
    async finish(id, token, ok, error) {
      const r = rows.get(id)!;
      if (r.claim_token !== token || r.status !== "processando") return "reserva_perdida";
      r.status = ok ? "concluido" : r.attempts >= r.max_attempts ? "esgotado" : "falhou";
      r.error = ok ? null : error;
      return r.status;
    },
    async staleItems() {
      return [
        { userId: F, itemId: "iF" },
        { userId: "intruso", itemId: "iX" },
      ];
    },
  };
  return db;
}
const store = (owners: Record<string, string>, log: string[]) =>
  ({
    getItemOwner: async (i: string) => (owners[i] ? { userId: owners[i], isSandbox: true } : null),
    markItemDeleted: async (i: string) => void log.push(`del:${i}`),
    markTransactionsDeleted: async (u: string, ids: string[]) =>
      void log.push(`txdel:${u}:${ids.join(",")}`),
  }) as unknown as PluggyStore;
const allow = async (u: string) => {
  if (![F, M].includes(u)) throw new Error("forbidden");
};

test("receber só grava; reentrega não duplica", async () => {
  const db = memDb();
  expect(await receiveWebhook(db, { eventId: "e1", event: "item/updated", itemId: "iF" })).toEqual({
    status: "pendente",
    isNew: true,
  });
  expect(
    (await receiveWebhook(db, { eventId: "e1", event: "item/updated", itemId: "iF" })).isNew,
  ).toBe(false);
  expect(db.rows.size).toBe(1);
});

test("falha → reprocessa na reentrega → concluído; concluído não reprocessa", async () => {
  const db = memDb();
  const calls: string[] = [];
  let fail = true;
  const deps = {
    db,
    store: store({ iF: F }, []),
    api: {} as never,
    assertAccess: allow,
    syncItem: async (_: unknown, i: { userId: string; itemId: string }) => {
      calls.push(i.userId);
      return fail ? { ok: false, error: "pluggy_http_500" } : { ok: true };
    },
  };
  await receiveWebhook(db, { eventId: "e1", event: "transactions/created", itemId: "iF" });
  expect((await drainWebhooks(deps))[0].status).toBe("falhou");
  expect(db.rows.get("e1")!.error).toBe("pluggy_http_500");
  fail = false;
  await receiveWebhook(db, { eventId: "e1", event: "transactions/created", itemId: "iF" });
  expect((await drainWebhooks(deps))[0].status).toBe("concluido");
  await receiveWebhook(db, { eventId: "e1", event: "transactions/created", itemId: "iF" });
  expect(await drainWebhooks(deps)).toEqual([]);
  expect(calls).toEqual([F, F]);
});

test("tentativas limitadas terminam em esgotado", async () => {
  const db = memDb();
  const deps = {
    db,
    store: store({ iF: F }, []),
    api: {} as never,
    assertAccess: allow,
    syncItem: async () => ({ ok: false, error: "x_y" }),
  };
  await receiveWebhook(db, { eventId: "e", event: "item/updated", itemId: "iF" });
  const st: string[] = [];
  for (let i = 0; i < 4; i++) st.push(...(await drainWebhooks(deps)).map((r) => r.status));
  expect(st).toEqual(["falhou", "falhou", "esgotado"]);
});

test("dono vem do item salvo; conta fora da allowlist não sincroniza", async () => {
  const db = memDb();
  const calls: string[] = [];
  const deps = {
    db,
    store: store({ iX: "intruso" }, []),
    api: {} as never,
    assertAccess: allow,
    syncItem: async (_: unknown, i: { userId: string }) => {
      calls.push(i.userId);
      return { ok: true };
    },
  };
  await receiveWebhook(db, { eventId: "e", event: "item/updated", itemId: "iX" });
  expect((await drainWebhooks(deps))[0].status).toBe("falhou");
  expect(db.rows.get("e")!.error).toBe("forbidden");
  expect(calls).toEqual([]);
});

test("transactions/deleted rechecks provider state before staging deletion", async () => {
  const db = memDb();
  const log: string[] = [];
  const deps = {
    db,
    store: store({ iM: M }, log),
    api: {} as never,
    assertAccess: allow,
    syncItem: async (_: unknown, input: unknown) => {
      expect(input).toEqual({
        userId: M,
        itemId: "iM",
        transactionIds: ["t1", "t2"],
        confirmDeleted: true,
      });
      return { ok: true };
    },
  };
  await receiveWebhook(db, {
    eventId: "d",
    event: "transactions/deleted",
    itemId: "iM",
    transactionIds: ["t1", "t2"],
  });
  await drainWebhooks(deps);
  expect(log).toEqual([]);
});

test("reconciliação sincroniza só contas autorizadas", async () => {
  const db = memDb();
  const calls: string[] = [];
  const out = await reconcileItems({
    db,
    store: store({}, []),
    api: {} as never,
    assertAccess: allow,
    syncItem: async (_: unknown, i: { userId: string }) => {
      calls.push(i.userId);
      return { ok: true };
    },
  });
  expect(calls).toEqual([F]);
  expect(out[1]).toEqual({ itemId: "iX", ok: false, error: "forbidden" });
});

test("erros guardados não carregam dados sensíveis", () => {
  expect(safeErrorCode(new Error("Pix R$ 1.234,56 para João"))).toBe("erro_interno");
  expect(safeErrorCode({})).toBe("erro_interno");
  expect(safeErrorCode(new Error("pluggy_http_500"))).toBe("pluggy_http_500");
  expect(safeErrorCode(new Error("conta_12345678"))).toBe("erro_interno");
});

test("token-shaped freeform errors are never persisted", () => {
  expect(safeErrorCode(new Error("abc.def.secret"))).toBe("erro_interno");
});

import { PluggyHttpError } from "../src/server/pluggy/pluggy-api.server";
for (const status of [200, 404, 500])
  test("item/deleted revalidates provider status " + status, async () => {
    const db = memDb(),
      log: string[] = [];
    await receiveWebhook(db, { eventId: "stale-delete", event: "item/deleted", itemId: "iF" });
    const api = {
      item: async () => {
        if (status !== 200) throw new PluggyHttpError(status, "test");
        return { id: "iF" };
      },
    } as never;
    const result = await drainWebhooks({
      db,
      store: store({ iF: F }, log),
      api,
      assertAccess: allow,
      syncItem: async () => ({ ok: true }),
    });
    expect(log).toEqual(status === 404 ? ["del:iF"] : []);
    expect(result[0].status).toBe(status === 500 ? "falhou" : "concluido");
  });
