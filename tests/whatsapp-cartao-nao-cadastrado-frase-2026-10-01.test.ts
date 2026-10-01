/**
 * 01/10/2026 — Frase natural de gasto com cartão (cadastrado ou não),
 * consultas preservadas, "Continuar sem cadastrar" completo, rastreio do
 * envio do Flow e idempotência concorrente do cadastro de cartão.
 */
import { test, expect, beforeEach, afterEach, describe, setSystemTime } from "bun:test";
import { resetState, gastosInserts, setupWhatsAppFakeMocks, state } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const W = await import("../src/server/whatsapp.server");
const { processarMensagemWhatsApp, sendWhatsAppInteractiveReply } = W;
const { replyIdToTexto, buildInteractiveFromReply } = await import(
  "../src/server/whatsapp-interactive.server"
);
const { detectLimiteIntent } = await import("../src/server/whatsapp-limites.server");
const { detectFaturaIntent, detectFutureFaturaIntent } = await import(
  "../src/server/whatsapp-faturas.server"
);
const { criarCartaoViaWhatsApp } = await import("../src/server/cartao-cadastro.server");

const tel = "5511999997777";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `nf-${++seq}` });
const tap = (id: string) => send(replyIdToTexto(id, ""));
const cartoesInseridos = () => state.inserts.filter((i) => i.table === "cartoes");
const CARTOES = [
  { id: "c-in", nome: "Inter", user_id: "u1", dia_fechamento: 25, dia_vencimento: 5 },
  { id: "c-c6", nome: "C6", user_id: "u1", dia_fechamento: 10, dia_vencimento: 20 },
];

beforeEach(() => {
  delete process.env.WHATSAPP_CARD_FLOW_ID;
  resetState({ cartoes: CARTOES.map((c) => ({ ...c })) });
  setSystemTime(new Date("2026-09-30T15:00:00Z"));
});
afterEach(() => {
  delete process.env.WHATSAPP_CARD_FLOW_ID;
  setSystemTime();
});

describe("gasto × consulta", () => {
  const gastos = [
    "Gastei 89,90 na farmácia no cartão Nubank",
    "Gastei 89,90 na farmácia no Nubank",
    "Comprei 120 reais de roupa no crédito Nubank",
    "Paguei 49,90 no cartão Inter na padaria",
    "Passei 35 no Nubank no mercado",
  ];
  for (const g of gastos) {
    test(`não é consulta: ${g}`, () => {
      expect(detectLimiteIntent(g)).toBeNull();
      expect(detectFaturaIntent(g)).toBeNull();
      expect(detectFutureFaturaIntent(g)).toBeNull();
    });
  }
  test("consultas continuam consultas", () => {
    expect(detectFaturaIntent("qual a fatura do Nubank?")?.kind).toBe("invoice_card");
    expect(detectLimiteIntent("limite do cartão Nubank")?.kind).toBe("limit_card");
    expect(detectFutureFaturaIntent("próxima fatura do Nubank")?.kind).toBe("future_invoice_card");
    expect(detectLimiteIntent("quanto tenho disponível no Nubank?")?.kind).toBe("limit_card");
  });
  test("consulta de cartão inexistente não vira gasto", async () => {
    const r = await send("qual a fatura do Nubank?");
    expect(r.resposta).toContain('Não encontrei nenhum cartão com o nome "nubank"');
    expect(gastosInserts()).toHaveLength(0);
  });
});

describe("cartão não cadastrado na frase", () => {
  const casos: Array<[string, number, string]> = [
    ["Gastei 89,90 na farmácia no cartão Nubank", 89.9, "Farmácia"],
    ["Gastei 89,90 na farmácia no Nubank", 89.9, "Farmácia"],
    ["Comprei 120 reais de roupa no crédito Nubank", 120, "Roupa"],
    ["Passei 35 no Nubank no mercado", 35, "Mercado"],
  ];
  for (const [frase, valor, desc] of casos) {
    test(`oferece cadastrar: ${frase}`, async () => {
      const r = await send(frase);
      expect(r.resposta).toContain("Não encontrei um cartão Nubank cadastrado. 💳");
      expect(r.resposta).toContain("Quer cadastrá-lo agora?");
      expect(r.resposta).toContain(`em ${desc},`);
      expect(r.resposta).toMatch(new RegExp(`R\\$\\s?${valor.toFixed(2).replace(".", ",")}`));
      const ir = buildInteractiveFromReply(r.resposta);
      expect(ir && "buttons" in ir ? ir.buttons.map((b) => b.id) : []).toEqual([
        "card_new_register",
        "card_new_continue",
        "expense_cancel",
      ]);
      expect(gastosInserts()).toHaveLength(0);
      expect(cartoesInseridos()).toHaveLength(0);
    });
  }

  test("cartão existente: usa o cartão correto", async () => {
    const r = await send("Paguei 49,90 no cartão Inter na padaria");
    expect(r.status).toBe("aguardando_confirmacao");
    expect(r.resposta).toContain("Inter");
    expect(r.resposta).not.toContain("Não encontrei");
    await tap("expense_confirm");
    const row = gastosInserts()[0].row;
    expect(row.cartao_id).toBe("c-in");
    expect(row.valor).toBe(49.9);
    expect(row.fatura_competencia).toBe("2026-11"); // 30/09 > fechamento 25
  });

  test("Cadastrar cartão preserva o gasto e retoma sem pedir de novo", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    const c = await tap("card_new_register");
    expect(c.resposta).toContain("Nubank");
    await send("5000");
    await send("25");
    await send("5");
    const ok = await tap("card_reg_confirm");
    expect(ok.resposta).toMatch(/terminar seu gasto de R\$\s?89,90/);
    expect(gastosInserts()).toHaveLength(0);
    await tap("expense_confirm");
    const row = gastosInserts()[0].row;
    expect(row.valor).toBe(89.9);
    expect(row.data).toBe("2026-09-30");
    expect(row.forma_pagamento).toBe("credito");
    expect(row.cartao_id).toBe(cartoesInseridos()[0].row.id);
    expect(row.fatura_competencia).toBe("2026-11");
  });

  test("Continuar sem cadastrar: pergunta fatura → confirmação → salva só ao confirmar", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    const q = await tap("card_new_continue");
    expect(q.status).toBe("aguardando_fatura_nao_cadastrado");
    expect(q.resposta).toContain("Em qual fatura essa compra vai cair?");
    expect(gastosInserts()).toHaveLength(0);
    const conf = await send("fatura de novembro de 2026");
    expect(conf.status).toBe("aguardando_confirmacao");
    expect(conf.resposta).toContain("• Fatura: Novembro/2026");
    expect(conf.resposta).toMatch(/R\$\s?89,90/);
    expect(gastosInserts()).toHaveLength(0);
    const ok = await tap("expense_confirm");
    expect(ok.status).toBe("salva");
    expect(ok.resposta).not.toContain("Em qual fatura");
    expect(gastosInserts()).toHaveLength(1);
    const row = gastosInserts()[0].row;
    expect(row.invoice_month).toBe("2026-09");
    expect(row.fatura_competencia).toBe("2026-11");
    expect(row.cartao_id).toBeNull();
    expect(row.forma_pagamento).toBe("credito");
    expect(cartoesInseridos()).toHaveLength(0);
  });

  test("Continuar sem cadastrar por texto '2' e resposta inválida pede de novo", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    await send("2");
    const r = await send("qualquer coisa");
    expect(r.status).toBe("aguardando_fatura_nao_cadastrado");
    expect(gastosInserts()).toHaveLength(0);
  });

  test("Cancelar na pergunta da fatura não salva", async () => {
    await send("Gastei 89,90 na farmácia no cartão Nubank");
    await tap("card_new_continue");
    await tap("expense_cancel");
    expect(gastosInserts()).toHaveLength(0);
    expect(cartoesInseridos()).toHaveLength(0);
  });
});

describe("rastreio do envio que abre o Flow", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });
  const outbound = () =>
    state.inserts.filter((i) => i.table === "whatsapp_outbound_messages").map((i) => i.row);

  async function abrirFlow() {
    process.env.WHATSAPP_CARD_FLOW_ID = "123456";
    process.env.WHATSAPP_ACCESS_TOKEN = "t";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
    const out = await send("cadastrar cartão");
    expect(out.graphInteractive).toBeDefined();
    return out.graphInteractive as Record<string, unknown>;
  }

  test("aceito pela Meta: usuário, source, tipo, HTTP, meta id, status", async () => {
    const inter = await abrirFlow();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.FLOW1" }] }), { status: 200 })) as any;
    const r = await sendWhatsAppInteractiveReply(tel, inter);
    expect(r.sent).toBe(true);
    const rows = outbound();
    expect(rows).toHaveLength(1);
    const o = rows[0];
    expect(o.user_id).toBe("u1");
    expect(o.source).toBe("reply_flow");
    expect(o.message_type).toBe("interactive");
    expect(o.http_status).toBe(200);
    expect(o.meta_message_id).toBe("wamid.FLOW1");
    expect(o.status).toBe("accepted");
    // privacidade: só hash/últimos 4 dígitos, nenhum conteúdo do formulário
    expect(o.recipient_last4).toBe("7777");
    const serial = JSON.stringify(o);
    expect(serial).not.toContain(tel);
    expect(serial).not.toContain("flow_token");
    expect(serial).not.toContain(String((inter as any).action.parameters.flow_token));
  });

  test("recusado pela Meta: send_failed com erro e HTTP", async () => {
    const inter = await abrirFlow();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 131009, message: "Invalid flow" } }), {
        status: 400,
      })) as any;
    const r = await sendWhatsAppInteractiveReply(tel, inter);
    expect(r.sent).toBe(false);
    const o = outbound()[0];
    expect(o.source).toBe("reply_flow");
    expect(o.status).toBe("send_failed");
    expect(o.http_status).toBe(400);
    expect(o.meta_message_id).toBeNull();
    expect(String(o.error_code)).toBe("131009");
    expect(o.error_message).toContain("Invalid flow");
  });
});

describe("idempotência concorrente", () => {
  test("dois toques simultâneos em Cadastrar criam 1 cartão", async () => {
    resetState({ cartoes: [] });
    await send("cadastrar cartão");
    await send("Nubank");
    await send("5000");
    await send("25");
    await send("5");
    const [a, b] = await Promise.all([tap("card_reg_confirm"), tap("card_reg_confirm")]);
    expect(cartoesInseridos()).toHaveLength(1);
    for (const r of [a, b]) {
      expect(r.status).not.toBe("erro");
      expect(r.resposta).not.toMatch(/erro|tente novamente/i);
    }
  });

  test("servidor: mesmo pedido em paralelo → 1 criado + 1 já criado", async () => {
    resetState({ cartoes: [] });
    const input = {
      userId: "u1",
      telefone: tel,
      requestKey: "req-concorrente",
      dados: { nome: "Nubank", limite: "5000", diaFechamento: 25, diaVencimento: 5 },
    };
    const rs = await Promise.all([
      criarCartaoViaWhatsApp(input as any),
      criarCartaoViaWhatsApp(input as any),
      criarCartaoViaWhatsApp(input as any),
    ]);
    expect(cartoesInseridos()).toHaveLength(1);
    const kinds = rs.map((r: any) => r.status ?? r.kind).sort();
    expect(kinds.filter((k) => k === "criado")).toHaveLength(1);
    expect(kinds.filter((k) => k === "ja_criado")).toHaveLength(2);
  });
});
