/**
 * WA-C11 Fase 3B.2.E — Parser de opt-out incondicional.
 */
import { describe, it, expect } from "vitest";
import {
  detectOptout,
  normalizeOptoutInput,
  buildOptoutAudit,
  executeOptoutRevocation,
  OPTOUT_FALSE_POSITIVES,
} from "@/server/whatsapp-optout.server";

describe("WA-C11 3B.2.E — detectOptout: comandos determinísticos", () => {
  const positives = [
    "parar",
    "PARAR",
    "  parar  ",
    "parar.",
    "sair",
    "descadastrar",
    "STOP",
    "unsubscribe",
    "parar de receber",
    "parar de receber mensagens",
    "não quero mais",
    "Não Quero Mais Mensagens",
    "remover whatsapp",
    "sair do whatsapp",
  ];
  for (const t of positives) {
    it(`é opt-out: ${JSON.stringify(t)}`, () => {
      const r = detectOptout(t);
      expect(r.isOptout).toBe(true);
      expect(r.matchedCommand).not.toBeNull();
    });
  }
});

describe("WA-C11 3B.2.E — falso-positivos financeiros NUNCA são opt-out", () => {
  for (const t of OPTOUT_FALSE_POSITIVES) {
    it(`NÃO é opt-out: ${JSON.stringify(t)}`, () => {
      expect(detectOptout(t).isOptout).toBe(false);
    });
  }
  it("mensagem com 'parar' no meio de frase não dispara opt-out", () => {
    expect(detectOptout("preciso parar de gastar tanto").isOptout).toBe(false);
    expect(detectOptout("parar pagamento do boleto 123").isOptout).toBe(false);
  });
  it("mensagem com 'cancelar' composta com objeto financeiro não dispara opt-out", () => {
    expect(detectOptout("cancelar conta de luz").isOptout).toBe(false);
    expect(detectOptout("cancelar boleto do banco").isOptout).toBe(false);
  });
  it("'cancelar' standalone é reset in-flight, não opt-out (E.1)", () => {
    expect(detectOptout("cancelar").isOptout).toBe(false);
    expect(detectOptout("CANCELAR").isOptout).toBe(false);
    expect(detectOptout("cancelar!").isOptout).toBe(false);
  });
});

describe("WA-C11 3B.2.E — normalizeOptoutInput", () => {
  it("remove diacríticos e pontuação de borda", () => {
    expect(normalizeOptoutInput("  Não Quero Mais! ")).toBe("nao quero mais");
  });
  it("colapsa whitespace interno", () => {
    expect(normalizeOptoutInput("parar    de   receber")).toBe("parar de receber");
  });
  it("entradas não-string retornam vazio", () => {
    // @ts-expect-error força tipo
    expect(normalizeOptoutInput(undefined)).toBe("");
  });
});

describe("WA-C11 3B.2.E — buildOptoutAudit sanitiza", () => {
  it("nunca inclui telefone ou texto original", () => {
    const a = buildOptoutAudit({
      userId: "user-123",
      origin: "whatsapp",
      matchedCommand: "parar",
      previousActive: true,
      pendingInvalidated: 3,
      correlationId: "corr-1",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const s = JSON.stringify(a);
    expect(s).not.toContain("user-123");
    expect(a.userIdHash).toMatch(/^h[0-9a-f]{8}$/);
    expect(a.action).toBe("revoke_consent");
    expect(a.newActive).toBe(false);
    expect(a.pendingInvalidated).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// executeOptoutRevocation — usando fake client injetado

type Row = { id: string; ativo: boolean; revogado_em: string | null };
function makeFakeClient(initialLinks: Row[], initialPending: string[]) {
  const links = [...initialLinks];
  const pending = new Set(initialPending);
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      if (table === "whatsapp_links") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: links, error: null }),
          }),
          update: (patch: Partial<Row>) => ({
            eq: (_k: string, _v: string) => ({
              is: () => {
                for (const l of links) {
                  if (l.revogado_em === null) Object.assign(l, patch);
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "whatsapp_notifications") {
        return {
          update: () => ({
            eq: (_k1: string, _v1: string) => ({
              eq: (_k2: string, _v2: string) => ({
                is: () => ({
                  select: () => {
                    const cancelled = Array.from(pending).map((id) => ({ id }));
                    pending.clear();
                    return Promise.resolve({ data: cancelled, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    _state: { links, pending, calls },
  };
  return client;
}

describe("WA-C11 3B.2.E — executeOptoutRevocation", () => {
  it("revoga vínculo ativo e cancela pending sem attempt", async () => {
    const c = makeFakeClient(
      [{ id: "l1", ativo: true, revogado_em: null }],
      ["n1", "n2"],
    );
    const r = await executeOptoutRevocation({
      userId: "u1",
      origin: "whatsapp",
      matchedCommand: "parar",
      correlationId: "c1",
      client: c,
    });
    expect(r.ok).toBe(true);
    expect(r.audit?.previousActive).toBe(true);
    expect(r.audit?.pendingInvalidated).toBe(2);
    expect(c._state.links[0].ativo).toBe(false);
    expect(c._state.links[0].revogado_em).not.toBeNull();
  });

  it("é idempotente quando nada estava ativo", async () => {
    const c = makeFakeClient(
      [{ id: "l1", ativo: false, revogado_em: "2025-01-01T00:00:00Z" }],
      [],
    );
    const r = await executeOptoutRevocation({
      userId: "u1",
      origin: "whatsapp",
      matchedCommand: "stop",
      correlationId: "c1",
      client: c,
    });
    expect(r.ok).toBe(true);
    expect(r.audit?.previousActive).toBe(false);
  });
});
