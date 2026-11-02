import { describe, expect, it } from "bun:test";
import { categoriaOptions, isGiCategoria } from "@/lib/pluggy/categorias";
import { categorize } from "@/lib/pluggy/rules";

describe("categorias Pluggy na tela", () => {
  it("Eletrobras e Vivo viram Contas e Contas está no seletor", () => {
    expect(categorize({ category: null, description: "ELETROBRAS LIGHT SA" } as never, "gasto")).toBe("Contas");
    expect(categorize({ category: null, description: "VIVO SERVICOS E COMERCIO" } as never, "gasto")).toBe("Contas");
    expect(categoriaOptions("Contas")).toContain("Contas");
  });
  it("valor salvo fora da lista é preservado como opção, sem cair na primeira", () => {
    expect(categoriaOptions("Categoria Antiga")).toContain("Categoria Antiga");
  });
  it("servidor aceita só categorias conhecidas", () => {
    expect(isGiCategoria("Contas")).toBe(true);
    expect(isGiCategoria("Qualquer")).toBe(false);
  });
});
