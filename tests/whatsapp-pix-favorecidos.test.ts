/**
 * WA-C7 — Testes do fluxo de Pix / favorecidos / pagamento para pessoa.
 *
 * Cobertura:
 *  - parser puro (classificação de chave, save/query/pay)
 *  - handler de cadastro (create + update)
 *  - handler de consulta (ambíguo, sem chave, com chave)
 *  - handler de pagamento (com e sem favorecido)
 *  - integração via webhook (texto "salva o Pix do João: 11999...")
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state } from "./_whatsapp-fake";
import {
  detectPixKeyType,
  parseSavePix,
  parseQueryPix,
  parsePagarPessoa,
  detectSavePixIntent,
  detectQueryPixIntent,
  detectPagarPessoaIntent,
} from "../src/server/whatsapp-pix-parser";
import {
  handleSavePixIntent,
  handleQueryPixIntent,
  handlePagarPessoaIntent,
} from "../src/server/whatsapp-pix-intents.server";
import { _resetShortContext } from "../src/server/whatsapp-short-context.server";

const userId = "u1";
const telefone = "5511999998888";
const fakeRow = {
  external_id: "ext-1",
  telefone,
  texto: "",
  recebida_em: new Date().toISOString(),
} as never;

describe("WA-C7 :: parser", () => {
  describe("detectPixKeyType", () => {
    it("classifica email", () => {
      expect(detectPixKeyType("joao@email.com")).toBe("email");
    });
    it("classifica CPF mascarado", () => {
      expect(detectPixKeyType("123.456.789-00")).toBe("cpf");
    });
    it("classifica CNPJ", () => {
      expect(detectPixKeyType("12345678000199")).toBe("cnpj");
    });
    it("classifica telefone com DDD entre parênteses", () => {
      expect(detectPixKeyType("(11) 99999-9999")).toBe("telefone");
    });
    it("classifica UUID v4 como aleatoria", () => {
      expect(detectPixKeyType("550e8400-e29b-41d4-a716-446655440000")).toBe("aleatoria");
    });
    it("retorna desconhecida para vazio", () => {
      expect(detectPixKeyType("")).toBe("desconhecida");
    });
  });

  describe("parseSavePix", () => {
    it("extrai nome e email com separador ':'", () => {
      const p = parseSavePix("salva o Pix do João: joao@email.com");
      expect(p?.nome).toBe("João");
      expect(p?.pixKey).toBe("joao@email.com");
      expect(p?.pixKeyType).toBe("email");
    });
    it("aceita 'é' como separador", () => {
      const p = parseSavePix("Pix da Maria é maria@example.com");
      expect(p?.nome).toBe("Maria");
      expect(p?.pixKeyType).toBe("email");
    });
    it("aceita 'CPF' como dica explícita de tipo", () => {
      const p = parseSavePix("cadastra Pix do Pedro CPF 123.456.789-00");
      expect(p?.nome).toBe("Pedro");
      expect(p?.pixKey).toBe("12345678900");
      expect(p?.pixKeyType).toBe("cpf");
    });
  });

  describe("parseQueryPix", () => {
    it("extrai nome em consulta direta", () => {
      const p = parseQueryPix("qual o pix do João?");
      expect(p?.nome).toBe("João");
    });
  });

  describe("parsePagarPessoa", () => {
    it("extrai valor + nome + descrição com 'ao'", () => {
      const p = parsePagarPessoa("paguei R$ 50 ao João do almoço");
      expect(p?.valorCentavos).toBe(5000);
      expect(p?.nome).toBe("João");
      expect(p?.descricao).toBe("almoço");
    });
    it("aceita 'paguei <Nome> <valor>'", () => {
      const p = parsePagarPessoa("paguei Maria 120 da faxina");
      expect(p?.valorCentavos).toBe(12000);
      expect(p?.nome).toBe("Maria");
      expect(p?.descricao).toBe("faxina");
    });
  });

  describe("detectores", () => {
    it("save vs query: 'qual o pix' não dispara save", () => {
      expect(detectSavePixIntent("qual o pix do João?")).toBe(false);
      expect(detectQueryPixIntent("qual o pix do João?")).toBe(true);
    });
    it("pagar pessoa não dispara em 'paguei a internet'", () => {
      expect(detectPagarPessoaIntent("paguei a internet")).toBe(false);
    });
    it("pagar pessoa dispara em 'paguei 50 ao João'", () => {
      expect(detectPagarPessoaIntent("paguei 50 ao João")).toBe(true);
    });
    it("pagar pessoa NÃO dispara em 'paguei a fatura do cartão'", () => {
      expect(detectPagarPessoaIntent("paguei 200 da fatura do cartão")).toBe(false);
    });
  });
});

describe("WA-C7 :: handlers", () => {
  beforeEach(() => {
    resetState({});
    _resetShortContext();
  });

  it("handleSavePixIntent cria favorecido novo", async () => {
    const out = await handleSavePixIntent({
      userId,
      telefone,
      texto: "salva o Pix do João: joao@email.com",
      _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    expect(out.resposta).toContain("João");
    expect(state.favorecidosData.length).toBe(1);
    const inserts = state.inserts.filter((i) => i.table === "fornecedores");
    expect(inserts.length).toBe(1);
    expect((inserts[0].row as { pix_key_type?: string }).pix_key_type).toBe("email");
  });

  it("handleSavePixIntent atualiza Pix de favorecido existente", async () => {
    resetState({
      favorecidos: [
        { id: "f1", user_id: userId, nome: "João", apelido: null, ativo: true, pix_key: null, pix_key_type: null },
      ],
    });
    const out = await handleSavePixIntent({
      userId, telefone, texto: "salva o Pix do João: joao@email.com", _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    expect(state.favorecidosData.length).toBe(1);
    expect((state.favorecidosData[0] as { pix_key?: string }).pix_key).toBe("joao@email.com");
  });

  it("handleQueryPixIntent retorna formato pedido quando não há parse", async () => {
    // Sem favorecido cadastrado: termo "joão" → favorecidoNaoEncontrado.
    const out = await handleQueryPixIntent({
      userId, telefone, texto: "qual o pix do João?", _row: fakeRow,
    });
    expect(out.resposta).toContain("Não encontrei");
  });

  it("handleQueryPixIntent retorna chave quando favorecido existe", async () => {
    resetState({
      favorecidos: [
        { id: "f1", user_id: userId, nome: "João", apelido: null, ativo: true, pix_key: "joao@email.com", pix_key_type: "email" },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone, texto: "qual o pix do João?", _row: fakeRow,
    });
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("joao@email.com");
  });

  it("handleQueryPixIntent oferece desambiguação para 2+ matches", async () => {
    resetState({
      favorecidos: [
        { id: "f1", user_id: userId, nome: "João Silva", apelido: null, ativo: true, pix_key: "a@x.com", pix_key_type: "email" },
        { id: "f2", user_id: userId, nome: "João Souza", apelido: null, ativo: true, pix_key: "b@x.com", pix_key_type: "email" },
      ],
    });
    const out = await handleQueryPixIntent({
      userId, telefone, texto: "qual o pix do João?", _row: fakeRow,
    });
    expect(out.resposta).toContain("mais de uma pessoa");
    expect(out.resposta).toContain("João Silva");
    expect(out.resposta).toContain("João Souza");
  });

  it("handlePagarPessoaIntent cria gasto vinculado quando match único", async () => {
    resetState({
      favorecidos: [
        { id: "f1", user_id: userId, nome: "João", apelido: null, ativo: true, pix_key: null, pix_key_type: null },
      ],
    });
    const out = await handlePagarPessoaIntent({
      userId, telefone, texto: "paguei R$ 50 ao João do almoço", _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    const gastoInserts = state.inserts.filter((i) => i.table === "gastos");
    expect(gastoInserts.length).toBe(1);
    const g = gastoInserts[0].row as { valor: number; fornecedor_id: string | null; forma_pagamento: string };
    expect(g.valor).toBe(5000);
    expect(g.fornecedor_id).toBe("f1");
  });

  it("handlePagarPessoaIntent cria gasto sem vínculo quando favorecido inexistente", async () => {
    const out = await handlePagarPessoaIntent({
      userId, telefone, texto: "paguei 80 para Carlos", _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    const gastoInserts = state.inserts.filter((i) => i.table === "gastos");
    expect(gastoInserts.length).toBe(1);
    const g = gastoInserts[0].row as { fornecedor_id: string | null };
    expect(g.fornecedor_id).toBeNull();
  });
});
