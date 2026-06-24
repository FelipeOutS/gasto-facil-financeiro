/**
 * WA-V1.3 — limpeza determinística da descrição.
 *
 * `cleanDescricao` precisa remover pontuação residual deixada por
 * `extractNome` ao apagar valor, data e forma de pagamento, sem
 * mexer em pontuação interna legítima.
 *
 * NUNCA usa IA, regex de inferência semântica ou heurística por
 * tamanho — só corte de bordas. As asserções abaixo cobrem todos
 * os exemplos pedidos na issue WA-V1.3 e os casos de "não alterar".
 */
import { test, expect } from "bun:test";
import { cleanDescricao } from "../src/lib/whatsappParser";

test("cleanDescricao: remove vírgula+espaço+ponto residual ao final", () => {
  expect(cleanDescricao("Almoço, .")).toBe("Almoço");
});

test("cleanDescricao: remove ponto solto ao final", () => {
  expect(cleanDescricao("Café .")).toBe("Café");
});

test("cleanDescricao: remove vírgulas em sequência ao final", () => {
  expect(cleanDescricao("Uber,,")).toBe("Uber");
});

test("cleanDescricao: remove espaços duplicados nas bordas", () => {
  expect(cleanDescricao("Mercado  ")).toBe("Mercado");
});

test("cleanDescricao: combinações .,/,,/ . no fim", () => {
  expect(cleanDescricao("Posto , .")).toBe("Posto");
  expect(cleanDescricao("Padaria ,,")).toBe("Padaria");
  expect(cleanDescricao("Lanche  .,")).toBe("Lanche");
});

test("cleanDescricao: preserva acentos e números internos", () => {
  expect(cleanDescricao("Mercado 24h")).toBe("Mercado 24h");
  expect(cleanDescricao("Açaí da Praça")).toBe("Açaí da Praça");
});

test("cleanDescricao: colapsa espaços internos para um único espaço", () => {
  expect(cleanDescricao("Café   da   Manhã")).toBe("Café da Manhã");
});

test("cleanDescricao: string vazia ou nula vira string vazia", () => {
  expect(cleanDescricao("")).toBe("");
  expect(cleanDescricao(null)).toBe("");
  expect(cleanDescricao(undefined)).toBe("");
});
