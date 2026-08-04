/**
 * WA-C8.2 — Rate limit atômico via RPC `rate_limit_hit`.
 *
 * Substitui o cliente admin por um fake que reproduz a semântica atômica
 * (advisory lock serializando por chave) sem tocar no banco real.
 *
 * Cobre:
 *  1. primeiras N-1 permitidas, N bloqueia (limit configurável);
 *  2. 20 chamadas paralelas com limit=10 → exatamente 10 allowed / 10 blocked;
 *  3. 100 chamadas paralelas com limit=25 → exatamente 25 allowed / 75 blocked;
 *  4. isolamento entre dois usuários (paralelo cross-user);
 *  5. isolamento entre dois scopes do mesmo usuário;
 *  6. reset após janela;
 *  7. janela cruzando mudança de minuto/hora;
 *  8. DB error → fail-closed retorna 429 para OCR de boleto;
 *  9. DB error → fail-open (default) NÃO bloqueia;
 * 10. nenhuma escrita financeira acontece — o teste só exercita o helper.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type Event = { key: string; created_at: string };
const store: { events: Event[] } = { events: [] };
let nowMs = new Date("2026-07-12T10:00:00.000Z").getTime();
let dbFailure = false;

type RpcArgs = {
  _key: string;
  _route: string;
  _limit: number;
  _window_seconds: number;
};

// Serialização por chave — equivale ao pg_advisory_xact_lock(hash(key)).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

async function rpcRateLimitHit(args: RpcArgs) {
  return serialize(args._key, async () => {
    if (dbFailure) return { data: null, error: { message: "db unavailable" } };
    const sinceMs = nowMs - args._window_seconds * 1000;
    const count = store.events.filter(
      (e) => e.key === args._key && new Date(e.created_at).getTime() >= sinceMs,
    ).length;
    const blocked = count >= args._limit;
    store.events.push({ key: args._key, created_at: new Date(nowMs).toISOString() });
    return {
      data: [
        {
          current_count: blocked ? count : count + 1,
          blocked,
          reset_at: new Date(nowMs + args._window_seconds * 1000).toISOString(),
        },
      ],
      error: null,
    };
  });
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc(name: string, args: RpcArgs) {
      if (name !== "rate_limit_hit") throw new Error(`RPC inesperada: ${name}`);
      return rpcRateLimitHit(args);
    },
  },
}));
mock.module("../src/server/logs.server", () => ({ logAuditEvent: async () => {} }));

const { checkRateLimit, enforceUserRateLimit } = await import("../src/server/rate-limit.server");

const originalDateNow = Date.now;
beforeEach(() => {
  store.events = [];
  chains.clear();
  nowMs = new Date("2026-07-12T10:00:00.000Z").getTime();
  dbFailure = false;
  Date.now = () => nowMs;
});
afterEach(() => {
  Date.now = originalDateNow;
});

describe("WA-C8.2 — rate limit atômico", () => {
  it("primeiras N-1 permitidas, N bloqueia (limit=7)", async () => {
    const key = "test:sequential";
    for (let i = 0; i < 6; i++) {
      const r = await checkRateLimit({ key, route: "r", limit: 7, windowSeconds: 60 });
      expect(r.blocked).toBe(false);
    }
    const r7 = await checkRateLimit({ key, route: "r", limit: 7, windowSeconds: 60 });
    expect(r7.blocked).toBe(false);
    const r8 = await checkRateLimit({ key, route: "r", limit: 7, windowSeconds: 60 });
    expect(r8.blocked).toBe(true);
  });

  it("20 paralelas com limit=10 → exatamente 10 allowed / 10 blocked", async () => {
    const key = "test:par20";
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkRateLimit({ key, route: "r", limit: 10, windowSeconds: 60 }),
      ),
    );
    const allowed = results.filter((r) => !r.blocked).length;
    const blocked = results.filter((r) => r.blocked).length;
    expect(allowed).toBe(10);
    expect(blocked).toBe(10);
  });

  it("100 paralelas com limit=25 → exatamente 25 allowed / 75 blocked", async () => {
    const key = "test:par100";
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        checkRateLimit({ key, route: "r", limit: 25, windowSeconds: 60 }),
      ),
    );
    expect(results.filter((r) => !r.blocked).length).toBe(25);
    expect(results.filter((r) => r.blocked).length).toBe(75);
  });

  it("isolamento entre dois usuários — bloqueio de A não afeta B", async () => {
    const bulkA = Array.from({ length: 10 }, () =>
      enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId: "user-A",
        route: "r",
        failMode: "closed",
      }),
    );
    const bulkB = Array.from({ length: 10 }, () =>
      enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId: "user-B",
        route: "r",
        failMode: "closed",
      }),
    );
    const [resA, resB] = await Promise.all([Promise.all(bulkA), Promise.all(bulkB)]);
    // Ambos os usuários tiveram 10 permitidas.
    expect(resA.every((r) => r === null)).toBe(true);
    expect(resB.every((r) => r === null)).toBe(true);
    // 11ª de A bloqueia; 11ª de B ainda passa? Não — B também consumiu 10.
    // O ponto é isolamento: bloquear A não bloqueia B.
    const nextA = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: "user-A",
      route: "r",
      failMode: "closed",
    });
    const nextB = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: "user-B",
      route: "r",
      failMode: "closed",
    });
    expect(nextA?.status).toBe(429);
    expect(nextB?.status).toBe(429);
    // Novo user C está zerado.
    const nextC = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: "user-C",
      route: "r",
      failMode: "closed",
    });
    expect(nextC).toBeNull();
  });

  it("isolamento entre dois scopes do mesmo usuário", async () => {
    const userId = "user-scopes";
    // Esgota scope 'whatsappBoletoOcr' (10/h)
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "r",
        failMode: "closed",
      });
    }
    const bocr = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "r",
      failMode: "closed",
    });
    expect(bocr?.status).toBe(429);
    // Outro scope não herda
    const ai = await enforceUserRateLimit({ scope: "ai", userId, route: "r" });
    expect(ai).toBeNull();
    const flyer = await enforceUserRateLimit({ scope: "flyerOcr", userId, route: "r" });
    expect(flyer).toBeNull();
  });

  it("reset após a janela", async () => {
    const key = "test:reset";
    for (let i = 0; i < 5; i++) {
      await checkRateLimit({ key, route: "r", limit: 5, windowSeconds: 60 });
    }
    const blocked = await checkRateLimit({ key, route: "r", limit: 5, windowSeconds: 60 });
    expect(blocked.blocked).toBe(true);
    nowMs += 61 * 1000;
    const again = await checkRateLimit({ key, route: "r", limit: 5, windowSeconds: 60 });
    expect(again.blocked).toBe(false);
  });

  it("janela cruzando mudança de hora", async () => {
    // Coloca timestamp exatamente em xx:59:30
    nowMs = new Date("2026-07-12T10:59:30.000Z").getTime();
    const key = "test:cross-hour";
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({ key, route: "r", limit: 3, windowSeconds: 60 });
    }
    // +45s → 11:00:15 (dentro da janela deslizante de 60s)
    nowMs += 45 * 1000;
    const stillBlocked = await checkRateLimit({ key, route: "r", limit: 3, windowSeconds: 60 });
    expect(stillBlocked.blocked).toBe(true);
    // +60s adicional → 11:01:15 (fora da janela)
    nowMs += 60 * 1000;
    const ok = await checkRateLimit({ key, route: "r", limit: 3, windowSeconds: 60 });
    expect(ok.blocked).toBe(false);
  });

  it("DB error + fail-closed → 429 (OCR de boleto)", async () => {
    dbFailure = true;
    const r = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: "u",
      route: "r",
      failMode: "closed",
    });
    expect(r?.status).toBe(429);
  });

  it("DB error + fail-open (default) → não bloqueia", async () => {
    dbFailure = true;
    const r = await enforceUserRateLimit({ scope: "ai", userId: "u", route: "r" });
    expect(r).toBeNull();
  });

  it("nenhuma escrita além de rate_limit_events é possível (helper isolado)", async () => {
    // Este teste materializa o contrato: o helper NUNCA toca em outras
    // tabelas. Se o código passar a chamar `.from(...)` em qualquer tabela,
    // o mock atual (que só expõe .rpc) quebraria — o que já é sinal.
    await checkRateLimit({ key: "isolated", route: "r", limit: 1, windowSeconds: 60 });
    // Só há eventos em `store.events` (que representa rate_limit_events).
    expect(store.events.length).toBe(1);
  });
});
