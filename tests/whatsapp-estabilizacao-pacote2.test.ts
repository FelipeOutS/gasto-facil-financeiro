import { describe, it, expect } from "bun:test";
import { readBodyLimited, downloadWhatsappMediaBounded, fetchWithTimeout, BoundedFetchError } from "@/server/whatsapp-bounded-fetch.server";
import { classifySendResult, deliverReplyWithRetry, deliverReplyPlan } from "@/server/whatsapp-reply-delivery.server";

const enc = new TextEncoder();
function streamOf(chunks: Uint8Array[], opts: { hang?: boolean; infinite?: boolean; errorAfter?: boolean } = {}) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (opts.infinite) { c.enqueue(new Uint8Array(1024)); return; }
      if (i < chunks.length) { c.enqueue(chunks[i++]); return; }
      if (opts.errorAfter) { c.error(new Error("reset")); return; }
      if (opts.hang) return new Promise(() => {});
      c.close();
    },
  });
}
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as BoundedFetchError).kind; } };

describe("C — leitura com limite durante o streaming", () => {
  it("corpo permitido é lido inteiro", async () => {
    const b = await readBodyLimited(new Response(streamOf([enc.encode("abc"), enc.encode("de")])), 10, 1000);
    expect(b.toString()).toBe("abcde");
  });
  it("corpo infinito sem Content-Length → oversized", async () => {
    expect(await kind(readBodyLimited(new Response(streamOf([], { infinite: true })), 10_000, 2000))).toBe("oversized");
  });
  it("Content-Length declarado acima do limite → oversized sem ler", async () => {
    const r = new Response("x", { headers: { "content-length": "999999" } });
    expect(await kind(readBodyLimited(r, 10, 1000))).toBe("oversized");
  });
  it("Content-Length falso (menor que o real) não engana o limite", async () => {
    const r = new Response(streamOf([new Uint8Array(50)]), { headers: { "content-length": "5" } });
    expect(await kind(readBodyLimited(r, 10, 1000))).toBe("oversized");
  });
  it("corpo pendurado → timeout", async () => {
    expect(await kind(readBodyLimited(new Response(streamOf([enc.encode("a")], { hang: true })), 100, 30))).toBe("timeout");
  });
  it("stream interrompido → network", async () => {
    expect(await kind(readBodyLimited(new Response(streamOf([enc.encode("a")], { errorAfter: true })), 100, 1000))).toBe("network");
  });
  it("corpo vazio → empty", async () => {
    expect(await kind(readBodyLimited(new Response(streamOf([])), 100, 1000))).toBe("empty");
  });
  it("conexão pendurada → timeout", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "TimeoutError" })));
    })) as unknown as typeof fetch;
    expect(await kind(fetchWithTimeout("https://x.invalid", {}, 20, hang))).toBe("timeout");
  });
});

describe("C — download de mídia Meta", () => {
  const mk = (lookup: Response, dl?: Response) => {
    let n = 0;
    return (async () => (n++ === 0 ? lookup : dl!)) as unknown as typeof fetch;
  };
  const args = { lookupUrl: "https://graph.facebook.com/v25.0/m", token: "t", maxBytes: 100 };
  it("foto/áudio/PDF dentro do limite → ok com mime da Meta", async () => {
    const f = mk(Response.json({ url: "https://lookaside.fbsbx.com/fixture", mime_type: "Application/PDF" }), new Response(new Uint8Array(40)));
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: f });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.buffer.byteLength).toBe(40); expect(r.declaredMime).toBe("application/pdf"); }
  });
  it("lookup 404 → http_error", async () => {
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: mk(new Response("no", { status: 404 })) });
    expect(r).toEqual({ ok: false, reason: "http_error" });
  });
  it("download 503 → http_error", async () => {
    const f = mk(Response.json({ url: "https://lookaside.fbsbx.com/fixture" }), new Response("x", { status: 503 }));
    expect(await downloadWhatsappMediaBounded(args, { fetchImpl: f })).toEqual({ ok: false, reason: "http_error" });
  });
  it("arquivo grande demais → oversized", async () => {
    const f = mk(Response.json({ url: "https://lookaside.fbsbx.com/fixture" }), new Response(streamOf([], { infinite: true })));
    expect(await downloadWhatsappMediaBounded(args, { fetchImpl: f })).toEqual({ ok: false, reason: "oversized" });
  });
  it("lookup sem url https → invalid", async () => {
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: mk(Response.json({ url: "http://x" })) });
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("A — entrega da resposta sem reprocessar (conservador)", () => {
  const noSleep = { sleep: async () => {} };
  it("classificação", () => {
    expect(classifySendResult({ sent: true, status: 200 })).toBe("accepted"); // só HTTP, não "entregue"
    expect(classifySendResult({ sent: false, status: 503 })).toBe("ambiguous");
    expect(classifySendResult({ sent: false, status: 500 })).toBe("ambiguous");
    expect(classifySendResult({ sent: false, status: 429 })).toBe("ambiguous");
    expect(classifySendResult({ sent: false, status: 400 })).toBe("permanent");
    expect(classifySendResult({ sent: false, reason: "not_configured" })).toBe("permanent");
    expect(classifySendResult({ sent: false, reason: "TimeoutError" })).toBe("ambiguous");
  });
  for (const st of [503, 500, 429]) {
    it(`HTTP ${st} → 1 tentativa, sem reenvio`, async () => {
      let n = 0;
      const d = await deliverReplyWithRetry(async () => { n++; return { sent: false, status: st }; }, noSleep);
      expect(n).toBe(1);
      expect(d.outcome).toBe("ambiguous");
    });
  }
  it("timeout ambíguo → NÃO reenvia", async () => {
    let n = 0;
    await deliverReplyWithRetry(async () => { n++; return { sent: false, reason: "TimeoutError" }; }, noSleep);
    expect(n).toBe(1);
  });
  it("falha permanente → NÃO reenvia", async () => {
    let n = 0;
    await deliverReplyWithRetry(async () => { n++; return { sent: false, status: 400 }; }, noSleep);
    expect(n).toBe(1);
  });
  it("exceção no envio vira ambíguo, sem relançar", async () => {
    const d = await deliverReplyWithRetry(async () => { throw new TypeError("net"); }, noSleep);
    expect(d.outcome).toBe("ambiguous");
  });
});

describe("A — interativo → texto (sem confirmação dupla)", () => {
  // Cobre os dois ramos do webhook: graphInteractive (Flow) e botões
  // Confirmar/Ajustar/Cancelar — ambos passam por deliverReplyPlan.
  for (const ramo of ["graphInteractive (Flow)", "botões Confirmar/Ajustar/Cancelar"]) {
    it(`${ramo}: exceção de rede no interativo → texto NÃO é enviado`, async () => {
      let textCalls = 0;
      const r = await deliverReplyPlan(async () => { throw new TypeError("fetch failed"); }, async () => { textCalls++; return { sent: true, status: 200 }; });
      expect(textCalls).toBe(0);
      expect(r).toEqual({ outcome: "ambiguous", channel: "interactive", textAttempted: false });
    });
    it(`${ramo}: 5xx no interativo → texto NÃO é enviado`, async () => {
      let textCalls = 0;
      await deliverReplyPlan(async () => ({ sent: false, status: 502 }), async () => { textCalls++; return { sent: true }; });
      expect(textCalls).toBe(0);
    });
    it(`${ramo}: HTTP 400 (recusa explícita) → fallback em texto, 1 vez`, async () => {
      let textCalls = 0;
      const r = await deliverReplyPlan(async () => ({ sent: false, status: 400 }), async () => { textCalls++; return { sent: true, status: 200 }; });
      expect(textCalls).toBe(1);
      expect(r.outcome).toBe("accepted");
      expect(r.channel).toBe("text");
    });
  }
  it("interativo aceito → texto não é enviado", async () => {
    let textCalls = 0;
    await deliverReplyPlan(async () => ({ sent: true, status: 200 }), async () => { textCalls++; return { sent: true }; });
    expect(textCalls).toBe(0);
  });
  it("sem interativo → texto 1 vez", async () => {
    let textCalls = 0;
    await deliverReplyPlan(null, async () => { textCalls++; return { sent: true }; });
    expect(textCalls).toBe(1);
  });
});
