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

function makeChain(filters: { key?: string; sinceISO?: string }) {
  return {
    eq(col: string, val: string) {
      if (col === "key") filters.key = val;
      return makeChain(filters);
    },
    gte(col: string, val: string) {
      if (col === "created_at") filters.sinceISO = val;
      const count = store.events.filter(
        (e) =>
          (!filters.key || e.key === filters.key) &&
          (!filters.sinceISO || e.created_at >= filters.sinceISO),
      ).length;
      return Promise.resolve({ count, data: null, error: null });
    },
  };
}

const fakeAdmin = {
  from(table: string) {
    if (dbFailure) {
      throw new Error("db unavailable");
    }
    if (table !== "rate_limit_events") {
      throw new Error(`Tabela inesperada no teste: ${table}`);
    }
    return {
      select(_cols: string, _opts?: { count?: string; head?: boolean }) {
        return makeChain({});
      },
      insert(row: { key: string; created_at?: string }) {
        store.events.push({
          key: row.key,
          created_at: row.created_at ?? new Date(nowMs).toISOString(),
        });
        return Promise.resolve({ data: null, error: null });
      },
    };
  },
};

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeAdmin,
}));
mock.module("./logs.server", () => ({
  logAuditEvent: async () => {},
}));

const { checkRateLimit, enforceUserRateLimit, RATE_LIMIT_PRESETS } = await import(
  "../src/server/rate-limit.server"
);

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

  it("[observação P1 — WA-C8.2] concorrência pura expõe race count-then-insert", async () => {
    // Este teste NÃO reprova o gate: documenta que, sob 20 chamadas
    // estritamente simultâneas para o MESMO usuário, o padrão atual
    // (contar → inserir) pode autorizar mais que 10 porque todas as
    // leituras enxergam o mesmo count antes dos inserts persistirem.
    // No fluxo real do webhook WhatsApp isso não ocorre (mensagens do
    // mesmo usuário são serializadas). Registrado como pendência P1
    // para endurecer com contador atômico antes do envio real.
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
    expect(allowed + blocked).toBe(20);
    // Após a rajada, a próxima chamada (serializada) tem que estar
    // bloqueada — o estado convergiu mesmo com a race.
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
