/**
 * WA-C10.b — Integração do fluxo de boleto via mídia (imagem/PDF) com
 * o pipeline principal do WhatsApp.
 *
 * Cobre:
 *  - imagem com 1 candidato válido → mesmo fluxo da WA-C10.a;
 *  - PDF com 1 candidato válido → idem;
 *  - múltiplos candidatos → sessão de seleção;
 *  - apenas sugestões (sem candidato validado) → fallback manual;
 *  - OCR vazio em imagem → cai no fluxo de comprovante (não vira boleto);
 *  - documento sem magic-bytes %PDF- é rejeitado.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { _buildBoletoCobrancaForTest } = await import("../src/server/whatsapp-boleto-parser");
const { __setBoletoOcrExtractorForTests } =
  await import("../src/server/whatsapp-boleto-ocr.server");
const { __setBoletoPepperForTest, __resetBoletoPepperCacheForTest } =
  await import("../src/server/whatsapp-boleto-secret.server");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%%EOF").toString("base64")}`;
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function imgMsg(externalId = `m-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto: "",
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
    image: { base64: PNG_DATA_URL, mimeType: "image/png", sha256: undefined },
  } as const;
}
function pdfMsg(externalId = `m-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto: "",
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
    document: {
      kind: "document" as const,
      base64: PDF_DATA_URL,
      mimeType: "application/pdf" as const,
      sha256: undefined,
    },
  } as const;
}
function textMsg(texto: string, externalId = `m-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

beforeEach(() => {
  resetState();
  __setBoletoPepperForTest("test-pepper-c10b-int");
});
afterEach(() => {
  resetState();
  __setBoletoOcrExtractorForTests(null);
  __setBoletoPepperForTest(null);
  __resetBoletoPepperCacheForTest();
});

describe("WA-C10.b — integração mídia → fluxo de boleto", () => {
  it("imagem com 1 candidato válido entra no fluxo de boleto (sem criar conta automática)", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 12500, fator: 9000 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: 12500,
      vencimentoISO: null,
      identificacao: "Internet",
    }));
    const out = await processarMensagemWhatsApp(imgMsg());
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/Internet|conta|boleto/i);
    // Não cria conta no banco antes da confirmação:
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("PDF com 1 candidato válido entra no fluxo de boleto", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 9000, fator: 9500 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: 9000,
      vencimentoISO: null,
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(pdfMsg());
    expect(out.status).toBe("pendente");
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("múltiplos candidatos abre sessão de seleção", async () => {
    const a = _buildBoletoCobrancaForTest({
      valorCentavos: 1000,
      fator: 9000,
      livre: "1".repeat(25),
    });
    const b = _buildBoletoCobrancaForTest({
      valorCentavos: 2000,
      fator: 9001,
      livre: "2".repeat(25),
    });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [a.linha, b.linha],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(pdfMsg());
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/mais de um boleto/i);
    expect(out.resposta).toMatch(/Nenhum deles/);
  });

  it("apenas sugestão de valor/vencimento → fallback manual (sem candidatos validados)", async () => {
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [],
      valorCentavos: 5599,
      vencimentoISO: "2099-12-31",
      identificacao: "Condomínio",
    }));
    const out = await processarMensagemWhatsApp(pdfMsg());
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/não consegui validar a linha digitável/i);
    expect(out.resposta).toMatch(/Condomínio|Confirmar/);
  });

  it("PDF sem magic bytes %PDF- é rejeitado", async () => {
    // Falsifica magic bytes: data URL com mime correto, mas conteúdo NÃO-PDF.
    const fake = {
      ...pdfMsg(),
      document: {
        kind: "document" as const,
        base64: "data:application/pdf;base64," + Buffer.from("not a pdf at all").toString("base64"),
        mimeType: "application/pdf" as const,
        sha256: undefined,
      },
    } as const;
    const out = await processarMensagemWhatsApp(fake);
    expect(out.status).toBe("erro");
    expect(out.resposta).toMatch(/PDF/i);
  });

  it("OCR sem candidato em imagem cai no fluxo de comprovante (não vira boleto)", async () => {
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(imgMsg());
    // O caminho de comprovante deve responder (qualquer status válido do
    // pipeline de imagem); o importante é NÃO ter criado conta a pagar.
    expect(out).toBeDefined();
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("texto comum após mídia de boleto continua entrando como texto (sem mídia residual)", async () => {
    // Sanity check de não-vazamento: uma mensagem texto isolada nunca
    // chama o OCR de boleto, independentemente do extractor registrado.
    let extractorCalled = false;
    __setBoletoOcrExtractorForTests(async () => {
      extractorCalled = true;
      return { candidatos: [], valorCentavos: null, vencimentoISO: null, identificacao: null };
    });
    await processarMensagemWhatsApp(textMsg("oi"));
    expect(extractorCalled).toBe(false);
  });
});
