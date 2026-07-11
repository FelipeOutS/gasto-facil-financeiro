/**
 * WA-3.36 — Boleto OCR rate limit: fail-closed contract.
 *
 * Cobre os requisitos do teste controlado:
 *  1. Limite exato de 10 chamadas / 3600s por usuário (preset whatsappBoletoOcrPerUser).
 *  2. A 11ª chamada é bloqueada com motivo de rate limit.
 *  3. Bloqueio isola por user_id (outro usuário parte do zero).
 *  4. Após avançar o relógio para fora da janela, uma nova tentativa volta a ser permitida.
 *  5. Concorrência de 20 chamadas paralelas nunca deixa passar mais que 10.
 *  6. Contadores de produção não são alterados — o teste substitui
 *     `supabaseAdmin.from("rate_limit_events")` por um armazenamento em memória
 *     enquanto qualquer outra tabela mantém o comportamento original.
 *  7. Preset e chave por usuário conferem com o contrato (10 / 3600s / whatsappBoletoOcr:<userId>).
 *
 * Nenhuma imagem/PDF é processada, nenhum Gemini é chamado, e nenhuma
 * entidade financeira é criada.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const { checkRateLimit, enforceUserRateLimit, RATE_LIMIT_PRESETS } = await import(
  "../src/server/rate-limit.server"
);

type Event = { key: string; created_at: string };

let store: Event[] = [];
let originalFrom: typeof supabaseAdmin.from;
let nowMs = 0;
let originalDateNow: () => number;

function makeFrom(table: string) {
  if (table !== "rate_limit_events") {
    return originalFrom.call(supabaseAdmin, table);
  }
  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      const filters: { key?: string; sinceISO?: string } = {};
      const chain = {
        eq(col: string, val: string) {
          if (col === "key") filters.key = val;
          return chain;
        },
        gte(col: string, val: string) {
          if (col === "created_at") filters.sinceISO = val;
          return Promise.resolve({
            count: store.filter(
              (e) =>
                (!filters.key || e.key === filters.key) &&
                (!filters.sinceISO || e.created_at >= filters.sinceISO),
            ).length,
            data: null,
            error: null,
          });
        },
      };
      void opts;
      return chain;
    },
    insert(row: { key: string; created_at?: string }) {
      store.push({
        key: row.key,
        created_at: row.created_at ?? new Date(nowMs).toISOString(),
      });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as ReturnType<typeof supabaseAdmin.from>;
}

beforeEach(() => {
  store = [];
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabaseAdmin as any).from = makeFrom;
  nowMs = new Date("2026-07-11T15:00:00.000Z").getTime();
  originalDateNow = Date.now;
  Date.now = () => nowMs;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabaseAdmin as any).from = originalFrom;
  Date.now = originalDateNow;
  store = [];
});

describe("WA-3.36 — boleto OCR rate limit", () => {
  it("preset expõe exatamente 10 chamadas em 3600s", () => {
    expect(RATE_LIMIT_PRESETS.whatsappBoletoOcrPerUser).toEqual({
      limit: 10,
      windowSeconds: 3600,
    });
  });

  it("primeiras 10 tentativas permitidas, 11ª bloqueada por rate limit", async () => {
    const userId = "user-A";
    const results = [];
    for (let i = 0; i < 11; i++) {
      const r = await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
      results.push(r);
      // Avança relógio em 1s entre eventos para simular chamadas reais
      nowMs += 1000;
    }
    // 10 primeiras liberadas (retorno null)
    for (let i = 0; i < 10; i++) expect(results[i]).toBeNull();
    // 11ª bloqueada (Response 429)
    expect(results[10]).not.toBeNull();
    expect(results[10]!.status).toBe(429);
    const body = await results[10]!.clone().json();
    expect(body.code).toBe("rate_limited");
    expect(body.message).not.toMatch(/limit|hour|user|contador/i); // não vaza detalhes internos
    // Chave usada pelo enforcePreset — validada indiretamente contando eventos:
    expect(store.filter((e) => e.key === `whatsappBoletoOcr:${userId}`).length).toBe(11);
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
    // A está no limite
    const blockedA = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: userA,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(blockedA?.status).toBe(429);

    // B parte do zero
    const allowedB = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId: userB,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(allowedB).toBeNull();
  });

  it("após avançar o relógio para fora da janela (>3600s), nova tentativa é permitida", async () => {
    const userId = "user-C";
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit({
        scope: "whatsappBoletoOcr",
        userId,
        route: "whatsapp/boleto-ocr-image",
        failMode: "closed",
      });
    }
    // 11ª imediata → bloqueada
    const blocked = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(blocked?.status).toBe(429);

    // Avança o relógio 1h + 1s: todos os 11 eventos ficam fora da janela deslizante
    nowMs += 3601 * 1000;
    const allowedAgain = await enforceUserRateLimit({
      scope: "whatsappBoletoOcr",
      userId,
      route: "whatsapp/boleto-ocr-image",
      failMode: "closed",
    });
    expect(allowedAgain).toBeNull();
  });

  it("concorrência: 20 chamadas paralelas nunca autorizam mais que 10", async () => {
    const userId = "user-D";
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
    expect(allowed).toBeLessThanOrEqual(10);
    expect(allowed + blocked).toBe(20);
    // Sob a implementação atual (contar-depois-inserir) pode haver janela
    // de corrida; o contrato mínimo é: sob concorrência, o número de
    // liberadas não excede 10. Registrado como observação P1 caso allowed<10
    // (comportamento seguro / conservador).
  });

  it("checkRateLimit direto: 10ª chamada retorna blocked=false, 11ª retorna blocked=true", async () => {
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
});
