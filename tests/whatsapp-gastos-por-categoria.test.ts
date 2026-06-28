/**
 * WA-Q-GastosCategoria-Fix — frases de consulta por categoria não podem
 * abrir sessão de criação nem escrever no banco.
 */
import { describe, it, expect } from "vitest";
import { detectConsultaIntent } from "../src/server/whatsapp-consultas.server";

describe("WA-Q-GastosCategoria-Fix — detecção de consulta por categoria", () => {
  const frases = [
    "gastos por categoria",
    "Gastos Por Categoria",
    "despesas por categoria",
    "despesas por categorias",
    "categorias de gastos",
    "categoria de despesas",
    "onde gastei mais",
    "onde eu gastei mais",
    "onde gasto mais",
    "gastos agrupados por categoria",
    "total por categoria",
  ];

  it.each(frases)("'%s' → gastos_por_categoria_mes", (frase) => {
    expect(detectConsultaIntent(frase)).toBe("gastos_por_categoria_mes");
  });

  it("não confunde com listar_gastos_mes", () => {
    expect(detectConsultaIntent("meus gastos do mês")).toBe("listar_gastos_mes");
    expect(detectConsultaIntent("minhas despesas do mês")).toBe("listar_gastos_mes");
  });

  it("não confunde com maiores_gastos_mes", () => {
    expect(detectConsultaIntent("maiores gastos do mês")).toBe("maiores_gastos_mes");
  });

  it("frase real do incidente 3.12 não cai no parser de criação", () => {
    // detectConsultaIntent precisa reconhecer antes do extractor de
    // gasto interpretar "categoria" como nome de estabelecimento.
    const intent = detectConsultaIntent("gastos por categoria");
    expect(intent).not.toBeNull();
    expect(intent).toBe("gastos_por_categoria_mes");
  });
});
