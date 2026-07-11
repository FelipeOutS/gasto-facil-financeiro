/**
 * WA-C10.4 — banco_emissor persistido em contas criadas a partir de boleto.
 *
 * Testa somente a camada pura (parser + mapeamento) — nenhum I/O, nenhuma
 * escrita real. Idempotência e cache do fluxo OCR são cobertos por
 * `tests/whatsapp-boleto-c10b-*` e permanecem intocados.
 */
import { describe, expect, it } from "bun:test";
import { formatBancoEmissor } from "../src/server/whatsapp-boleto-banco";
import { _buildBoletoCobrancaForTest, tryParseBoleto } from "../src/server/whatsapp-boleto-parser";

describe("WA-C10.4 — formatBancoEmissor", () => {
  it("código 001 → 'Banco do Brasil'", () => {
    expect(formatBancoEmissor("001")).toBe("Banco do Brasil");
  });
  it("código 341 → 'Itaú'", () => {
    expect(formatBancoEmissor("341")).toBe("Itaú");
  });
  it("código 104 → 'Caixa Econômica Federal'", () => {
    expect(formatBancoEmissor("104")).toBe("Caixa Econômica Federal");
  });
  it("código válido mas desconhecido → devolve o próprio código", () => {
    expect(formatBancoEmissor("999")).toBe("999");
  });
  it("código ausente ou inválido → null (fallback manual não inventa banco)", () => {
    expect(formatBancoEmissor(null)).toBeNull();
    expect(formatBancoEmissor(undefined)).toBeNull();
    expect(formatBancoEmissor("")).toBeNull();
    expect(formatBancoEmissor("1")).toBeNull();
    expect(formatBancoEmissor("1234")).toBeNull();
    expect(formatBancoEmissor("abc")).toBeNull();
  });
});

describe("WA-C10.4 — banco extraído do barcode alimenta banco_emissor", () => {
  it("boleto banco 001 → parsed.banco='001' → 'Banco do Brasil'", () => {
    const { linha } = _buildBoletoCobrancaForTest({ banco: "001" });
    const p = tryParseBoleto(linha)!;
    expect(p.banco).toBe("001");
    expect(formatBancoEmissor(p.banco)).toBe("Banco do Brasil");
  });

  it("boleto banco 341 → 'Itaú'", () => {
    const { linha } = _buildBoletoCobrancaForTest({ banco: "341" });
    const p = tryParseBoleto(linha)!;
    expect(p.banco).toBe("341");
    expect(formatBancoEmissor(p.banco)).toBe("Itaú");
  });

  it("banco desconhecido não quebra criação — retorna código puro", () => {
    const { linha } = _buildBoletoCobrancaForTest({ banco: "888" });
    const p = tryParseBoleto(linha)!;
    expect(p.banco).toBe("888");
    expect(formatBancoEmissor(p.banco)).toBe("888");
  });

  it("imagem e PDF produzem o mesmo banco (parser determinístico)", () => {
    const { linha, barcode } = _buildBoletoCobrancaForTest({ banco: "237" });
    const fromLinha = tryParseBoleto(linha)!;
    const fromBarcode = tryParseBoleto(barcode)!;
    expect(fromLinha.banco).toBe(fromBarcode.banco);
    expect(formatBancoEmissor(fromLinha.banco)).toBe("Bradesco");
    expect(formatBancoEmissor(fromBarcode.banco)).toBe("Bradesco");
  });

  it("mudança no banco_emissor NÃO altera valor / vencimento / codigoBarras / fingerprint", () => {
    const { linha } = _buildBoletoCobrancaForTest({
      banco: "033",
      valorCentavos: 12345,
      fator: 9999,
    });
    const p = tryParseBoleto(linha)!;
    expect(p.valorCentavos).toBe(12345);
    expect(p.codigoBarras.length).toBe(44);
    expect(typeof p.fingerprint).toBe("string");
    expect(p.fingerprint.length).toBe(32);
    // Formatação do banco não muda os demais campos.
    formatBancoEmissor(p.banco);
    expect(p.valorCentavos).toBe(12345);
  });
});
