import { describe, it, expect } from "vitest";
import { detectFileKind, filenameSuggestsFatura } from "@/components/ImportExtratoDialog";
import { parseCsvFile, parseValorBR, parseDataBR, suggestCategoryFromDescription } from "@/lib/csv-fatura";

function file(name: string, type: string) {
  return new File(["x"], name, { type });
}

describe("importar gastos — detecção de tipo de arquivo", () => {
  it("reconhece PDF por mime e por extensão", () => {
    expect(detectFileKind(file("extrato.pdf", "application/pdf"))).toBe("pdf");
    expect(detectFileKind(file("extrato.PDF", ""))).toBe("pdf");
  });

  it("reconhece imagens", () => {
    expect(detectFileKind(file("print.jpg", "image/jpeg"))).toBe("imagem");
    expect(detectFileKind(file("print.png", "image/png"))).toBe("imagem");
  });

  it("reconhece CSV", () => {
    expect(detectFileKind(file("mov.csv", "text/csv"))).toBe("csv");
    expect(detectFileKind(file("mov.csv", ""))).toBe("csv");
  });

  it("rejeita formatos não suportados", () => {
    expect(detectFileKind(file("doc.docx", "application/vnd.openxmlformats"))).toBeNull();
    expect(detectFileKind(file("arquivo.zip", "application/zip"))).toBeNull();
  });
});

describe("importar gastos — pergunta de tipo de documento", () => {
  it("sugere fatura quando o nome indica", () => {
    expect(filenameSuggestsFatura("Fatura_Nubank_Agosto.pdf")).toBe(true);
    expect(filenameSuggestsFatura("cartao-itau.pdf")).toBe(true);
  });
  it("não pergunta para extratos comuns", () => {
    expect(filenameSuggestsFatura("Extrato_Agosto.pdf")).toBe(false);
  });
});

describe("importar gastos — normalização CSV", () => {
  it("parseia valores negativos e positivos em formato BR", () => {
    expect(parseValorBR("-1.234,56")).toBe(-1234.56);
    expect(parseValorBR("32,50")).toBe(32.5);
  });

  it("parseia datas BR e ISO", () => {
    expect(parseDataBR("13/08/2026")).toBe("2026-08-13");
    expect(parseDataBR("2026-08-13")).toBe("2026-08-13");
  });

  it("lê cabeçalhos e linhas do CSV", () => {
    const { headers, rows } = parseCsvFile("Data;Descricao;Valor\n13/08/2026;Uber;-32,50\n");
    expect(headers.length).toBe(3);
    expect(rows.length).toBe(1);
    expect(rows[0]?.[1]).toBe("Uber");
  });

  it("sugere categoria a partir da descrição", () => {
    expect(suggestCategoryFromDescription("UBER TRIP")).toBe("transporte");
    expect(suggestCategoryFromDescription("NETFLIX.COM")).toBe("assinaturas");
  });
});
