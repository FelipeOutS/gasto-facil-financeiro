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
import { resetState, state, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { detectQueryPixIntent, parseQueryPix, detectSavePixIntent, maskPixKey } =
  await import("../src/server/whatsapp-pix-parser");
const { handleQueryPixIntent } = await import("../src/server/whatsapp-pix-intents.server");
const { _resetShortContext } = await import("../src/server/whatsapp-short-context.server");

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

  it("save ainda funciona com verbo explícito", () => {
    expect(detectSavePixIntent("salva o Pix do João: 11999998888")).toBe(true);
    expect(detectSavePixIntent("cadastra Pix do Pedro CPF 123.456.789-00")).toBe(true);
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
          id: "f1",
          user_id: userId,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: chaveReal,
          pix_key_type: "telefone",
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId,
      telefone,
      texto: "qual a chave Pix do João Silva?",
      _row: fakeRow,
    });
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("João Silva");
    expect(out.resposta).toContain("Celular");
    // WA-PIX-UX-01.c — texto do corpo NÃO contém URL crua: ela vai no
    // botão CTA da mensagem interactive. Fallback textual continua
    // contendo a URL, mas o `resposta` primário agora é o corpo curto.
    expect(out.resposta).not.toMatch(/\/pix\/copiar\//);
    // Botão CTA URL presente com rótulo canônico e URL segura.
    expect(out.interactive?.type).toBe("cta_url");
    expect(out.interactive?.buttonText).toBe("Copiar chave Pix");
    expect(out.interactive?.url).toMatch(/\/pix\/copiar\/[A-Za-z0-9_-]{20,}/);
    expect(out.interactive?.body).toContain("João Silva");
    expect(out.interactive?.body).toContain("Celular");
    // Nunca a chave completa
    expect(out.resposta).not.toContain("11999998888");
    expect(out.resposta).not.toContain(chaveReal);
    expect(out.interactive?.body).not.toContain("11999998888");
    expect(out.interactive?.body).not.toContain(chaveReal);
    expect(out.interactive?.url).not.toContain("11999998888");
    expect(out.interactive?.url).not.toContain(chaveReal);
    expect(out.interactive?.buttonText).not.toContain("11999998888");
    // Máscara com operador U+2217 continua no corpo
    expect(out.resposta).toMatch(/9∗∗∗∗-8888/);
    expect(out.interactive?.body).toMatch(/9∗∗∗∗-8888/);
    // Nenhuma escrita em gasto/favorecido. A única escrita permitida é o
    // token opaco de reveal (whatsapp_pix_reveal_tokens), que jamais contém
    // a chave em texto plano.
    for (const ins of state.inserts) {
      expect(ins.table).toBe("whatsapp_pix_reveal_tokens");
      const payload = JSON.stringify(ins.row ?? {});
      expect(payload).not.toContain("11999998888");
      expect(payload).not.toContain(chaveReal);
    }
  });

  it("respeita isolamento por user_id (favorecido de outro user é invisível)", async () => {
    resetState({
      favorecidos: [
        {
          id: "f2",
          user_id: other,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: "+5511999998888",
          pix_key_type: "telefone",
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId,
      telefone,
      texto: "qual a chave Pix do João Silva?",
      _row: fakeRow,
    });
    expect(out.resposta).toContain("Não encontrei");
    expect(out.interactive).toBeUndefined();
    expect(state.inserts.length).toBe(0);
  });

  it("desambigua quando 2+ favorecidos com o mesmo nome", async () => {
    resetState({
      favorecidos: [
        {
          id: "a",
          user_id: userId,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: "a@x.com",
          pix_key_type: "email",
        },
        {
          id: "b",
          user_id: userId,
          nome: "João Silveira",
          apelido: null,
          ativo: true,
          pix_key: "b@x.com",
          pix_key_type: "email",
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId,
      telefone,
      texto: "chave Pix do João",
      _row: fakeRow,
    });
    expect(out.resposta).toContain("mais de uma pessoa");
    // WA-PIX-UX-01.c — ambiguidade NUNCA emite botão CTA (nenhum favorecido
    // único, portanto nenhum token de reveal deve ser gerado).
    expect(out.interactive).toBeUndefined();
    expect(state.inserts.length).toBe(0);
  });

  it("responde 'sem chave' quando favorecido existe mas não tem Pix", async () => {
    resetState({
      favorecidos: [
        {
          id: "f1",
          user_id: userId,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: null,
          pix_key_type: null,
        },
      ],
    });
    const out = await handleQueryPixIntent({
      userId,
      telefone,
      texto: "qual a chave Pix do João Silva?",
      _row: fakeRow,
    });
    expect(out.resposta.toLowerCase()).toContain("sem chave pix");
    expect(out.interactive).toBeUndefined();
    expect(state.inserts.length).toBe(0);
  });
});

describe("WA-PIX-Q-01 :: máscara de celular", () => {
  it("usa U+2217 e preserva DDD + últimos 4", () => {
    expect(maskPixKey("+5511999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
    expect(maskPixKey("11999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
  });
});
