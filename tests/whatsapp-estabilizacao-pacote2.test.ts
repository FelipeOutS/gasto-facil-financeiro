import { describe, it, expect } from "bun:test";
import { readBodyLimited, downloadWhatsappMediaBounded, fetchWithTimeout, BoundedFetchError } from "@/server/whatsapp-bounded-fetch.server";
import { classifySendResult, deliverReplyWithRetry } from "@/server/whatsapp-reply-delivery.server";

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
  const args = { lookupUrl: "https://graph.invalid/m", token: "t", maxBytes: 100 };
  it("foto/áudio/PDF dentro do limite → ok com mime da Meta", async () => {
    const f = mk(Response.json({ url: "https://cdn.invalid/f", mime_type: "Application/PDF" }), new Response(new Uint8Array(40)));
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: f });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.buffer.byteLength).toBe(40); expect(r.declaredMime).toBe("application/pdf"); }
  });
  it("lookup 404 → http_error", async () => {
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: mk(new Response("no", { status: 404 })) });
    expect(r).toEqual({ ok: false, reason: "http_error" });
  });
  it("download 503 → http_error", async () => {
    const f = mk(Response.json({ url: "https://cdn.invalid/f" }), new Response("x", { status: 503 }));
    expect(await downloadWhatsappMediaBounded(args, { fetchImpl: f })).toEqual({ ok: false, reason: "http_error" });
  });
  it("arquivo grande demais → oversized", async () => {
    const f = mk(Response.json({ url: "https://cdn.invalid/f" }), new Response(streamOf([], { infinite: true })));
    expect(await downloadWhatsappMediaBounded(args, { fetchImpl: f })).toEqual({ ok: false, reason: "oversized" });
  });
  it("lookup sem url https → invalid", async () => {
    const r = await downloadWhatsappMediaBounded(args, { fetchImpl: mk(Response.json({ url: "http://x" })) });
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("A — entrega da resposta sem reprocessar", () => {
  const noSleep = { sleep: async () => {} };
  it("classificação", () => {
    expect(classifySendResult({ sent: true, status: 200 })).toBe("accepted");
    expect(classifySendResult({ sent: false, status: 503 })).toBe("transient");
    expect(classifySendResult({ sent: false, status: 429 })).toBe("transient");
    expect(classifySendResult({ sent: false, status: 400 })).toBe("permanent");
    expect(classifySendResult({ sent: false, reason: "not_configured" })).toBe("permanent");
    expect(classifySendResult({ sent: false, reason: "TimeoutError" })).toBe("ambiguous");
  });
  it("falha temporária → 1 novo envio da MESMA resposta", async () => {
    const calls: string[] = [];
    const seq = [{ sent: false, status: 503 }, { sent: true, status: 200 }];
    const d = await deliverReplyWithRetry(async () => { calls.push("send"); return seq[calls.length - 1]; }, noSleep);
    expect(d).toEqual({ outcome: "accepted", attempts: 2 });
  });
  it("timeout ambíguo → NÃO reenvia", async () => {
    let n = 0;
    const d = await deliverReplyWithRetry(async () => { n++; return { sent: false, reason: "TimeoutError" }; }, noSleep);
    expect(n).toBe(1);
    expect(d.outcome).toBe("ambiguous");
  });
  it("falha permanente → NÃO reenvia", async () => {
    let n = 0;
    await deliverReplyWithRetry(async () => { n++; return { sent: false, status: 400 }; }, noSleep);
    expect(n).toBe(1);
  });
  it("temporária persistente → no máximo 2 tentativas", async () => {
    let n = 0;
    const d = await deliverReplyWithRetry(async () => { n++; return { sent: false, status: 500 }; }, noSleep);
    expect(n).toBe(2);
    expect(d.outcome).toBe("transient");
  });
  it("exceção no envio vira ambíguo, sem relançar", async () => {
    const d = await deliverReplyWithRetry(async () => { throw new TypeError("net"); }, noSleep);
    expect(d.outcome).toBe("ambiguous");
  });
});
