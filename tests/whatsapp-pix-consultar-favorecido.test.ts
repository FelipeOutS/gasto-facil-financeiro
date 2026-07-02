/**
 * WA-PIX-Q-01 — intent `consultar_pix_favorecido`.
 *
 * Garante:
 *  - detecção com todas as variações naturais (com/sem "chave", acento etc.);
 *  - parser extrai nome (simples e composto);
 *  - handler retorna chave MASCARADA, nunca completa;
 *  - handler não abre sessão, não cria gasto/favorecido/claim;
 *  - isolamento por user_id;
 *  - fallbacks (não encontrado / ambíguo / sem chave).
 *
 * Não faz asserts sobre a suíte geral — apenas o novo comportamento
 * dedicado a este card.
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state } from "./_whatsapp-fake";

const {
  detectQueryPixIntent,
  parseQueryPix,
  detectSavePixIntent,
  maskPixKey,
} = await import("../src/server/whatsapp-pix-parser");
const { handleQueryPixIntent } = await import(
  "../src/server/whatsapp-pix-intents.server"
);
const { _resetShortContext } = await import(
  "../src/server/whatsapp-short-context.server"
);

const userId = "u1";
const other = "u2";
const telefone = "5511999998888";
const fakeRow = {
  external_id: "ext-q1",
  telefone,
  texto: "",
  recebida_em: new Date().toISOString(),
} as never;

const variacoes = [
  "qual o Pix do João?",
  "qual é o Pix do João Silva?",
  "qual a chave Pix do João Silva?",
  "chave Pix do João",
  "qual a chave do João?",
  "me passa o Pix do João",
  "Pix do João Silva",
  "Pix da Maria",
  "qual a chave pix do joao silva", // sem acento
];

describe("WA-PIX-Q-01 :: detecção", () => {
  for (const t of variacoes) {
    it(`detecta como query: ${JSON.stringify(t)}`, () => {
      expect(detectQueryPixIntent(t)).toBe(true);
      expect(detectSavePixIntent(t)).toBe(false);
    });
  }

  it("NÃO detecta save quando é query", () => {
    expect(detectSavePixIntent("qual a chave Pix do João?")).toBe(false);
    expect(detectSavePixIntent("Pix do João Silva")).toBe(false);
    expect(detectSavePixIntent("chave Pix do João")).toBe(false);
  });

  it("save ainda funciona com separador", () => {
    expect(detectSavePixIntent("salva o Pix do João: 11999998888")).toBe(true);
    expect(detectSavePixIntent("Pix do João é 11999998888")).toBe(true);
  });

  it("não detecta em pedidos de listagem geral (Q-Guard cuida)", () => {
    expect(detectQueryPixIntent("meus favorecidos")).toBe(false);
    expect(detectQueryPixIntent("lista de chaves pix")).toBe(false);
  });
});

describe("WA-PIX-Q-01 :: parser", () => {
  it("extrai nome simples", () => {
    expect(parseQueryPix("qual o Pix do João?")?.nome).toBe("João");
  });
  it("extrai nome composto", () => {
    expect(parseQueryPix("qual a chave Pix do João Silva?")?.nome).toBe("João Silva");
  });
  it("extrai nome em 'chave (pix)? do NOME'", () => {
    expect(parseQueryPix("chave Pix do João Silva")?.nome).toBe("João Silva");
    expect(parseQueryPix("qual a chave do João?")?.nome).toBe("João");
  });
  it("extrai nome em 'Pix do NOME' isolado", () => {
    expect(parseQueryPix("Pix do João Silva")?.nome).toBe("João Silva");
  });
});

describe("WA-PIX-Q-01 :: handler", () => {
  beforeEach(() => {
    resetState({});
    _resetShortContext();
  });

  it("retorna chave MASCARADA, nunca a chave completa, sem escritas", async () => {
    const chaveReal = "+5511999998888";
    resetState({
      favorecidos: [
        {
          id: "f1", user_id: userId, nome: "João Silva",
          apelido: null, ativo: true,
          pix_key: chaveReal, pix_key_type: "telefone",
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone,
      texto: "qual a chave Pix do João Silva?",
      _row: fakeRow,
    });
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("João Silva");
    expect(out.resposta).toContain("Celular");
    expect(out.resposta).toContain("Para copiar a chave completa");
    // Não expõe chave completa
    expect(out.resposta).not.toContain("11999998888");
    expect(out.resposta).not.toContain(chaveReal);
    // Contém máscara com operador U+2217
    expect(out.resposta).toMatch(/9∗∗∗∗-8888/);
    // Nenhuma escrita
    expect(state.inserts.length).toBe(0);
  });

  it("respeita isolamento por user_id (favorecido de outro user é invisível)", async () => {
    resetState({
      favorecidos: [
        {
          id: "f2", user_id: other, nome: "João Silva",
          apelido: null, ativo: true,
          pix_key: "+5511999998888", pix_key_type: "telefone",
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone,
      texto: "qual a chave Pix do João Silva?",
      _row: fakeRow,
    });
    expect(out.resposta).toContain("Não encontrei");
    expect(state.inserts.length).toBe(0);
  });

  it("desambigua quando 2+ favorecidos com o mesmo nome", async () => {
    resetState({
      favorecidos: [
        { id: "a", user_id: userId, nome: "João Silva", apelido: null, ativo: true, pix_key: "a@x.com", pix_key_type: "email" },
        { id: "b", user_id: userId, nome: "João Silveira", apelido: null, ativo: true, pix_key: "b@x.com", pix_key_type: "email" },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone, texto: "chave Pix do João", _row: fakeRow,
    });
    expect(out.resposta).toContain("mais de uma pessoa");
    expect(state.inserts.length).toBe(0);
  });

  it("responde 'sem chave' quando favorecido existe mas não tem Pix", async () => {
    resetState({
      favorecidos: [
        { id: "f1", user_id: userId, nome: "João Silva", apelido: null, ativo: true, pix_key: null, pix_key_type: null },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone, texto: "qual a chave Pix do João Silva?", _row: fakeRow,
    });
    expect(out.resposta.toLowerCase()).toContain("sem chave pix");
    expect(state.inserts.length).toBe(0);
  });
});

describe("WA-PIX-Q-01 :: máscara de celular", () => {
  it("usa U+2217 e preserva DDD + últimos 4", () => {
    expect(maskPixKey("+5511999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
    expect(maskPixKey("11999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
  });
});
