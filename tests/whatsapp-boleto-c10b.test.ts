/**
 * WA-C10.b — Testes determinísticos para entrada de boleto via mídia
 * (imagem/PDF). Cobre:
 *  - validação de PDF (magic bytes, tamanho, contagem de páginas);
 *  - pipeline OCR com extractor mockado (sem rede);
 *  - decisão entre 0/1/N candidatos válidos;
 *  - rejeição quando OCR erra um dígito (DV inválido).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const {
  validateDownloadedPdf,
  detectPdfFromBytes,
  estimatePdfPageCount,
  MAX_PDF_BYTES,
} = await import("../src/server/whatsapp-pdf-validation.server");

const {
  extractBoletoFromMedia,
  __setBoletoOcrExtractorForTests,
} = await import("../src/server/whatsapp-boleto-ocr.server");

const {
  _buildBoletoCobrancaForTest,
  _buildBoletoArrecadForTest,
} = await import("../src/server/whatsapp-boleto-parser");

const { __setBoletoPepperForTest, __resetBoletoPepperCacheForTest } = await import(
  "../src/server/whatsapp-boleto-secret.server"
);

beforeEach(() => {
  __setBoletoPepperForTest("test-pepper-c10b");
});
afterEach(() => {
  __setBoletoOcrExtractorForTests(null);
  __setBoletoPepperForTest(null);
  __resetBoletoPepperCacheForTest();
});

// ---------- PDF validation ----------

describe("WA-C10.b — validateDownloadedPdf", () => {
  it("aceita um PDF mínimo válido com magic bytes %PDF-", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n/Type /Page\n%%EOF");
    const r = validateDownloadedPdf(pdf, "application/pdf");
    expect(r.ok).toBe(true);
  });

  it("rejeita arquivo vazio", () => {
    expect(validateDownloadedPdf(new Uint8Array(0)).ok).toBe(false);
  });

  it("rejeita bytes que não começam com %PDF-", () => {
    const r = validateDownloadedPdf(new TextEncoder().encode("\x89PNG\r\nfake-pdf"));
    expect(r).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("rejeita mime declarado diferente de application/pdf", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n");
    const r = validateDownloadedPdf(pdf, "image/jpeg");
    expect(r).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("rejeita arquivos acima do limite", () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const r = validateDownloadedPdf(big);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejeita PDFs com muitas páginas detectáveis", () => {
    const body = "%PDF-1.4\n" + "/Type /Page\n".repeat(15) + "%%EOF";
    const r = validateDownloadedPdf(new TextEncoder().encode(body), "application/pdf");
    expect(r).toEqual({ ok: false, reason: "too_many_pages" });
  });

  it("estima contagem de páginas via /Type /Page", () => {
    const body = "%PDF-1.4\n/Type /Page\n/Type /Page\n/Type /Page\n";
    expect(estimatePdfPageCount(new TextEncoder().encode(body))).toBe(3);
  });

  it("estima contagem via /Count em /Pages quando /Type /Page está ofuscado", () => {
    const body = "%PDF-1.4\n/Pages 2 0 R\n2 0 obj << /Type /Pages /Count 5 >> endobj";
    expect(estimatePdfPageCount(new TextEncoder().encode(body))).toBe(5);
  });

  it("detectPdfFromBytes ignora bytes além do header", () => {
    expect(detectPdfFromBytes(new TextEncoder().encode("not at start %PDF-"))).toBe(false);
  });
});

// ---------- OCR pipeline ----------

describe("WA-C10.b — extractBoletoFromMedia", () => {
  const imgInput = {
    kind: "image" as const,
    dataUrl: "data:image/jpeg;base64,AAAA",
    mimeType: "image/jpeg" as const,
  };
  const pdfInput = {
    kind: "pdf" as const,
    dataUrl: "data:application/pdf;base64,AAAA",
  };

  it("retorna candidato único válido quando OCR devolve linha correta (cobrança)", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 15000, fator: 9999 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: 15000,
      vencimentoISO: null,
      identificacao: "Internet",
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0].valorCentavos).toBe(15000);
    expect(r.sugestoes.identificacao).toBe("Internet");
    expect(r.sourceType).toBe("image");
  });

  it("aceita PDF e usa sourceType=pdf", async () => {
    const { barcode } = _buildBoletoCobrancaForTest({});
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [barcode],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(pdfInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos.length).toBe(1);
    expect(r.sourceType).toBe("pdf");
  });

  it("aceita boleto de arrecadação válido", async () => {
    const { linha } = _buildBoletoArrecadForTest({});
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos[0].tipo).toBe("arrecadacao");
  });

  it("rejeita candidato com 1 dígito errado (DV inválido)", async () => {
    const { linha } = _buildBoletoCobrancaForTest({});
    // Troca um dígito do meio para invalidar o DV mod10/mod11.
    const corrompida = linha.slice(0, 20) + (linha[20] === "9" ? "0" : "9") + linha.slice(21);
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [corrompida],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(0);
  });

  it("retorna zero candidatos quando OCR não acha nada plausível", async () => {
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: ["12345", "esse aqui não é boleto"],
      valorCentavos: 5000,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(0);
    expect(r.sugestoes.valorCentavos).toBe(5000);
  });

  it("deduplica candidatos pelo fingerprint", async () => {
    const a = _buildBoletoCobrancaForTest({ valorCentavos: 1000, fator: 9000 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [a.linha, a.barcode, a.linha], // mesma origem, formatos diferentes
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(1);
  });

  it("retorna múltiplos candidatos quando há boletos distintos no documento", async () => {
    const a = _buildBoletoCobrancaForTest({ valorCentavos: 1000, fator: 9000, livre: "1111111111111111111111111" });
    const b = _buildBoletoCobrancaForTest({ valorCentavos: 2000, fator: 9001, livre: "2222222222222222222222222" });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [a.linha, b.linha],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(2);
    expect(r.candidatos[0].fingerprint).not.toBe(r.candidatos[1].fingerprint);
  });

  it("propaga erros do gateway via ok=false sem expor dados", async () => {
    __setBoletoOcrExtractorForTests(async () => ({ error: "rate_limited" } as const));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("rate_limited");
  });

  it("normaliza candidatos com separadores", async () => {
    const { linha } = _buildBoletoCobrancaForTest({});
    const formatada = `${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10, 21)} ${linha.slice(21)}`;
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [formatada],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const r = await extractBoletoFromMedia(imgInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidatos).toHaveLength(1);
  });
});
