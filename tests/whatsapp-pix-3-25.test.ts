/**
 * WA-PIX-3.25 — Pagamento a favorecido já cadastrado com Pix.
 *
 * Regressão dos dois bugs encontrados no smoke:
 *
 *   (1) Parser engolia preposição "no" como sobrenome
 *       "paguei 50 pro João no Pix" → nome deve ser "João" (não "João No").
 *
 *   (2) Fluxo persistia o gasto direto quando havia favorecido único
 *       com chave Pix cadastrada. Correto: abrir SEMPRE a prévia Pix
 *       Inline (`pp_aguardando_confirmar_pix_inline`), sem escrever
 *       nada até o "sim".
 *
 * Invariantes de segurança:
 *   - a chave completa NUNCA aparece em `texto`, `parsed`,
 *     `resposta_sugerida`, `mensagemOriginal` da sessão ou logs;
 *   - "cancelar" na prévia = zero gasto;
 *   - duplicidade de "sim" = um único gasto;
 *   - favorecido inexistente mantém contrato de gasto simples, mas
 *     com o NOME já corretamente extraído (sem "No"/"Na" grudado).
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state } from "./_whatsapp-fake";

const { parsePagarPessoa } = await import("../src/server/whatsapp-pix-parser");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { _resetShortContext } = await import("../src/server/whatsapp-short-context.server");

const telefone = "5511999998888";
const userId = "u1";
const chaveReal = "+5511999998888";

function gastoInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}

function textosPersistidos(): string[] {
  const out: string[] = [];
  // Colunas cujo valor SEMPRE contém o telefone do remetente e portanto
  // seriam falso-positivos ("11999998888" é substring de "5511999998888").
  const skipCols = new Set(["telefone", "external_id", "id", "user_id"]);
  for (const i of state.inserts) {
    for (const [k, v] of Object.entries(i.row ?? {})) {
      if (skipCols.has(k)) continue;
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object") out.push(JSON.stringify(v));
    }
  }
  return out;
}

function assertChaveNaoVazou() {
  const digits = chaveReal.replace(/\D+/g, ""); // 5511999998888
  const bare11 = digits.slice(-11); // 11999998888
  for (const s of textosPersistidos()) {
    expect(s.includes(bare11)).toBe(false);
    expect(s.includes(chaveReal)).toBe(false);
  }
}

// -------------------------------------------------------------------------
// (1) Parser — stop-words de preposição no contexto de pagamento
// -------------------------------------------------------------------------
describe("WA-PIX-3.25 :: parser stop-words de preposição", () => {
  const casos: Array<[string, string]> = [
    ["paguei 50 pro João no Pix", "João"],
    ["paguei 50 pra João na chave Pix", "João"],
    ["paguei 50 para João via Pix", "João"],
    ["paguei 50 para João com Pix", "João"],
    ["paguei 50 para João usando Pix", "João"],
    ["paguei 50 para João por Pix", "João"],
    ["paguei 50 pelo João no Pix", "João"],
    ["paguei R$ 50 para João Silva no Pix", "João Silva"], // composto legítimo
  ];
  for (const [texto, esperado] of casos) {
    it(`extrai "${esperado}" de: ${JSON.stringify(texto)}`, () => {
      const p = parsePagarPessoa(texto);
      expect(p).not.toBeNull();
      expect(p!.nome).toBe(esperado);
      expect(p!.formaPagamento).toBe("pix");
      expect(p!.valorCentavos).toBe(5000);
    });
  }
});

// -------------------------------------------------------------------------
// (2) Fluxo — favorecido único com chave Pix cadastrada
// -------------------------------------------------------------------------
describe("WA-PIX-3.25 :: prévia Pix Inline obrigatória", () => {
  beforeEach(() => {
    resetState({
      favorecidos: [
        {
          id: "40cb5557",
          user_id: userId,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: chaveReal,
          pix_key_type: "telefone",
        },
      ],
    });
    _resetShortContext();
  });

  it("abre prévia com máscara +55 11 9∗∗∗∗-8888 e NÃO cria gasto", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-a",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Confira o pagamento Pix/i);
    expect(r.resposta).toContain("João Silva");
    expect(r.resposta).toContain("Celular");
    expect(r.resposta).toMatch(/9∗∗∗∗-8888/);
    expect(r.resposta).toMatch(/R\$\s*50,00/);
    expect(r.resposta).toMatch(/sim.*cancelar/i);
    expect(gastoInserts()).toHaveLength(0);
    assertChaveNaoVazou();
  });

  it('"sim" após a prévia cria EXATAMENTE 1 gasto vinculado ao favorecido', async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-b1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "wa-pix-325-b2",
    });
    expect(r.status).toBe("salva");
    const gastos = gastoInserts();
    expect(gastos).toHaveLength(1);
    const g = gastos[0].row as Record<string, unknown>;
    expect(g.forma_pagamento).toBe("pix");
    expect(g.fornecedor_id).toBe("40cb5557");
    expect(g.user_id).toBe(userId);
    // Valor gravado em reais (2 casas) — o handler converte de centavos.
    expect(Number(g.valor)).toBeCloseTo(50, 2);
    // Nenhum favorecido novo criado.
    const forn = state.inserts.filter((i) => i.table === "fornecedores");
    expect(forn).toHaveLength(0);
    assertChaveNaoVazou();
  });

  it('"cancelar" na prévia = ZERO gasto', async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-c1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "cancelar",
      external_id: "wa-pix-325-c2",
    });
    expect(r.status).toBe("cancelada");
    expect(gastoInserts()).toHaveLength(0);
  });

  it('duplicidade de "sim" (mesmo external_id) → 1 único gasto', async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-d1",
    });
    const [a, b] = await Promise.all([
      processarMensagemWhatsApp({
        telefone,
        texto: "sim",
        external_id: "wa-pix-325-d2",
      }),
      processarMensagemWhatsApp({
        telefone,
        texto: "sim",
        external_id: "wa-pix-325-d2",
      }),
    ]);
    expect(gastoInserts()).toHaveLength(1);
    const finais = [a.status, b.status];
    expect(finais.some((s) => s === "salva" || s === "duplicada")).toBe(true);
  });

  it('variação "paguei 50 pra João na chave Pix" também abre prévia', async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pra João na chave Pix",
      external_id: "wa-pix-325-e",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toContain("João Silva");
    expect(gastoInserts()).toHaveLength(0);
  });

  it('variação "paguei 50 para João via Pix" também abre prévia', async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 para João via Pix",
      external_id: "wa-pix-325-f",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toContain("João Silva");
    expect(gastoInserts()).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// (3) Fluxo — favorecido inexistente mantém contrato atual
// -------------------------------------------------------------------------
describe("WA-PIX-3.25 :: favorecido inexistente segue fluxo simples", () => {
  beforeEach(() => {
    resetState({ favorecidos: [] });
    _resetShortContext();
  });

  it('nome extraído SEM "No" grudado, gasto simples criado', async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-g",
    });
    expect(r.status).toBe("salva");
    const gastos = gastoInserts();
    expect(gastos).toHaveLength(1);
    const g = gastos[0].row as Record<string, unknown>;
    expect(g.forma_pagamento).toBe("pix");
    expect(g.fornecedor_id).toBeNull();
    expect(g.estabelecimento).toBe("João");
  });
});

// -------------------------------------------------------------------------
// (4) Fluxo — nome ambíguo (2 favorecidos) não escolhe errado
// -------------------------------------------------------------------------
describe("WA-PIX-3.25 :: ambiguidade não abre prévia Pix", () => {
  it("2 favorecidos com o mesmo nome → NÃO abre prévia com chave errada", async () => {
    resetState({
      favorecidos: [
        {
          id: "a",
          user_id: userId,
          nome: "João Silva",
          apelido: null,
          ativo: true,
          pix_key: "aaa@x.com",
          pix_key_type: "email",
        },
        {
          id: "b",
          user_id: userId,
          nome: "João Silveira",
          apelido: null,
          ativo: true,
          pix_key: "bbb@x.com",
          pix_key_type: "email",
        },
      ],
    });
    _resetShortContext();
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "paguei 50 pro João no Pix",
      external_id: "wa-pix-325-h",
    });
    // Sem match único, o handler NÃO deve abrir prévia com chave de
    // um dos dois. Aceita: gasto avulso, ou pedido de desambiguação.
    expect(r.resposta).not.toMatch(/aaa@x\.com/);
    expect(r.resposta).not.toMatch(/bbb@x\.com/);
  });
});
