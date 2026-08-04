/**
 * WA-3.36 — Boleto OCR rate limit: contrato fail-closed e 10/h por usuário.
 *
 * Substitui o módulo `@/integrations/supabase/client.server` por um fake
 * em memória ANTES de importar `rate-limit.server`. Assim exercita o
 * código real de `checkRateLimit` / `enforceUserRateLimit` sem tocar em
 * `rate_limit_events` de produção, sem chamar Gemini/OCR, e sem criar
 * conta, gasto, fornecedor, recorrência, Pix ou sessão financeira.
 *
 * Cobertura:
 *  1. Preset expõe 10 chamadas / 3600s (whatsappBoletoOcrPerUser).
 *  2. As 10 primeiras tentativas passam; a 11ª bloqueia com 429 rate_limited.
 *  3. Chave por usuário: `whatsappBoletoOcr:<userId>` — outro user não herda.
 *  4. Após o relógio avançar 3601s, uma nova tentativa é permitida.
 *  5. 20 tentativas paralelas — apuramos allowed vs blocked e documentamos
 *     o comportamento sob concorrência (contar-depois-inserir).
 *  6. checkRateLimit direto: 10ª blocked=false, 11ª blocked=true.
 *  7. Fail-closed: com DB indisponível, enforce retorna 429 no scope
 *     whatsappBoletoOcr (contrato do OCR de boleto).
 *  8. Mensagem ao usuário não vaza detalhes internos do limiter.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type Event = { key: string; created_at: string };
const store: { events: Event[] } = { events: [] };
let nowMs = new Date("2026-07-11T15:00:00.000Z").getTime();
let dbFailure = false;

/**
 * Fake admin agora expõe `.rpc('rate_limit_hit', ...)` — a implementação
 * real vive no Postgres (advisory lock + INSERT em rate_limit_events).
 * Este mock reproduz a semântica atômica sequenciando por chave.
 */
type RpcArgs = {
  _key: string;
  _route: string;
  _limit: number;
  _window_seconds: number;
  _ip_address?: string;
  _user_id?: string;
  _user_agent?: string;
  _method?: string;
};

// Serialização por chave — equivalente ao pg_advisory_xact_lock(hash(key)).
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

const fakeAdmin = {
  rpc(name: string, args: RpcArgs) {
    if (name !== "rate_limit_hit") {
      throw new Error(`RPC inesperada no teste: ${name}`);
    }
    return rpcRateLimitHit(args);
  },
};

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeAdmin,
}));
mock.module("./logs.server", () => ({
  logAuditEvent: async () => {},
}));

const { checkRateLimit, enforceUserRateLimit, RATE_LIMIT_PRESETS } =
  await import("../src/server/rate-limit.server");

const originalDateNow = Date.now;

beforeEach(() => {
  store.events = [];
  nowMs = new Date("2026-07-11T15:00:00.000Z").getTime();
  dbFailure = false;
  Date.now = () => nowMs;
});

afterEach(() => {
  Date.now = originalDateNow;
});

describe("WA-3.36 — boleto OCR rate limit (fail-closed, 10/h por usuário)", () => {
  it("preset expõe exatamente 10 chamadas em 3600s", () => {
    expect(RATE_LIMIT_PRESETS.whatsappBoletoOcrPerUser).toEqual({
      limit: 10,
      windowSeconds: 3600,
    });
  });

  it("primeiras 10 tentativas permitidas, 11ª bloqueada por rate limit", async () => {
    const userId = "user-A";
    const results: Array<Response | null> = [];
    for (let i = 0; i < 11; i++) {
      const r = await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
      results.push(r);
      nowMs += 1000; // avança 1s entre chamadas para simular tráfego real
    }
    for (let i = 0; i < 10; i++) expect(results[i]).toBeNull();
    expect(results[10]).not.toBeNull();
    expect(results[10]!.status).toBe(429);
    const body = await results[10]!.clone().json();
    expect(body.code).toBe("rate_limited");
    // Contrato do namespace: chave `whatsappBoletoOcr:<userId>`
    expect(store.events.every((e) => e.key === `whatsappBoletoOcr:${userId}`)).toBe(true);
  });

  it("isolamento por usuário: outro user_id não herda o bloqueio", async () => {
    const userA = "user-A";
    const userB = "user-B";
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId: userA,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
    }
    const blockedA = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: userA,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(blockedA?.status).toBe(429);

    const allowedB = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: userB,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(allowedB).toBeNull();
  });

  it("reset após a janela: avançar 3601s libera nova tentativa", async () => {
    const userId = "user-C";
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
    }
    const blocked = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(blocked?.status).toBe(429);

    nowMs += 3601 * 1000; // fora da janela deslizante
    const allowedAgain = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(allowedAgain).toBeNull();
  });

  it("regime real WhatsApp (webhooks serializados): 15 mensagens seguidas → só 10 passam", async () => {
    // O webhook do WhatsApp processa uma mensagem por vez por usuário
    // (fila serializada no worker). O gate é avaliado nessa serialização.
    const userId = "user-D";
    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 15; i++) {
      const r = await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
      if (r === null) allowed++;
      else if (r.status === 429) blocked++;
    }
    expect(allowed).toBe(10);
    expect(blocked).toBe(5);
  });

  it("[WA-C8.2 corrigido] concorrência pura: 20 paralelas → exatamente 10 permitidas", async () => {
    // Após WA-C8.2, o gate usa `rate_limit_hit` (advisory lock por chave).
    // Sob 20 chamadas estritamente simultâneas para o MESMO usuário, o
    // resultado é determinístico: exatamente 10 permitidas e 10 bloqueadas.
    const userId = "user-D2";
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        enforceUserRateLimit({
          scope: "whatsappBoletoOcr",
          userId,
          route: "whatsapp/boleto-ocr-image",
          failMode: "closed",
        }),
      ),
    );
    const allowed = results.filter((r) => r === null).length;
    const blocked = results.filter((r) => r && r.status === 429).length;
    expect(allowed).toBe(10);
    expect(blocked).toBe(10);
    // Próxima chamada continua bloqueada.
    const next = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(next?.status).toBe(429);
  });

  it("checkRateLimit direto: 10ª blocked=false, 11ª blocked=true", async () => {
    const key = "whatsappBoletoOcr:user-E";
    let last: Awaited<ReturnType<typeof checkRateLimit>> | null = null;
    for (let i = 0; i < 11; i++) {
      last = await checkRateLimit({
        key,
        route: "whatsapp/boleto-ocr-image",
        limit: 10,
        windowSeconds: 3600,
      });
      if (i < 10) expect(last.blocked).toBe(false);
    }
    expect(last!.blocked).toBe(true);
    expect(last!.limit).toBe(10);
  });

  it("fail-closed: DB indisponível retorna 429 no scope whatsappBoletoOcr", async () => {
    dbFailure = true;
    const resp = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: "user-F",
      route: "whatsapp/boleto-ocr-pdf",
      failMode: "closed",
    });
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(429);
  });

  it("mensagem ao usuário não vaza detalhes internos do limiter", async () => {
    const userId = "user-G";
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
    }
    const blocked = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    const body = await blocked!.clone().json();
    // Não expõe: limite absoluto, janela em segundos, chave, contador atual, user_id
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/3600|whatsappBoletoOcr|user-G|count|limit\s*:\s*\d/i);
  });
});
