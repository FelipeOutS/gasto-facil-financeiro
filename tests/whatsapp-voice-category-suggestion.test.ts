/**
 * WA-V1.3 — sugestão de categoria por contexto para mensagens de
 * áudio, sem alterar o comportamento de mensagens digitadas.
 *
 * Testa via `formatarConfirmacao`, que é o ponto onde a prévia de
 * confirmação é construída para o usuário. O sinalizador `source`
 * é o ÚNICO discriminador entre "voz" e "texto digitado".
 *
 * Nunca cria categoria automaticamente, nunca substitui categoria
 * já reconhecida por keyword global, nunca usa IA.
 */
import { test, expect } from "bun:test";
import { formatarConfirmacao } from "../src/server/whatsapp.server";
import type { ParsedExpense } from "../src/lib/whatsappParser";

type Cat = { id: string; legacy_id: string | null; nome: string };

const CATEGORIAS_COM_ALIMENTACAO: Cat[] = [
  { id: "c1", legacy_id: "outros", nome: "Outros" },
  { id: "c2", legacy_id: "alimentacao", nome: "Alimentação" },
  { id: "c3", legacy_id: "mercado", nome: "Mercado" },
];

const CATEGORIAS_SEM_ALIMENTACAO: Cat[] = [
  { id: "c1", legacy_id: "outros", nome: "Outros" },
  { id: "c3", legacy_id: "mercado", nome: "Mercado" },
];

function parsed(nome: string): ParsedExpense {
  return {
    nome,
    valor: 42,
    data: "2025-01-01",
    formaPagamento: "pix",
    mensagemOriginal: nome,
    confianca: 0.9,
    notas: [],
  };
}

// ---------- ÁUDIO: sugestão por contexto ----------

test("áudio: 'Almoço' sugere Alimentação quando a categoria existe", () => {
  const out = formatarConfirmacao(parsed("Almoço"), undefined, CATEGORIAS_COM_ALIMENTACAO, "audio");
  expect(out).toContain("Alimentação");
});

test("áudio: 'Jantar' sugere Alimentação quando a categoria existe", () => {
  const out = formatarConfirmacao(parsed("Jantar"), undefined, CATEGORIAS_COM_ALIMENTACAO, "audio");
  expect(out).toContain("Alimentação");
});

test("áudio: 'Café' sugere Alimentação quando a categoria existe", () => {
  const out = formatarConfirmacao(parsed("Café"), undefined, CATEGORIAS_COM_ALIMENTACAO, "audio");
  expect(out).toContain("Alimentação");
});

test("áudio: 'Mercado' resolve para a categoria Mercado existente", () => {
  const out = formatarConfirmacao(parsed("Mercado"), undefined, CATEGORIAS_COM_ALIMENTACAO, "audio");
  expect(out).toContain("Mercado");
});

test("áudio: sem categoria compatível cadastrada, mantém Outros", () => {
  const out = formatarConfirmacao(
    parsed("Almoço"),
    undefined,
    [{ id: "c1", legacy_id: "outros", nome: "Outros" }],
    "audio",
  );
  expect(out).toContain("Outros");
  expect(out).not.toContain("Alimentação");
});

test("áudio: 'Restaurante' (keyword global) continua resolvendo para Alimentação", () => {
  const out = formatarConfirmacao(parsed("Restaurante"), undefined, CATEGORIAS_COM_ALIMENTACAO, "audio");
  expect(out).toContain("Alimentação");
});

// ---------- TEXTO: comportamento preservado ----------

test("texto digitado: 'Almoço' (sem source) NÃO recebe sugestão extra → mantém Outros", () => {
  const out = formatarConfirmacao(parsed("Almoço"), undefined, CATEGORIAS_COM_ALIMENTACAO);
  expect(out).toContain("Outros");
  expect(out).not.toContain("Alimentação");
});

test("texto digitado: 'Jantar' (sem source) → mantém Outros", () => {
  const out = formatarConfirmacao(parsed("Jantar"), undefined, CATEGORIAS_COM_ALIMENTACAO);
  expect(out).toContain("Outros");
});

test("texto digitado: 'Mercado' (sem source) continua resolvendo Mercado", () => {
  const out = formatarConfirmacao(parsed("Mercado"), undefined, CATEGORIAS_SEM_ALIMENTACAO);
  expect(out).toContain("Mercado");
});

test("texto digitado: 'Restaurante' (sem source) preserva Alimentação", () => {
  const out = formatarConfirmacao(parsed("Restaurante"), undefined, CATEGORIAS_COM_ALIMENTACAO);
  expect(out).toContain("Alimentação");
});
