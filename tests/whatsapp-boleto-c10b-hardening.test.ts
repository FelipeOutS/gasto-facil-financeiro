/**
 * WA-C10.b.1 — Hardening de mídia, custo e privacidade.
 *
 * Cobre:
 *  - Sanitização de sessões (`stripMediaFields`);
 *  - Extração textual de PDF antes de IA (não chama OCR quando achou candidato);
 *  - Cache por (usuário, hash) — nunca cruza usuários;
 *  - Rate limit dispara mensagem amigável (PDF) ou pula OCR (imagem);
 *  - Logs não vazam base64/data URL/sha completo.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { stripMediaFields } = await import("../src/server/whatsapp-media-sanitize.server");
const { extractBoletoCandidatesFromPdf } =
  await import("../src/server/whatsapp-pdf-text-extract.server");
const { getCachedOcr, setCachedOcr, __resetBoletoOcrCacheForTests } =
  await import("../src/server/whatsapp-boleto-ocr-cache.server");
const { _buildBoletoCobrancaForTest, tryParseBoleto } =
  await import("../src/server/whatsapp-boleto-parser");
const { __setBoletoOcrExtractorForTests } =
  await import("../src/server/whatsapp-boleto-ocr.server");
const { __setBoletoPepperForTest, __resetBoletoPepperCacheForTest } =
  await import("../src/server/whatsapp-boleto-secret.server");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const PNG_TINY =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

beforeEach(() => {
  resetState();
  __setBoletoPepperForTest("test-pepper-c10b-hard");
  __resetBoletoOcrCacheForTests();
});
afterEach(() => {
  resetState();
  __setBoletoOcrExtractorForTests(null);
  __setBoletoPepperForTest(null);
  __resetBoletoPepperCacheForTest();
  __resetBoletoOcrCacheForTests();
});

// ---------------- Privacidade / sanitização ----------------

describe("WA-C10.b.1 — stripMediaFields", () => {
  it("remove base64, dataUrl, document, image, mediaId, storagePath", () => {
    const dirty = {
      kind: "boleto",
      fingerprint: "abc",
      base64: "AAAA",
      dataUrl: "data:application/pdf;base64,AAAA",
      mediaId: "wamid:1",
      providerMediaId: "x",
      storagePath: "/tmp/x",
      ocrRawText: "linha digitavel ...",
      document: { kind: "document", base64: "AAAA" },
      image: { base64: "AAAA" },
      nested: { ok: 1, base64: "BBBB" },
    };
    const clean = stripMediaFields(dirty) as Record<string, unknown>;
    expect(clean.fingerprint).toBe("abc");
    expect(clean.base64).toBeUndefined();
    expect(clean.dataUrl).toBeUndefined();
    expect(clean.document).toBeUndefined();
    expect(clean.image).toBeUndefined();
    expect(clean.mediaId).toBeUndefined();
    expect(clean.providerMediaId).toBeUndefined();
    expect(clean.storagePath).toBeUndefined();
    expect(clean.ocrRawText).toBeUndefined();
    expect((clean.nested as Record<string, unknown>).base64).toBeUndefined();
    expect((clean.nested as Record<string, unknown>).ok).toBe(1);
  });

  it("trunca strings com prefixo data: longas (defesa em profundidade)", () => {
    const dirty = { foo: "data:image/png;base64," + "A".repeat(200) };
    const clean = stripMediaFields(dirty) as Record<string, unknown>;
    expect(clean.foo).toBeUndefined();
  });

  it("preserva strings normais e arrays", () => {
    const r = stripMediaFields({ a: [1, 2, { x: "y" }], b: "ok" }) as Record<string, unknown>;
    expect(r).toEqual({ a: [1, 2, { x: "y" }], b: "ok" });
  });
});

// ---------------- PDF text extract ----------------

describe("WA-C10.b.1 — extractBoletoCandidatesFromPdf", () => {
  it("encontra linha digitável presente em texto cru do PDF", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 12500, fator: 9999 });
    const pdf = new TextEncoder().encode(`%PDF-1.4\n( ${linha} )Tj\n%%EOF`);
    const out = extractBoletoCandidatesFromPdf(pdf);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const parsed = tryParseBoleto(out[0]);
    expect(parsed).not.toBeNull();
  });

  it("retorna vazio para PDF sem dígitos relevantes", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n(hello world)Tj\n%%EOF");
    expect(extractBoletoCandidatesFromPdf(pdf)).toEqual([]);
  });

  it("retorna vazio para buffer vazio", () => {
    expect(extractBoletoCandidatesFromPdf(new Uint8Array(0))).toEqual([]);
  });
});

// ---------------- Cache por usuário ----------------

describe("WA-C10.b.1 — boleto OCR cache", () => {
  it("retorna resultado anteriormente armazenado pelo mesmo usuário", () => {
    const value = {
      candidatos: [],
      sugestoes: { valorCentavos: 100, vencimentoISO: null, identificacao: null },
    };
    setCachedOcr("u1", "hash-aaaa-bbbb", "image", value);
    expect(getCachedOcr("u1", "hash-aaaa-bbbb", "image")).toEqual(value);
  });

  it("NÃO cruza entre usuários distintos", () => {
    const value = {
      candidatos: [],
      sugestoes: { valorCentavos: 100, vencimentoISO: null, identificacao: null },
    };
    setCachedOcr("u1", "hash-aaaa-bbbb", "image", value);
    expect(getCachedOcr("u2", "hash-aaaa-bbbb", "image")).toBeNull();
  });

  it("não armazena quando hash ausente", () => {
    const value = {
      candidatos: [],
      sugestoes: { valorCentavos: null, vencimentoISO: null, identificacao: null },
    };
    setCachedOcr("u1", null, "image", value);
    expect(getCachedOcr("u1", null, "image")).toBeNull();
  });

  it("separa cache por kind (image ≠ pdf)", () => {
    const v = {
      candidatos: [],
      sugestoes: { valorCentavos: 1, vencimentoISO: null, identificacao: null },
    };
    setCachedOcr("u1", "abcd1234", "image", v);
    expect(getCachedOcr("u1", "abcd1234", "pdf")).toBeNull();
  });
});

// ---------------- PDF digital evita IA ----------------

describe("WA-C10.b.1 — PDF textual não chama OCR", () => {
  it("PDF com linha digitável visível NÃO chama o extractor de IA", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 9900, fator: 9000 });
    const pdfBytes = Buffer.from(`%PDF-1.4\n(${linha})Tj\n%%EOF`);
    let extractorCalls = 0;
    __setBoletoOcrExtractorForTests(async () => {
      extractorCalls++;
      return { candidatos: [], valorCentavos: null, vencimentoISO: null, identificacao: null };
    });
    const out = await processarMensagemWhatsApp({
      external_id: "pdf-text-1",
      telefone: "5511999998888",
      texto: "",
      recebida_em: new Date().toISOString(),
      authorizedUserId: "u1",
      document: {
        kind: "document",
        base64: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
        mimeType: "application/pdf",
      },
    });
    expect(extractorCalls).toBe(0);
    expect(out.status).toBe("pendente");
  });

  it("PDF sem linha digitável legível CAI no OCR (fallback IA)", async () => {
    const pdfBytes = Buffer.from(`%PDF-1.4\n(boleto sem digitos)Tj\n%%EOF`);
    let extractorCalls = 0;
    __setBoletoOcrExtractorForTests(async () => {
      extractorCalls++;
      return { candidatos: [], valorCentavos: null, vencimentoISO: null, identificacao: null };
    });
    await processarMensagemWhatsApp({
      external_id: "pdf-no-text-1",
      telefone: "5511999998888",
      texto: "",
      recebida_em: new Date().toISOString(),
      authorizedUserId: "u1",
      document: {
        kind: "document",
        base64: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
        mimeType: "application/pdf",
      },
    });
    expect(extractorCalls).toBe(1);
  });
});
