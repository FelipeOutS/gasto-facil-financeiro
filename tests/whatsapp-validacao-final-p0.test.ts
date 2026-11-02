import { describe, it, expect } from "bun:test";
import { deliverReplyPlan, type SendResult } from "@/server/whatsapp-reply-delivery.server";

// Validação final P0: matriz de respostas da Meta × canais. Nenhum resultado
// incerto pode gerar segunda mensagem; só recusa explícita (4xx ≠ 429) cai p/ texto.
const cenarios: Array<[string, () => Promise<SendResult>, "accepted" | "permanent" | "ambiguous"]> = [
  ["HTTP 200", async () => ({ sent: true, status: 200 }), "accepted"],
  ["HTTP 400", async () => ({ sent: false, status: 400 }), "permanent"],
  ["HTTP 429", async () => ({ sent: false, status: 429 }), "ambiguous"],
  ["HTTP 500", async () => ({ sent: false, status: 500 }), "ambiguous"],
  ["HTTP 503", async () => ({ sent: false, status: 503 }), "ambiguous"],
  ["timeout", async () => ({ sent: false, reason: "TimeoutError" }), "ambiguous"],
  ["erro de rede", async () => { throw new TypeError("fetch failed"); }, "ambiguous"],
];

for (const canal of ["link do Pix (CTA)", "Flow do cartão", "botões Confirmar/Ajustar/Cancelar"]) {
  describe(`P0 — ${canal}`, () => {
    for (const [nome, send, classe] of cenarios) {
      it(`${nome}: no máximo uma mensagem visível`, async () => {
        let interativos = 0;
        let textos = 0;
        await deliverReplyPlan(
          async () => { interativos++; return send(); },
          async () => { textos++; return { sent: true, status: 200 }; },
        );
        expect(interativos).toBe(1);
        expect(textos).toBe(classe === "permanent" ? 1 : 0);
      });
    }
  });
}

describe("P0 — só texto", () => {
  for (const [nome, send, classe] of cenarios) {
    it(`${nome}: texto enviado exatamente uma vez`, async () => {
      let textos = 0;
      const r = await deliverReplyPlan(null, async () => { textos++; return send(); });
      expect(textos).toBe(1);
      expect(r.outcome).toBe(classe);
    });
  }
  it("HTTP 2xx é só 'accepted' (aceite da Meta), nunca 'delivered'", async () => {
    const r = await deliverReplyPlan(null, async () => ({ sent: true, status: 200 }));
    expect(r.outcome).toBe("accepted");
  });
});
