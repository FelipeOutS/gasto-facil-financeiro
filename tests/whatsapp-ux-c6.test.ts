/**
 * WA-C6 — Testes da experiência conversacional do WhatsApp.
 *
 * Cobertura:
 *  - Boas-vindas e ajuda mencionam papel do WhatsApp + site/app.
 *  - Menu numerado 1..8.
 *  - Dispatcher: número "3" cai no fluxo de contas pendentes; "8" → ajuda.
 *  - "comandos" é reconhecido como menu (regressão WA-G3).
 *  - Detector de ordinais (resolveOrdinal puro, sem banco).
 *  - Memória curta via pipeline: listar contas + "paguei a segunda".
 *  - Não há regressão em sessão de confirmação (texto desconhecido continua
 *    com a mensagem neutra existente).
 *  - Reset de sessão limpa contexto curto.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { monthRangeInAppTz } = await import(
  "../src/server/contas-vencimento.server"
);
const MONTH = monthRangeInAppTz();
const {
  detectMenuOption,
  dispatchMenuOption,
  detectConversationalIntent,
  _resetConversationalCache,
} = await import("../src/server/whatsapp-consultas.server");
const {
  recordContas,
  resolveOrdinal,
  clear: shortClear,
  _resetShortContext,
} = await import("../src/server/whatsapp-short-context.server");

const tel = "5511999998888";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function daysAheadISO(n: number): string {
  const [y, m, d] = todayISO().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

beforeEach(() => {
  resetState();
  _resetConversationalCache();
  _resetShortContext();
});

// =====================================================================
// Parte 1 — Boas-vindas / Ajuda
// =====================================================================

test("WA-C6: saudação posiciona WhatsApp como atalho e cita site/app", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "oi", external_id: "c6-bv-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Gasto Inteligente");
  expect(r.resposta).toMatch(/site|app/i);
  expect(r.resposta).toContain("menu");
});

test("WA-C6: 'menu' devolve menu numerado 1..8 com itens chave", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "menu", external_id: "c6-aj-1",
  });
  for (const linha of [
    "1. Registrar gasto",
    "2. Cadastrar uma conta",
    "3. Ver contas pendentes",
    "4. Ver contas atrasadas",
    "5. Marcar conta como paga",
    "6. Editar uma conta",
    "7. Cancelar uma conta",
    "8. Ajuda",
  ]) {
    expect(r.resposta).toContain(linha);
  }
});

test("WA-C6: 'ajuda' devolve exemplos práticos e NÃO o menu numerado", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "ajuda", external_id: "c6-aj-2",
  });
  expect(r.status).toBe("consulta");
  // contém exemplos práticos
  expect(r.resposta).toMatch(/exemplos?/i);
  expect(r.resposta).toContain("Uber 29,90");
  expect(r.resposta).toMatch(/Paguei a internet/i);
  // NÃO é a lista numerada do menu
  expect(r.resposta).not.toContain("1. Registrar gasto");
  expect(r.resposta).not.toContain("8. Ajuda");
});

test("WA-C6: 'comandos' devolve lista curta de atalhos (não menu, não ajuda)", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "comandos", external_id: "c6-cmd-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/Comandos r[aá]pidos/i);
  expect(r.resposta).toContain("menu");
  expect(r.resposta).toContain("ajuda");
  expect(r.resposta).toContain("minhas contas");
  // não cita exemplos longos nem opções numeradas do menu
  expect(r.resposta).not.toContain("1. Registrar gasto");
  expect(r.resposta).not.toContain("Uber 29,90");
});

test("WA-C6: detectConversationalIntent diferencia menu, ajuda e comandos", () => {
  expect(detectConversationalIntent("menu")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("ajuda")).toBe("ajuda_whatsapp");
  expect(detectConversationalIntent("comandos")).toBe("comandos_whatsapp");
});

// =====================================================================
// Parte 2 — Menu numerado
// =====================================================================

test("WA-C6 detectMenuOption: aceita '1'..'8' e variações", () => {
  expect(detectMenuOption("1")).toBe(1);
  expect(detectMenuOption(" 3 ")).toBe(3);
  expect(detectMenuOption("8.")).toBe(8);
  expect(detectMenuOption("9")).toBeNull();
  expect(detectMenuOption("0")).toBeNull();
  expect(detectMenuOption("11")).toBeNull();
  expect(detectMenuOption("oi")).toBeNull();
});

test("WA-C6 dispatchMenuOption: 1/5/6/7 são guidance; 3/4/8 são rewrite", () => {
  expect(dispatchMenuOption(1)?.kind).toBe("guidance");
  expect(dispatchMenuOption(2)?.kind).toBe("guidance");
  expect(dispatchMenuOption(3)).toEqual({ kind: "rewrite", texto: "minhas contas" });
  expect(dispatchMenuOption(4)).toEqual({ kind: "rewrite", texto: "contas atrasadas" });
  expect(dispatchMenuOption(5)?.kind).toBe("guidance");
  expect(dispatchMenuOption(8)).toEqual({ kind: "rewrite", texto: "ajuda" });
});

test("WA-C6: enviar '1' fora de sessão responde com guia de registro de gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "1", external_id: "c6-num-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/registrar um gasto/i);
});

test("WA-C6: enviar '8' fora de sessão dispara ajuda completa", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "8", external_id: "c6-num-8",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("1. Registrar gasto");
  expect(r.resposta).toContain("8. Ajuda");
});

test("WA-C6: '3' fora de sessão entra no fluxo de contas (rewrite → minhas contas)", async () => {
  resetState({
    contas: [
      {
        id: "cap-1", user_id: "u1", nome: "Internet",
        valor: 119.9, data_vencimento: `${MONTH.yearMonth}-05`,
        status: "pendente", data_pagamento: null,
      },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "3", external_id: "c6-num-3",
  });
  // Cai no handler de contas existente — não é uma resposta genérica.
  expect(r.resposta).toMatch(/Internet|compromisso|vencimento/i);
});

test("WA-C6: '1' DURANTE sessão de confirmação NÃO dispara menu (regressão)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado 30,00 hoje no pix", external_id: "c6-sess-a",
  });
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "1", external_id: "c6-sess-b",
  });
  // Não devolveu a guia de registro nem o menu — continua na sessão.
  expect(r.resposta).not.toMatch(/registrar um gasto.*Uber 29,90/is);
});

// =====================================================================
// Parte 5 — Memória curta de lista (ordinal rewriting)
// =====================================================================

test("WA-C6 resolveOrdinal: nada retornado quando não há contexto", () => {
  expect(resolveOrdinal(tel, "pagar a segunda")).toBeNull();
});

test("WA-C6 resolveOrdinal: 'pagar a segunda' → 'paguei <nome>'", () => {
  recordContas(tel, [{ nome: "Internet" }, { nome: "Aluguel" }, { nome: "Academia" }]);
  expect(resolveOrdinal(tel, "pagar a segunda")).toBe("paguei Aluguel");
  expect(resolveOrdinal(tel, "quitei a 3")).toBe("paguei Academia");
  expect(resolveOrdinal(tel, "cancela a primeira")).toBe("cancelar Internet");
  expect(resolveOrdinal(tel, "editar a terceira")).toBe("editar Academia");
});

test("WA-C6 resolveOrdinal: 'paguei' sozinho com 1 item destaca aquele item", () => {
  recordContas(tel, [{ nome: "Internet" }]);
  expect(resolveOrdinal(tel, "paguei")).toBe("paguei Internet");
  expect(resolveOrdinal(tel, "ja paguei")).toBe("paguei Internet");
});

test("WA-C6 resolveOrdinal: 'paguei' sozinho com vários itens NÃO resolve", () => {
  recordContas(tel, [{ nome: "Internet" }, { nome: "Aluguel" }]);
  expect(resolveOrdinal(tel, "paguei")).toBeNull();
});

test("WA-C6 resolveOrdinal: clear() limpa contexto", () => {
  recordContas(tel, [{ nome: "Internet" }]);
  shortClear(tel);
  expect(resolveOrdinal(tel, "paguei")).toBeNull();
});

test("WA-C6 pipeline: listar contas grava contexto e 'paguei a primeira' dispara baixa", async () => {
  resetState({
    contas: [
      {
        id: "cap-1", user_id: "u1", nome: "Internet",
        valor: 119.9, data_vencimento: `${MONTH.yearMonth}-10`,
        status: "pendente", data_pagamento: null,
      },
      {
        id: "cap-2", user_id: "u1", nome: "Aluguel",
        valor: 1500, data_vencimento: `${MONTH.yearMonth}-15`,
        status: "pendente", data_pagamento: null,
      },
    ],
  });
  // 1) Listar
  const r1 = await processarMensagemWhatsApp({
    telefone: tel, texto: "minhas contas", external_id: "c6-mem-1",
  });
  expect(r1.resposta).toContain("Internet");

  // 2) "paguei a primeira" — rewrite para "paguei Internet" e cai no handler.
  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "paguei a primeira", external_id: "c6-mem-2",
  });
  // Espera-se que o handler de baixa tenha encontrado a conta Internet.
  expect(r2.resposta).toMatch(/Internet/i);
});
