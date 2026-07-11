/**
 * WA-C10.3 — Roteamento determinístico boleto vs comprovante para imagens.
 *
 * Regressão do defeito observado no WA-3.35:
 *   Uma fixture de boleto enviada como PNG entrou no fluxo de boleto; a
 *   mesma fixture, transcodificada pela Meta para JPEG, foi classificada
 *   como `imagem_comprovante`. A causa foi que o branch de imagem em
 *   whatsapp.server.ts não replicava o `iniciarBoletoManualFallback` do
 *   branch de PDF quando o OCR retornava valor/vencimento sem candidato
 *   validado (DV inválido pela compressão JPEG).
 *
 * O contrato passa a ser:
 *   1. OCR de boleto executa uma única vez.
 *   2. Se algum candidato passa `tryParseBoleto` → boleto (com código).
 *   3. Se OCR extrai valor ou vencimento (mesmo sem candidato validado)
 *      → boleto manual (sem código copiável).
 *   4. Só quando OCR não devolve NADA util (candidatos vazios + sem
 *      valor + sem vencimento) o classificador de comprovante pode agir.
 *   5. MIME (image/png vs image/jpeg) NUNCA decide o roteamento sozinho.
 *   6. Nenhuma escrita financeira antes da confirmação.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { _buildBoletoCobrancaForTest } = await import("../src/server/whatsapp-boleto-parser");
const { __setBoletoOcrExtractorForTests } = await import("../src/server/whatsapp-boleto-ocr.server");
const { __setBoletoPepperForTest, __resetBoletoPepperCacheForTest } = await import(
  "../src/server/whatsapp-boleto-secret.server"
);
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
// Base64 diferente para simular transcodificação PNG→JPEG pela Meta
// (mesmo boleto conceitual, bytes distintos).
const JPEG_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function imgMsg(opts: {
  externalId?: string;
  mime?: "image/png" | "image/jpeg";
  sha256?: string;
  caption?: string;
} = {}) {
  const dataUrl = opts.mime === "image/jpeg" ? JPEG_DATA_URL : PNG_DATA_URL;
  return {
    external_id: opts.externalId ?? `m-${Math.random().toString(36).slice(2, 10)}`,
    telefone: "5511999998888",
    texto: opts.caption ?? "",
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
    image: {
      base64: dataUrl,
      mimeType: opts.mime ?? "image/png",
      sha256: opts.sha256,
    },
  } as const;
}

beforeEach(() => {
  resetState();
  __setBoletoPepperForTest("test-pepper-wa-c10-3");
});
afterEach(() => {
  resetState();
  __setBoletoOcrExtractorForTests(null);
  __setBoletoPepperForTest(null);
  __resetBoletoPepperCacheForTest();
});

describe("WA-C10.3 — roteamento determinístico boleto/comprovante em imagens", () => {
  it("PNG com linha digitável válida → kind=boleto", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 34789, fator: 1539 });
    let calls = 0;
    __setBoletoOcrExtractorForTests(async () => {
      calls++;
      return {
        candidatos: [linha],
        valorCentavos: 34789,
        vencimentoISO: "2026-08-15",
        identificacao: null,
      };
    });
    const out = await processarMensagemWhatsApp(imgMsg({ mime: "image/png", sha256: "png-sha" }));
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/boleto|conta|R\$/i);
    expect(calls).toBe(1); // uma única chamada ao extrator
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("JPEG equivalente com linha válida → também kind=boleto (MIME não decide)", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 34789, fator: 1539 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: 34789,
      vencimentoISO: "2026-08-15",
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(imgMsg({ mime: "image/jpeg", sha256: "jpg-sha" }));
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/boleto|conta|R\$/i);
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("JPEG transcodificado sem DV válido mas com valor + vencimento → boleto manual (não vira comprovante)", async () => {
    // Cenário exato do WA-3.35: transcodificação JPEG borra dígitos,
    // tryParseBoleto rejeita, mas Gemini ainda extrai valor/vencimento.
    let calls = 0;
    __setBoletoOcrExtractorForTests(async () => {
      calls++;
      return {
        candidatos: [], // DV falhou
        valorCentavos: 34789,
        vencimentoISO: "2026-08-15",
        identificacao: "Energia",
      };
    });
    const out = await processarMensagemWhatsApp(imgMsg({ mime: "image/jpeg", sha256: "jpg-sha-2" }));
    expect(out.status).toBe("pendente");
    // Deve ser a mensagem do fallback manual de BOLETO, não a de comprovante.
    expect(out.resposta).toMatch(/não consegui validar a linha digitável/i);
    expect(out.resposta).toMatch(/Confirmar/i);
    // Uma única chamada ao Gemini (sem cair no OCR de comprovante).
    expect(calls).toBe(1);
    // Nenhuma escrita financeira antes da confirmação.
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
    expect(state.inserts.filter((i) => i.table === "gastos")).toHaveLength(0);
    // Código completo NUNCA aparece.
    expect(out.resposta ?? "").not.toMatch(/\d{47,48}/);
  });

  it("imagem sem candidatos e sem sugestões → cai em comprovante (com nova chamada IA legítima)", async () => {
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(imgMsg({ mime: "image/jpeg", sha256: "no-boleto" }));
    // Aceita qualquer estado válido do fluxo de comprovante (ilegível,
    // aguardando_confirmacao, etc.), mas nunca cria conta a pagar.
    expect(out).toBeDefined();
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("linha com dígitos inválidos (DV quebrado) e sem valor/vencimento → não força boleto", async () => {
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: ["00000000000000000000000000000000000000000000000"],
      valorCentavos: null,
      vencimentoISO: null,
      identificacao: null,
    }));
    const out = await processarMensagemWhatsApp(imgMsg({ mime: "image/png", sha256: "bad-dv" }));
    // Sem sugestões e com DV inválido, cai no fluxo de comprovante.
    // O importante é NÃO criar conta a pagar / gasto silenciosamente.
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
    expect(out).toBeDefined();
  });

  it("determinismo: 20 envios equivalentes com o mesmo OCR sempre roteiam para boleto", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 34789, fator: 1539 });
    __setBoletoOcrExtractorForTests(async () => ({
      candidatos: [linha],
      valorCentavos: 34789,
      vencimentoISO: "2026-08-15",
      identificacao: null,
    }));
    for (let i = 0; i < 20; i++) {
      resetState();
      const out = await processarMensagemWhatsApp(
        imgMsg({
          externalId: `det-${i}`,
          mime: i % 2 === 0 ? "image/png" : "image/jpeg",
          sha256: `det-sha-${i}`,
        }),
      );
      expect(out.status).toBe("pendente");
      expect(state.inserts.filter((x) => x.table === "contas_a_pagar")).toHaveLength(0);
    }
  });
});
