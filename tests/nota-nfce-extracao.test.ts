/**
 * Fluxo Nota/Comprovante — conversão da NFC-e em UM gasto para revisão.
 *
 * Roda via: bun test tests/nota-nfce-extracao.test.ts
 */
import { describe, expect, it } from "bun:test";
import {
  mapNfceResultToExtracao,
  nfceResultIsUsable,
} from "../src/lib/nota/nfce-to-gasto";
import type { NfceFetchResult } from "../src/lib/mercado/nfce-fetch.functions";

function item(nome: string, valorTotal: number) {
  return { id: nome, nome, quantidade: 1, valorTotal, confianca: "alta" as const };
}

const base: NfceFetchResult = {
  status: "items_found",
  host: "nfce.fazenda.sp.gov.br",
  items: [item("ARROZ", 25.9), item("LEITE", 6.99), item("SABAO", 12.5)],
  totalDeclared: 45.39,
  marketName: "Mercado Exemplo LTDA",
  dateISO: "2026-09-09",
  warnings: [],
};

describe("NFC-e → gasto único", () => {
  it("gera UM gasto com o total e mantém itens como informação auxiliar", () => {
    const e = mapNfceResultToExtracao(base)!;
    expect(e.valor).toBe(45.39);
    expect(e.descricao).toBe("Mercado Exemplo LTDA");
    expect(e.data).toBe("2026-09-09");
    expect(e.itens.length).toBe(3);
    expect(e.categoriaSugerida).toBe("mercado");
    expect(e.fonte).toBe("nfce_qr");
  });

  it("nunca inventa forma de pagamento", () => {
    expect(mapNfceResultToExtracao(base)!.formaPagamento).toBeNull();
  });

  it("aceita nota só com total declarado", () => {
    const r: NfceFetchResult = {
      ...base,
      status: "total_only",
      items: [],
      totalDeclared: 274.77,
    };
    const e = mapNfceResultToExtracao(r)!;
    expect(e.valor).toBe(274.77);
    expect(e.itens.length).toBe(0);
    expect(e.confianca).toBe("media");
  });

  it("página protegida/CAPTCHA não é utilizável → cai para OCR", () => {
    const r: NfceFetchResult = { ...base, status: "protected", items: [], totalDeclared: undefined };
    expect(nfceResultIsUsable(r)).toBe(false);
    expect(mapNfceResultToExtracao(r)).toBeNull();
  });

  it("estado incompatível, timeout e erro HTTP não são utilizáveis", () => {
    for (const status of ["link_no_items", "timeout", "http_error", "network_error"] as const) {
      const r: NfceFetchResult = { ...base, status, items: [], totalDeclared: undefined };
      expect(mapNfceResultToExtracao(r)).toBeNull();
    }
  });

  it("usa soma dos itens quando não há total declarado", () => {
    const r: NfceFetchResult = { ...base, totalDeclared: undefined };
    const e = mapNfceResultToExtracao(r)!;
    expect(e.valor).toBe(45.39);
  });
});
