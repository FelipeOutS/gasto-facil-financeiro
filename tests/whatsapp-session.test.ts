/**
 * Testes da máquina de estados conversacional do WhatsApp.
 * Cobre:
 *  - persistência de contexto entre mensagens
 *  - fluxo cartão cadastrado
 *  - fluxo cartão não cadastrado (sem criar cartão automaticamente)
 *  - cancelamento, duplicada, sessão expirada
 *  - cartão identificado por nome e por últimos 4 dígitos
 *  - telefone não autorizado
 */
import { test, expect, mock, beforeEach } from "bun:test";

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let pendingRow:
  | {
      id: string;
      status: string;
      parsed: Record<string, unknown>;
      recebida_em: string;
      gasto_id?: string | null;
    }
  | null = null;

let cartoesData: Record<string, unknown>[] = [];
let linkData:
  | {
      user_id: string;
      telefone: string;
      ativo: boolean;
      opt_in_em: string | null;
      revogado_em: string | null;
    }
  | null = null;
const categoriasData = [
  { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
  { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = { table, op: "select", payload: null, filters: {} };
  const PENDING = [
    "aguardando_confirmacao",
    "aguardando_forma_pagamento",
    "aguardando_cartao",
  ];

  const finalize = async () => {
    if (state.op === "insert") {
      const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
      for (const r of rows) inserts.push({ table, row: r });
      if (table === "whatsapp_messages" && PENDING.includes(rows[0]?.status)) {
        pendingRow = {
          id: `m-${inserts.length}`,
          status: rows[0].status,
          parsed: rows[0].parsed,
          recebida_em: new Date().toISOString(),
          gasto_id: null,
        };
      }
      if (table === "gastos") {
        return { data: { id: `g-${inserts.length}` }, error: null };
      }
      return { data: null, error: null };
    }
    if (state.op === "update") {
      if (table === "whatsapp_messages") {
        const s = state.payload?.status;
        if (s === "salva" || s === "cancelada" || s === "expirada") {
          pendingRow = null;
        } else if (s && pendingRow) {
          pendingRow = {
            ...pendingRow,
            status: s,
            parsed: state.payload?.parsed ?? pendingRow.parsed,
          };
        }
      }
      return { data: null, error: null };
    }
    if (state.op === "delete") return { data: null, error: null };

    if (table === "whatsapp_links") return { data: linkData, error: null };
    if (table === "whatsapp_messages") {
      const extId = state.filters?.external_id;
      if (extId) {
        const found = inserts.find(
          (i) => i.table === "whatsapp_messages" && i.row.external_id === extId,
        );
        if (!found) return { data: null, error: null };
        return {
          data: {
            id: "x",
            status: found.row.status,
            gasto_id: found.row.gasto_id ?? null,
          },
          error: null,
        };
      }
      return { data: pendingRow, error: null };
    }
    if (table === "cartoes") return { data: cartoesData, error: null };
    if (table === "categorias") return { data: categoriasData, error: null };
    if (table === "gastos") return { data: { id: "x" }, error: null };
    if (table === "auth.users")
      return { data: { email: "u@example.com" }, error: null };
    return { data: null, error: null };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert(p: unknown) { state.op = "insert"; state.payload = p; return builder; },
    update(p: unknown) { state.op = "update"; state.payload = p; return builder; },
    delete() { state.op = "delete"; return builder; },
    eq(col: string, val: unknown) { state.filters[col] = val; return builder; },
    in: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: finalize,
    maybeSingle: finalize,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: any, reject: any) { return finalize().then(resolve, reject); },
  };
  return builder;
}

const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  auth: {
    admin: {
      getUserById: async () => ({ data: { user: { email: "u@example.com" } } }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: true, plan: "admin_master" }),
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: true, plan: "admin_master" }),
}));

const { processarMensagemWhatsApp, matchCartao, maskCartaoLabel } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";
const baseLink = {
  user_id: "u1",
  telefone: tel,
  ativo: true,
  opt_in_em: new Date().toISOString(),
  revogado_em: null,
};

beforeEach(() => {
  inserts.length = 0;
  pendingRow = null;
  linkData = { ...baseLink };
  cartoesData = [
    {
      id: "c-nu",
      nome: "Nubank",
      banco: "Nubank",
      limite_total: 0,
      dia_fechamento: 1,
      dia_vencimento: 10,
      cor: "#000",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c-inter",
      nome: "Inter 5678",
      banco: "Inter",
      limite_total: 0,
      dia_fechamento: 1,
      dia_vencimento: 10,
      cor: "#000",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
});

const gastos = () => inserts.filter((i) => i.table === "gastos");

// =====================================================================
// 1) "Mercado 45,90" → pergunta forma → "cartão" → pergunta cartão →
//    "Nubank" → confirmação → "sim" → cria gasto com cartao_id=c-nu
// =====================================================================

test("fluxo cartão cadastrado por nome (Mercado → cartão → Nubank → sim)", async () => {
  const r1 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado 45,90", external_id: "a1",
  });
  expect(r1.status).toBe("aguardando_forma_pagamento");
  expect(r1.resposta).toMatch(/pix.*dinheiro.*d[eé]bito.*cart[aã]o/i);
  expect(pendingRow?.parsed?.valor).toBe(45.9);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "cartão", external_id: "a2",
  });
  expect(r2.status).toBe("aguardando_cartao");
  expect(r2.resposta).toMatch(/qual cart[aã]o/i);
  // contexto preservado: valor ainda lá
  expect(pendingRow?.parsed?.valor).toBe(45.9);
  expect(pendingRow?.parsed?.formaPagamento).toBe("credito");

  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Nubank", external_id: "a3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(pendingRow?.parsed?.cartaoId).toBe("c-nu");
  expect(pendingRow?.parsed?.valor).toBe(45.9);

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "a4",
  });
  expect(r4.status).toBe("salva");
  expect(gastos()).toHaveLength(1);
  expect(gastos()[0].row.forma_pagamento).toBe("credito");
  expect(gastos()[0].row.cartao_id).toBe("c-nu");
  expect(gastos()[0].row.valor).toBe(45.9);
});

// =====================================================================
// 2) Cartão NÃO cadastrado → registra como cartao_id=null, não cria cartão
// =====================================================================

test("cartão não cadastrado: registra sem criar cartão automaticamente", async () => {
  await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado 45,90", external_id: "b1",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "cartão", external_id: "b2",
  });
  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Cartão da minha mãe", external_id: "b3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(r3.resposta).toMatch(/n[aã]o encontrei/i);
  expect(r3.resposta).toMatch(/cart[aã]o n[aã]o cadastrado/i);
  expect(pendingRow?.parsed?.cartaoNaoCadastrado).toBe(true);
  expect(pendingRow?.parsed?.cartaoId).toBeNull();

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "b4",
  });
  expect(r4.status).toBe("salva");
  expect(gastos()).toHaveLength(1);
  expect(gastos()[0].row.cartao_id).toBeNull();
  expect(gastos()[0].row.forma_pagamento).toBe("credito");
  // nenhum cartão novo criado
  expect(inserts.find((i) => i.table === "cartoes")).toBeUndefined();
});

// =====================================================================
// 3) Pix sem cartão
// =====================================================================

test("Mercado 45,90 → pix → sim", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "p1" });
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "pix", external_id: "p2" });
  expect(r2.status).toBe("aguardando_confirmacao");
  const r3 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "p3" });
  expect(r3.status).toBe("salva");
  expect(gastos()[0].row.forma_pagamento).toBe("pix");
  expect(gastos()[0].row.cartao_id).toBeNull();
});

// =====================================================================
// 4) Cancelamento no meio do fluxo cartão
// =====================================================================

test("cancelamento durante fluxo cartão não cria gasto", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "c1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "c2" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "Nubank", external_id: "c3" });
  const r4 = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "c4" });
  expect(r4.status).toBe("cancelada");
  expect(gastos()).toHaveLength(0);
  expect(pendingRow).toBeNull();
});

// =====================================================================
// 5) Webhook duplicado (mesmo external_id) NÃO duplica gasto
// =====================================================================

test("mensagem duplicada pelo webhook não cria gasto duplicado", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "w1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "w2" });
  expect(gastos()).toHaveLength(1);
  // mesmo external_id chega de novo
  const dup = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "w2",
  });
  expect(dup.status).toBe("duplicada");
  expect(gastos()).toHaveLength(1);
});

// =====================================================================
// 6) "sim" repetido sem pendência não duplica
// =====================================================================

test("sim repetido sem pendência não cria nada", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "s1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s3" });
  expect(r.status).toBe("sem_pendencia");
  expect(gastos()).toHaveLength(1);
});

// =====================================================================
// 7) Sessão expirada (>30min) começa do zero
// =====================================================================

test("sessão expirada: nova mensagem é tratada como novo gasto", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "e1" });
  // simula expiração: recebida_em antiga
  if (pendingRow) {
    pendingRow.recebida_em = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  }
  // não há pendência ativa retornada para nova lookup — porém o fake
  // sempre devolve pendingRow. Para emular TTL, zeramos pendingRow.
  pendingRow = null;
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Uber 20 pix", external_id: "e2",
  });
  expect(r.status).toBe("aguardando_confirmacao");
});

// =====================================================================
// 8) Telefone não autorizado
// =====================================================================

test("telefone sem vínculo recebe 'sem_vinculo' sem salvar nada", async () => {
  linkData = null;
  const r = await processarMensagemWhatsApp({
    telefone: "5511000000000", texto: "Mercado 45,90", external_id: "u1",
  });
  expect(r.status).toBe("sem_vinculo");
  expect(gastos()).toHaveLength(0);
  expect(inserts.find((i) => i.table === "whatsapp_messages")).toBeUndefined();
});

// =====================================================================
// 9) Cartão por últimos 4 dígitos
// =====================================================================

test("matchCartao identifica por últimos 4 dígitos", () => {
  const cartoes = [
    { id: "c1", nome: "Nubank", banco: "Nubank", limiteTotal: 0, diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "" },
    { id: "c2", nome: "Inter 5678", banco: "Inter", limiteTotal: 0, diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "" },
  ];
  expect(matchCartao("5678", cartoes).match?.id).toBe("c2");
  expect(matchCartao("nubank", cartoes).match?.id).toBe("c1");
  expect(matchCartao("inter", cartoes).match?.id).toBe("c2");
  expect(matchCartao("xpto", cartoes).match).toBeNull();
});

test("maskCartaoLabel nunca expõe dado sensível", () => {
  expect(
    maskCartaoLabel({
      id: "x", nome: "Nubank 1234", banco: "Nubank", limiteTotal: 0,
      diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "",
    }),
  ).toBe("Nubank •••• 1234");
  expect(
    maskCartaoLabel({
      id: "x", nome: "Cartão Itaú", banco: "Itaú", limiteTotal: 0,
      diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "",
    }),
  ).toMatch(/Itaú/);
});

// =====================================================================
// 10) Cartão por nome no fluxo completo (Inter)
// =====================================================================

test("cartão cadastrado por nome reconhece Inter", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "i1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "i2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "inter", external_id: "i3" });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(pendingRow?.parsed?.cartaoId).toBe("c-inter");
});

// =====================================================================
// 11) Cartão por últimos 4 dígitos no fluxo
// =====================================================================

test("cartão cadastrado por últimos 4 dígitos no fluxo", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "d1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "d2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "5678", external_id: "d3" });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(pendingRow?.parsed?.cartaoId).toBe("c-inter");
});
