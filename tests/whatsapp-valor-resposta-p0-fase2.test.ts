/**
 * P0 FASE 2 — "1.950" em comprovante (reais) e boleto (centavos).
 * Somente fakes locais; nenhuma rede, nenhum banco real.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { parseValorRespostaReais, parseValorRespostaCentavos } = await import(
  "../src/lib/whatsapp-valor-resposta"
);
const { parseValor } = await import("../src/lib/whatsappParser");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { __setOcrExtractorForTests } = await import("../src/server/ocr-comprovante.server");
const { _buildBoletoArrecadForTest } = await import("../src/server/whatsapp-boleto-parser");

const nb = (s: string) => s.replace(/\u00a0/g, " ");

const CASOS: Array<[string, number | null]> = [
  ["1.950", 1950],
  ["R$ 1.950", 1950],
  ["1.950,00", 1950],
  ["1950", 1950],
  ["1950,00", 1950],
  ["12.500", 12500],
  ["12.500,50", 12500.5],
  ["12,50", 12.5],
  ["19.90", 19.9],
  ["950", 950],
  ["valor 1950", 1950],
  ["paguei R$ 1.950,00 ontem", 1950],
  ["0", null],
  ["-19", null],
  ["R$ -19", null],
  ["1.2.3", null],
  ["1,234", null],
  ["1.234,567", null],
  ["abc", null],
  ["", null],
  ["10/11", null],
  ["2 de 1.950", null],
  ["1950 ou 2000", null],
];

describe("parser de resposta — reais", () => {
  for (const [input, esperado] of CASOS) {
    it(`"${input}" → ${esperado}`, () => {
      expect(parseValorRespostaReais(input)).toBe(esperado);
    });
  }
});

describe("parser de resposta — centavos (boleto)", () => {
  for (const [input, esperado] of CASOS) {
    const cents = esperado === null ? null : Math.round(esperado * 100);
    it(`"${input}" → ${cents} centavos`, () => {
      expect(parseValorRespostaCentavos(input)).toBe(cents);
    });
  }
  it("1.950 → exatamente 195000 centavos, sem fator extra", () => {
    expect(parseValorRespostaCentavos("1.950")).toBe(195000);
    expect(parseValorRespostaCentavos("19.90")).toBe(1990);
  });
  it("linha digitável de 48 dígitos não vira valor", () => {
    const { linha } = _buildBoletoArrecadForTest({});
    expect(parseValorRespostaCentavos(linha)).toBeNull();
  });
});

describe("parser central P0 anterior continua igual", () => {
  it("1.950/12.500/12,50", () => {
    expect(parseValor("1.950")).toBe(1950);
    expect(parseValor("12.500")).toBe(12500);
    expect(parseValor("12,50")).toBe(12.5);
    expect(parseValor("1.2.3")).toBeNull();
  });
});

const tel = "5511999998888";
function img(seed: string) {
  return { base64: "data:image/jpeg;base64,/9j/AAAA", mimeType: "image/jpeg", sha256: seed.repeat(64).slice(0, 64) };
}
function mockOcr(valor: number | null, descricao = "Mercado") {
  __setOcrExtractorForTests(async () => ({
    ok: true,
    data: {
      valor,
      valoresEncontrados: valor ? [valor] : [],
      data: "2026-06-22",
      descricao,
      categoriaSugerida: "mercado",
      formaPagamento: "pix",
      confianca: "alta",
      observacao: null,
    },
  }));
}

describe("comprovante — fluxo até pré-gravação", () => {
  beforeEach(() => resetState());

  it("aguardando valor: '1.950' → resumo R$ 1.950,00, nada gravado", async () => {
    mockOcr(null, "iFood");
    await processarMensagemWhatsApp({ telefone: tel, texto: "", external_id: "p0-c1", image: img("a1") });
    expect(state.pendingRow?.status).toBe("img_aguardando_valor");
    const r = await processarMensagemWhatsApp({ telefone: tel, texto: "1.950", external_id: "p0-c1-v" });
    expect(nb(r.resposta)).toContain("R$ 1.950,00");
    expect(gastosInserts()).toHaveLength(0);
  });

  it("ajuste explícito 'valor 1.950' → R$ 1.950,00, nada gravado", async () => {
    mockOcr(99);
    await processarMensagemWhatsApp({ telefone: tel, texto: "", external_id: "p0-c2", image: img("b2") });
    const r = await processarMensagemWhatsApp({ telefone: tel, texto: "valor 1.950", external_id: "p0-c2-v" });
    expect(nb(r.resposta)).toContain("R$ 1.950,00");
    expect(nb(r.resposta)).not.toContain("R$ 1,95");
    expect(gastosInserts()).toHaveLength(0);
  });

  it("valor inválido '-19' mantém aguardando valor e não grava", async () => {
    mockOcr(null, "iFood");
    await processarMensagemWhatsApp({ telefone: tel, texto: "", external_id: "p0-c3", image: img("c3") });
    await processarMensagemWhatsApp({ telefone: tel, texto: "-19", external_id: "p0-c3-v" });
    expect(state.pendingRow?.status).toBe("img_aguardando_valor");
    expect(gastosInserts()).toHaveLength(0);
  });
});

function msg(texto: string) {
  return {
    external_id: `p0-b-${Math.random().toString(36).slice(2, 10)}`,
    telefone: tel,
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}
const contas = () => state.inserts.filter((i) => i.table === "contas_a_pagar");

describe("boleto — fluxo aguardando valor", () => {
  beforeEach(() => resetState());

  it("'1.950' → resumo R$ 1.950,00, só grava após confirmar, valor 1950", async () => {
    const { linha } = _buildBoletoArrecadForTest({});
    const r1 = await processarMensagemWhatsApp(msg(linha));
    expect(r1.resposta).toMatch(/Qual é o valor/i);
    await processarMensagemWhatsApp(msg("1.950"));
    await processarMensagemWhatsApp(msg("15/08/2026"));
    const r4 = await processarMensagemWhatsApp(msg("Condomínio"));
    expect(nb(r4.resposta)).toContain("1.950,00");
    expect(contas()).toHaveLength(0);
    const r5 = await processarMensagemWhatsApp(msg("1"));
    expect(r5.status).toBe("salva");
    expect(contas()[0].row.valor).toBe(1950);
  });

  it("valor ambíguo '1,234' pede de novo e nada é criado", async () => {
    const { linha } = _buildBoletoArrecadForTest({});
    await processarMensagemWhatsApp(msg(linha));
    const r = await processarMensagemWhatsApp(msg("1,234"));
    expect(r.resposta).toMatch(/Não consegui ler o valor/);
    expect(contas()).toHaveLength(0);
  });
});
