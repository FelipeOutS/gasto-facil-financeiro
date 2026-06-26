/**
 * WA-F2 — Testes de detalhamento de fatura (itens, recentes, maiores,
 * paginação). Reaproveita o mock compartilhado em ./_whatsapp-fake.
 *
 * Cobre:
 *  - detecção dos novos intents (`invoice_items|recent|largest`);
 *  - handler para um cartão e para vários cartões (desambiguação);
 *  - ordenação por data e por valor;
 *  - paginação ("ver mais", "voltar", "cancelar");
 *  - regras de exclusão (sem cartão, fora do ciclo, outro usuário);
 *  - parcelas só quando há estrutura confiável;
 *  - consulta não cria gasto/cartão/receita/memória;
 *  - consulta não interrompe sessão pendente;
 *  - log seguro `wa_invoice_detail_query` sem PII.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const {
  detectFaturaIntent,
  handleFaturaIntent,
  handleFaturaDetailIntent,
  handleFaturaPagination,
  detectPaginationCommand,
  cleanDescricaoDisplay,
} = await import("../src/server/whatsapp-faturas.server");
const { getItensFaturaAtualPorCartao } = await import(
  "../src/server/cartao-fatura.server"
);
const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

const NBSP = "\u00a0";
const BRL = (s: string) => s.replace(/R\$ /g, `R$${NBSP}`);

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoFuture(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const baseCartoes = () => [
  { id: "c-nu", user_id: "u1", nome: "Nubank", banco: "Nubank",
    limite_total: 2000, dia_fechamento: 1, dia_vencimento: 10 },
];
const baseDoisCartoes = () => [
  { id: "c-nu", user_id: "u1", nome: "Nubank", banco: "Nubank",
    limite_total: 2000, dia_fechamento: 1, dia_vencimento: 10 },
  { id: "c-it", user_id: "u1", nome: "Inter", banco: "Inter",
    limite_total: 3000, dia_fechamento: 1, dia_vencimento: 10 },
];

// ---------------------------------------------------------------- detect

describe("detectFaturaIntent — WA-F2", () => {
  it("reconhece itens da fatura", () => {
    expect(detectFaturaIntent("o que tem na minha fatura?")?.kind).toBe("invoice_items");
    expect(detectFaturaIntent("quais compras estão na minha fatura?")?.kind).toBe("invoice_items");
    expect(detectFaturaIntent("me mostra as compras do Nubank")?.kind).toBe("invoice_items");
    expect(detectFaturaIntent("ver fatura do Inter")?.kind).toBe("invoice_items");
  });
  it("reconhece últimas compras", () => {
    expect(detectFaturaIntent("últimas compras do cartão")?.kind).toBe("invoice_recent");
    expect(detectFaturaIntent("últimas compras do Nubank")?.kind).toBe("invoice_recent");
    expect(detectFaturaIntent("compras recentes do cartão")?.kind).toBe("invoice_recent");
  });
  it("reconhece maiores compras", () => {
    expect(detectFaturaIntent("maiores compras da fatura")?.kind).toBe("invoice_largest");
    expect(detectFaturaIntent("onde gastei mais no cartão?")?.kind).toBe("invoice_largest");
    expect(detectFaturaIntent("maiores gastos do Nubank")?.kind).toBe("invoice_largest");
  });
  it("extrai termo de cartão em compras", () => {
    const a = detectFaturaIntent("compras do Nubank");
    expect(a?.kind).toBe("invoice_items");
    if (a && (a.kind === "invoice_items" || a.kind === "invoice_recent" || a.kind === "invoice_largest")) {
      expect(a.termo).toBe("nubank");
    }
  });
  it("ignora frases neutras", () => {
    expect(detectFaturaIntent("Uber 29,90")).toBeNull();
    expect(detectFaturaIntent("comprei pão")).toBeNull();
  });
});

describe("detectPaginationCommand (puro)", () => {
  it("aceita variações de avanço", () => {
    expect(detectPaginationCommand("ver mais")).toBe("next");
    expect(detectPaginationCommand("mais")).toBe("next");
    expect(detectPaginationCommand("próximas compras")).toBe("next");
    expect(detectPaginationCommand("continuar")).toBe("next");
  });
  it("aceita voltar e cancelar", () => {
    expect(detectPaginationCommand("voltar")).toBe("prev");
    expect(detectPaginationCommand("anterior")).toBe("prev");
    expect(detectPaginationCommand("cancelar")).toBe("cancel");
  });
  it("ignora frases livres com 'mais'", () => {
    expect(detectPaginationCommand("comprei mais um café")).toBeNull();
    expect(detectPaginationCommand("isso é o que mais quero ver")).toBeNull();
  });
});

describe("cleanDescricaoDisplay (puro)", () => {
  it("limpa resíduos sem inventar dados", () => {
    expect(cleanDescricaoDisplay("UBER *TRIP")).toBe("Uber");
    expect(cleanDescricaoDisplay("IFOOD*PEDIDO")).toBe("iFood");
    expect(cleanDescricaoDisplay("Mercado Central, .")).toBe("Mercado Central");
    expect(cleanDescricaoDisplay("")).toBe("Compra no cartão");
    expect(cleanDescricaoDisplay(null)).toBe("Compra no cartão");
  });
});

// ---------------------------------------------------------------- helper

describe("getItensFaturaAtualPorCartao — regras de exclusão", () => {
  beforeEach(() => { resetState({ cartoes: baseCartoes() }); });

  it("gasto sem cartão NÃO entra", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: null, valor: 50,
        data: isoToday(), forma_pagamento: "debito", confirmado: true,
        invoice_month: null, descricao: "X", estabelecimento: "X" },
    ];
    const itens = await getItensFaturaAtualPorCartao("u1", state.cartoesData[0] as never);
    expect(itens).toEqual([]);
  });

  it("gasto futuro de outra fatura (invoice_month diferente) NÃO entra", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 80,
        data: isoFuture(40), forma_pagamento: "credito", confirmado: true,
        invoice_month: "2099-12", descricao: "Próx", estabelecimento: "Próx" },
    ];
    const itens = await getItensFaturaAtualPorCartao("u1", state.cartoesData[0] as never);
    expect(itens).toEqual([]);
  });

  it("gasto em dinheiro/Pix/débito NÃO entra", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 10,
        data: isoToday(), forma_pagamento: "dinheiro", confirmado: true,
        invoice_month: null, descricao: "A", estabelecimento: "A" },
      { id: "g2", user_id: "u1", cartao_id: "c-nu", valor: 20,
        data: isoToday(), forma_pagamento: "pix", confirmado: true,
        invoice_month: null, descricao: "B", estabelecimento: "B" },
      { id: "g3", user_id: "u1", cartao_id: "c-nu", valor: 30,
        data: isoToday(), forma_pagamento: "debito", confirmado: true,
        invoice_month: null, descricao: "C", estabelecimento: "C" },
    ];
    const itens = await getItensFaturaAtualPorCartao("u1", state.cartoesData[0] as never);
    expect(itens).toEqual([]);
  });

  it("parcela só aparece quando parcela_atual e total_parcelas são consistentes", async () => {
    state.gastosData = [
      // Confiável → exibe "2/6"
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 120,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Loja X", estabelecimento: "Loja X",
        parcela_atual: 2, total_parcelas: 6 },
      // Apenas total_parcelas → não confiável
      { id: "g2", user_id: "u1", cartao_id: "c-nu", valor: 50,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Loja Y", estabelecimento: "Loja Y",
        parcela_atual: null, total_parcelas: 3 },
      // Inconsistente (atual > total) → não confiável
      { id: "g3", user_id: "u1", cartao_id: "c-nu", valor: 70,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Loja Z", estabelecimento: "Loja Z",
        parcela_atual: 9, total_parcelas: 3 },
    ];
    const itens = await getItensFaturaAtualPorCartao("u1", state.cartoesData[0] as never);
    expect(itens).toHaveLength(3);
    const byId = Object.fromEntries(itens.map((i) => [i.id, i]));
    expect(byId["g1"].parcelaAtual).toBe(2);
    expect(byId["g1"].totalParcelas).toBe(6);
    expect(byId["g2"].parcelaAtual).toBeNull();
    expect(byId["g3"].parcelaAtual).toBeNull();
  });
});

// ---------------------------------------------------------------- handler

describe("handleFaturaDetailIntent — fluxo principal", () => {
  beforeEach(() => { resetState({ cartoes: baseCartoes() }); });

  it("usuário com um cartão recebe lista de compras (recentes, ordenadas)", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 152.8,
        data: isoDaysAgo(1), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Mercado Central", estabelecimento: "Mercado" },
      { id: "g2", user_id: "u1", cartao_id: "c-nu", valor: 34.9,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "UBER *TRIP", estabelecimento: "Uber" },
      { id: "g3", user_id: "u1", cartao_id: "c-nu", valor: 28.5,
        data: isoDaysAgo(2), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Farmácia", estabelecimento: "Drogasil" },
    ];
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_items", termo: null });
    expect(out.status).toBe("answered");
    // Ordenação: hoje > ontem > anteontem
    const linhas = out.resposta.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas[0]).toContain("Uber");
    expect(linhas[1]).toContain("Mercado Central");
    expect(linhas[2]).toContain("Farmácia");
    expect(out.resposta).toContain(BRL("R$ 34,90"));
  });

  it("vários cartões ativos → pede desambiguação (sem valor/limite)", async () => {
    state.cartoesData = baseDoisCartoes();
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 50,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "A", estabelecimento: "A" },
      { id: "g2", user_id: "u1", cartao_id: "c-it", valor: 70,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "B", estabelecimento: "B" },
    ];
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_items", termo: null });
    expect(out.status).toBe("ambiguous_card");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain("Inter");
    // Não vaza valor nem últimos dígitos
    expect(out.resposta).not.toMatch(/R\$/);
    expect(out.resposta).not.toMatch(/\d{4}/);
  });

  it("cartão específico só retorna gastos daquele cartão", async () => {
    state.cartoesData = baseDoisCartoes();
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 100,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Mercado", estabelecimento: "Mercado" },
      { id: "g2", user_id: "u1", cartao_id: "c-it", valor: 500,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Loja", estabelecimento: "Loja" },
    ];
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_items", termo: "nubank" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Mercado");
    expect(out.resposta).not.toContain("Loja");
    expect(out.resposta).toContain(BRL("R$ 100,00"));
    expect(out.resposta).not.toContain(BRL("R$ 500,00"));
  });

  it("maiores compras ordenam por valor (desc) e usam numeração", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 50,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Pequeno", estabelecimento: "P" },
      { id: "g2", user_id: "u1", cartao_id: "c-nu", valor: 420,
        data: isoDaysAgo(3), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Loja Exemplo", estabelecimento: "L" },
      { id: "g3", user_id: "u1", cartao_id: "c-nu", valor: 80,
        data: isoDaysAgo(1), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Médio", estabelecimento: "M" },
    ];
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_largest", termo: null });
    expect(out.status).toBe("answered");
    const linhas = out.resposta.split("\n").filter((l) => /^\d+\./.test(l));
    expect(linhas[0]).toContain("Loja Exemplo");
    expect(linhas[1]).toContain("Médio");
    expect(linhas[2]).toContain("Pequeno");
  });

  it("respeita máximo de 5 itens por página e oferece 'ver mais'", async () => {
    state.gastosData = Array.from({ length: 7 }, (_, i) => ({
      id: `g${i + 1}`,
      user_id: "u1",
      cartao_id: "c-nu",
      valor: 10 + i,
      data: isoDaysAgo(i),
      forma_pagamento: "credito",
      confirmado: true,
      invoice_month: null,
      descricao: `Compra ${i + 1}`,
      estabelecimento: `E${i + 1}`,
    }));
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_recent", termo: null });
    expect(out.status).toBe("answered");
    const linhas = out.resposta.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas).toHaveLength(5);
    expect(out.resposta).toContain("ver mais");
    expect("nextSession" in out).toBe(true);
  });

  it("não inclui gasto de outro usuário", async () => {
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 100,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Meu", estabelecimento: "X" },
      { id: "g2", user_id: "u2", cartao_id: "c-nu", valor: 999,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Outro", estabelecimento: "Y" },
    ];
    const out = await handleFaturaDetailIntent("u1", { kind: "invoice_items", termo: null });
    expect(out.resposta).toContain("Meu");
    expect(out.resposta).not.toContain("Outro");
    expect(out.resposta).not.toContain(BRL("R$ 999,00"));
  });
});

// ---------------------------------------------------------------- pagination

describe("handleFaturaPagination — paginação", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = Array.from({ length: 7 }, (_, i) => ({
      id: `g${i + 1}`, user_id: "u1", cartao_id: "c-nu",
      valor: 10 + i, data: isoDaysAgo(i),
      forma_pagamento: "credito", confirmado: true, invoice_month: null,
      descricao: `Compra ${i + 1}`, estabelecimento: `E${i + 1}`,
    }));
  });

  it("ver mais abre próxima página", async () => {
    const out = await handleFaturaPagination(
      "u1", { kind: "consulta_fatura", cartaoId: "c-nu", mode: "recentes", page: 0 }, "next",
    );
    expect(out.status).toBe("answered");
    const linhas = out.resposta.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas).toHaveLength(2); // 7 - 5 = 2 na pág 1
    expect("nextSession" in out).toBe(false);
  });

  it("voltar retorna à página anterior", async () => {
    const out = await handleFaturaPagination(
      "u1", { kind: "consulta_fatura", cartaoId: "c-nu", mode: "recentes", page: 1 }, "prev",
    );
    expect(out.status).toBe("answered");
    const linhas = out.resposta.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas).toHaveLength(5);
  });

  it("voltar da primeira página → resposta neutra", async () => {
    const out = await handleFaturaPagination(
      "u1", { kind: "consulta_fatura", cartaoId: "c-nu", mode: "recentes", page: 0 }, "prev",
    );
    expect(out.status).toBe("no_more_items");
  });

  it("ver mais sem itens adicionais → no_more_items", async () => {
    const out = await handleFaturaPagination(
      "u1", { kind: "consulta_fatura", cartaoId: "c-nu", mode: "recentes", page: 1 }, "next",
    );
    expect(out.status).toBe("no_more_items");
  });
});

// ---------------------------------------------------------------- pipeline

describe("Pipeline WhatsApp — WA-F2", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 100,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Mercado", estabelecimento: "M" },
    ];
  });

  it("'o que tem na minha fatura' responde sem criar gasto/cartão/receita", async () => {
    const before = state.inserts.length;
    const out = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "o que tem na minha fatura?",
      external_id: "ext-d-1",
      recebida_em: new Date().toISOString(),
    });
    expect(out.status === "consulta" || out.status === "pendente").toBe(true);
    expect(out.resposta).toContain("Mercado");
    const novos = state.inserts.slice(before);
    expect(novos.find((i) => i.table === "gastos")).toBeUndefined();
    expect(novos.find((i) => i.table === "receitas")).toBeUndefined();
    expect(novos.find((i) => i.table === "cartoes")).toBeUndefined();
  });

  it("não interrompe sessão de gasto pendente", async () => {
    await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "Uber 29,90",
      external_id: "ext-g-1",
      recebida_em: new Date().toISOString(),
    });
    const pendingAntes = state.pendingRow;
    expect(pendingAntes).not.toBeNull();
    await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "o que tem na minha fatura?",
      external_id: "ext-d-2",
      recebida_em: new Date().toISOString(),
    });
    expect(state.pendingRow).not.toBeNull();
    expect(state.pendingRow?.status).toBe(pendingAntes?.status);
  });

  it("paginação ver mais funciona via pipeline + sessão temporária", async () => {
    state.gastosData = Array.from({ length: 8 }, (_, i) => ({
      id: `g${i + 1}`, user_id: "u1", cartao_id: "c-nu",
      valor: 10 + i, data: isoDaysAgo(i),
      forma_pagamento: "credito", confirmado: true, invoice_month: null,
      descricao: `Compra ${i + 1}`, estabelecimento: `E${i + 1}`,
    }));
    const r1 = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "últimas compras do cartão",
      external_id: "ext-p-1",
      recebida_em: new Date().toISOString(),
    });
    expect(r1.status).toBe("pendente");
    expect(state.pendingRow?.status).toBe("aguardando_consulta_fatura");
    const parsed = state.pendingRow?.parsed as Record<string, unknown>;
    expect(parsed?.kind).toBe("consulta_fatura");
    // PII minimization: não persiste valor, descrição, telefone, etc.
    expect(parsed?.cartaoId).toBe("c-nu");
    expect("descricao" in parsed!).toBe(false);
    expect("valor" in parsed!).toBe(true); // o esquema base mantém valor=0 vazio
    expect(parsed?.valor).toBe(0);

    const r2 = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "ver mais",
      external_id: "ext-p-2",
      recebida_em: new Date().toISOString(),
    });
    expect(r2.status).toBe("consulta");
    const linhas = r2.resposta.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas).toHaveLength(3); // 8 - 5
  });

  it("cancelar encerra a paginação", async () => {
    state.gastosData = Array.from({ length: 8 }, (_, i) => ({
      id: `g${i + 1}`, user_id: "u1", cartao_id: "c-nu",
      valor: 10 + i, data: isoDaysAgo(i),
      forma_pagamento: "credito", confirmado: true, invoice_month: null,
      descricao: `Compra ${i + 1}`, estabelecimento: `E${i + 1}`,
    }));
    await processarMensagemWhatsApp({
      telefone: "5511999998888", texto: "últimas compras",
      external_id: "ext-c-1", recebida_em: new Date().toISOString(),
    });
    const r = await processarMensagemWhatsApp({
      telefone: "5511999998888", texto: "cancelar",
      external_id: "ext-c-2", recebida_em: new Date().toISOString(),
    });
    // Aceita tanto "consulta" (cancelar local) quanto "cancelada"
    // (reset global captura primeiro). Ambos encerram a paginação.
    expect(["consulta", "cancelada"]).toContain(r.status);
    expect(state.pendingRow).toBeNull();
  });
});

// ---------------------------------------------------------------- log

describe("Log seguro wa_invoice_detail_query", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = [
      { id: "g1", user_id: "u1", cartao_id: "c-nu", valor: 152.8,
        data: isoToday(), forma_pagamento: "credito", confirmado: true,
        invoice_month: null, descricao: "Mercado Central", estabelecimento: "M" },
    ];
  });

  it("não inclui valor, descrição, cartão, userId, telefone ou pergunta", async () => {
    const captured: unknown[] = [];
    const orig = console.info;
    console.info = mock((...args: unknown[]) => { captured.push(...args); });
    try {
      await handleFaturaDetailIntent("u1", { kind: "invoice_items", termo: null });
    } finally {
      console.info = orig;
    }
    const logs = captured.filter((e): e is { event?: unknown } =>
      typeof e === "object" && e !== null && "event" in e,
    );
    const detalheLog = logs.find((e) => (e as { event?: unknown }).event === "wa_invoice_detail_query");
    expect(detalheLog).toBeDefined();
    const flat = JSON.stringify(detalheLog);
    expect(flat).not.toContain("152");
    expect(flat).not.toContain("Mercado");
    expect(flat).not.toContain("Nubank");
    expect(flat).not.toContain("u1");
    expect(flat).not.toContain("5511");
    expect(flat).not.toContain("o que tem");
  });
});

// Avoid TS unused warning for handleFaturaIntent in this file
void handleFaturaIntent;
