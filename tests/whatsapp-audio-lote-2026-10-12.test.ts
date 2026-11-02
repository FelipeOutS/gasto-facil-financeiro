/**
 * Áudio — etapa 1: frases transcritas seguem o pipeline de texto; vários
 * gastos no mesmo áudio viram uma confirmação de conjunto; nada é salvo sem
 * "confirmar"; retries não duplicam; áudio não confirma comprovante pendente.
 * Dados 100% fictícios (fake do Supabase), sem rede.
 */
import { test, expect, beforeEach, setSystemTime } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks, gastosInserts } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { analisarGastoPorVoz } = await import("../src/server/whatsapp-audio-lote");
const { parseWhatsAppExpenseMessage } = await import("../src/lib/whatsappParser");

const tel = "5511999998888";
let n = 0;
const audio = (texto: string, external_id = `a${++n}`) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id, source: "audio" } as never);
const texto = (t: string, external_id = `t${++n}`) =>
  processarMensagemWhatsApp({ telefone: tel, texto: t, external_id } as never);

beforeEach(() => resetState());

const A = (t: string) => analisarGastoPorVoz(t);
const unico = (t: string) => {
  const r = A(t);
  if (r.kind !== "single") throw new Error(`esperava single, veio ${r.kind}`);
  const p = parseWhatsAppExpenseMessage(r.texto, []);
  return { nome: p.nome, valor: p.valor, data: p.data };
};

test("'Gastei 20 no Uber e 30 na farmácia hoje' (sem 'reais') → 2 itens", () => {
  const r = A("Gastei 20 no Uber e 30 na farmácia hoje");
  expect(r.kind).toBe("lote");
  if (r.kind !== "lote") return;
  expect(r.itens.map((i) => [i.nome, i.valor])).toEqual([
    ["Uber", 20],
    ["Farmácia", 30],
  ]);
  expect(r.itens[0].data).toBe(r.itens[1].data);
  expect(r.formaPagamento).toBeNull();
});

test("três gastos com vírgula, centavos, 'ontem' e pix", () => {
  const r = A("gastei 20 no Uber, 30 na farmácia e 15,50 no café ontem no pix");
  expect(r.kind === "lote" && r.itens.map((i) => i.valor)).toEqual([20, 30, 15.5]);
  expect(r.kind === "lote" && r.formaPagamento).toBe("pix");
});

test("valores com 'R$' e 'reais' continuam sendo separados", () => {
  expect(A("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje").kind).toBe("lote");
  const r = A("gastei 20 reais no Uber e 30 reais na farmácia hoje");
  expect(r.kind === "lote" && r.itens.map((i) => i.valor)).toEqual([20, 30]);
});

test("'Comprei 2 pizzas por 50 reais' → um gasto de R$ 50 (2 é quantidade)", () => {
  expect(unico("Comprei 2 pizzas por 50 reais")).toMatchObject({ nome: "Pizzas", valor: 50 });
  expect(unico("comprei 2 pizzas por 50")).toMatchObject({ valor: 50 });
});

test("'dia 15/10 gastei 20 no Uber' → um gasto de R$ 20 em 15/10", () => {
  const r = unico("dia 15/10 gastei 20 no Uber");
  expect(r.valor).toBe(20);
  expect(r.nome).toBe("Uber");
  expect(r.data.slice(5)).toBe("10-15");
});

test("'comprei 2 pizzas' → pede o valor, sem inventar", () => {
  expect(A("comprei 2 pizzas").kind).toBe("ask_value");
});

test("parcelas e 'cartão final 1234' nunca viram valor", () => {
  expect(A("paguei 3 parcelas de 100 na loja").kind).toBe("ask_value");
  expect(unico("gastei 50 no cartão final 1234").valor).toBe(50);
});

test("'dia 30' sem mês, ainda no futuro deste mês → ambíguo, pergunta em vez de adivinhar", () => {
  setSystemTime(new Date("2026-10-12T15:00:00Z"));
  try {
    expect(A("gastei 20 no uber dia 30").kind).toBe("unsafe");
  } finally {
    setSystemTime();
  }
});

test("'gastei 45 de mercado ontem' → R$ 45 ontem", () => {
  const r = unico("gastei 45 de mercado ontem");
  expect(r).toMatchObject({ nome: "Mercado", valor: 45 });
  const ontem = new Date(Date.parse(parseWhatsAppExpenseMessage("R$ 1,00 x hoje", []).data) - 86400000)
    .toISOString()
    .slice(0, 10);
  expect(r.data).toBe(ontem);
});

test("perguntas e receitas não passam pela leitura de gasto por voz", () => {
  expect(A("quanto gastei em 2026").kind).toBe("passthrough");
  expect(A("recebi 2300 de salário em agosto").kind).toBe("passthrough");
});

test("gasto e receita no mesmo áudio não são separados às cegas", () => {
  expect(A("gastei 20 no uber e recebi 100").kind).toBe("unsafe");
});

test("texto DIGITADO não usa a leitura de voz: o parser global continua igual", async () => {
  // Mesma frase por texto segue o fluxo antigo (um lançamento só).
  const r = await texto("gastei 20 no Uber e 30 na farmácia hoje");
  expect(r.status).not.toBe("aguardando_forma_lote_audio");
});

test("áudio sem 'reais' com 2 gastos → lista no fluxo real, nada salvo", async () => {
  const r = await audio("Gastei 20 no Uber e 30 na farmácia hoje");
  expect(r.status).toBe("aguardando_forma_lote_audio");
  expect(r.resposta).toMatch(/1\. Uber — R\$\s20,00/);
  expect(r.resposta).toMatch(/2\. Farmácia — R\$\s30,00/);
  expect(gastosInserts()).toHaveLength(0);
  await texto("pix");
  await texto("confirmar", "c-x");
  await texto("confirmar", "c-x");
  expect(gastosInserts().map((g) => g.row.valor)).toEqual([20, 30]);
});

test("áudio 'comprei 2 pizzas' no fluxo real pede valor e não salva", async () => {
  const r = await audio("comprei 2 pizzas");
  expect(r.resposta).toContain("Não entendi o valor");
  expect(gastosInserts()).toHaveLength(0);
});

test("áudio 'Comprei 2 pizzas por 50 reais' no fluxo real registra R$ 50 (pendente de confirmação)", async () => {
  const r = await audio("Comprei 2 pizzas por R$ 50,00");
  expect(r.resposta).toMatch(/R\$\s50,00/);
  expect(r.resposta).not.toMatch(/R\$\s2,00/);
  expect(gastosInserts()).toHaveLength(0);
});

test("áudio com 2 gastos pede pagamento, mostra a lista e NÃO salva nada", async () => {
  const r = await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje");
  expect(r.status).toBe("aguardando_forma_lote_audio");
  expect(r.resposta).toMatch(/1\. Uber — R\$\s20,00/);
  expect(r.resposta).toMatch(/2\. Farmácia — R\$\s30,00/);
  expect(gastosInserts()).toHaveLength(0);
});

test("lote: pix → confirmação → confirmar salva exatamente 2 gastos", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje");
  const c = await texto("pix");
  expect(c.status).toBe("aguardando_confirmacao_lote_audio");
  expect(c.resposta).toContain("Pagamento: Pix (todos)");
  expect(c.resposta).toContain("Confirmar");
  expect(gastosInserts()).toHaveLength(0);
  const s = await texto("confirmar");
  expect(s.status).toBe("salva");
  const g = gastosInserts().map((i) => [i.row.descricao, i.row.valor, i.row.forma_pagamento]);
  expect(g).toEqual([
    ["Uber", 20],
    ["Farmácia", 30],
  ].map(([d, v]) => [d, v, "pix"]));
});

test("lote: retry do mesmo 'confirmar' e um segundo 'confirmar' não duplicam", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje no pix");
  await texto("confirmar", "conf-1");
  await texto("confirmar", "conf-1"); // reentrega do webhook
  await texto("confirmar", "conf-2"); // usuário repete
  expect(gastosInserts()).toHaveLength(2);
});

test("comprovante pendente: 'confirmar' por áudio não salva a foto", async () => {
  const row = {
    id: "m-img",
    external_id: "img-1",
    user_id: "u1",
    telefone: tel,
    status: "img_aguardando_confirmacao",
    recebida_em: new Date().toISOString(),
    parsed: {
      kind: "imagem_comprovante",
      descricao: "Mercado X",
      valor: 50,
      data: "2026-10-12",
      categoriaId: "cat-mer",
      categoriaLabel: "Mercado",
      formaPagamento: "pix",
      mensagemOriginal: "(foto)",
    },
  };
  (state.generic as Record<string, unknown[]>).whatsapp_messages = [row];
  state.inserts.push({ table: "whatsapp_messages", row });
  state.pendingRow = { ...row, session: row.parsed };
  const r = await audio("confirmar");
  expect(r.resposta).toContain("comprovante aguardando resposta");
  expect(gastosInserts()).toHaveLength(0);
});

test("lote: cancelar não salva nada", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje no pix");
  await texto("cancelar");
  expect(gastosInserts()).toHaveLength(0);
});

test("lote: ajustar não salva e pede reenvio corrigido", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje no pix");
  const r = await texto("ajustar");
  expect(r.resposta).toContain("não salvei nada");
  expect(gastosInserts()).toHaveLength(0);
});

test("lote: resposta sem sentido não salva e não entra em loop da mesma mensagem", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje no pix");
  const r = await texto("banana");
  expect(r.resposta).toContain("Responda Confirmar, Ajustar ou Cancelar");
  expect(gastosInserts()).toHaveLength(0);
});

test("lote: crédito pede um gasto por vez (cartão de cada item é necessário)", async () => {
  await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje");
  const r = await texto("crédito");
  expect(r.status).toBe("aguardando_forma_lote_audio");
  expect(gastosInserts()).toHaveLength(0);
});

test("áudio simples 'gastei 45 de mercado ontem' pergunta pagamento e não salva", async () => {
  const r = await audio("gastei R$ 45,00 de mercado ontem");
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(gastosInserts()).toHaveLength(0);
});

test("'confirmar' antes de dizer o pagamento NÃO descarta o gasto pendente", async () => {
  await audio("gastei R$ 45,00 de mercado ontem");
  const r = await texto("confirmar");
  expect(r.status).toBe("aguardando_forma_pagamento");
  const p = await texto("pix");
  expect(p.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

test("datas relativas: 'ontem' é um dia antes de 'hoje'", () => {
  const r = A("gastei R$ 10,00 no pão e R$ 5,00 no café ontem");
  const h = A("gastei R$ 10,00 no pão e R$ 5,00 no café hoje");
  if (r.kind !== "lote" || h.kind !== "lote") throw new Error("esperava lote");
  const diff = (Date.parse(h.itens[0].data) - Date.parse(r.itens[0].data)) / 86400000;
  expect(diff).toBe(1);
});

test("sem vínculo: áudio de outro número não cria sessão nem gasto", async () => {
  state.linkData = null;
  const r = await audio("gastei R$ 20,00 no Uber e R$ 30,00 na farmácia hoje no pix");
  expect(r.status).not.toBe("aguardando_confirmacao_lote_audio");
  expect(gastosInserts()).toHaveLength(0);
});
