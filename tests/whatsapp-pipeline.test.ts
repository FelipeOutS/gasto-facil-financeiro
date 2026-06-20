/**
 * Testes de integração do pipeline processarMensagemWhatsApp.
 *
 * Garante que NENHUM gasto é gravado em `gastos` antes da confirmação
 * explícita do usuário (sim/salvar/confirmar/ok/✅).
 *
 * Roda via: bun test tests/whatsapp-pipeline.test.ts
 */
import { test, expect, mock, beforeEach } from "bun:test";

// ---------- Fake Supabase client com rastreamento ----------

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let pendingRow: {
  id: string;
  status: string;
  parsed: Record<string, unknown>;
  recebida_em: string;
  gasto_id?: string | null;
} | null = null;

let cartoesData: Record<string, unknown>[] = [];
const categoriasData = [
  { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
  { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
  { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
  { id: "cat-saude", legacy_id: "saude", nome: "Saúde", user_id: "u1" },
  { id: "cat-rest", legacy_id: "restaurante", nome: "Restaurante", user_id: "u1" },
  { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
];
const linkData = {
  user_id: "u1",
  telefone: "5511999998888",
  ativo: true,
  opt_in_em: new Date().toISOString(),
  revogado_em: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = { table, op: "select", payload: null };

  const finalize = async () => {
    if (state.op === "insert") {
      const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
      for (const r of rows) inserts.push({ table, row: r });
      if (
        table === "whatsapp_messages" &&
        rows[0]?.status === "aguardando_confirmacao"
      ) {
        pendingRow = {
          id: `m-${inserts.length}`,
          parsed: rows[0].parsed,
          recebida_em: new Date().toISOString(),
        };
      }
      if (table === "gastos") {
        return { data: { id: `g-${inserts.length}` }, error: null };
      }
      return { data: null, error: null };
    }
    if (state.op === "update") {
      if (
        table === "whatsapp_messages" &&
        (state.payload?.status === "salva" ||
          state.payload?.status === "cancelada")
      ) {
        pendingRow = null;
      }
      return { data: null, error: null };
    }
    if (state.op === "delete") return { data: null, error: null };

    // SELECT
    if (table === "whatsapp_links") return { data: linkData, error: null };
    if (table === "whatsapp_messages") {
      // buscarPendencia
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
    select() {
      return builder;
    },
    insert(payload: unknown) {
      state.op = "insert";
      state.payload = payload;
      return builder;
    },
    update(payload: unknown) {
      state.op = "update";
      state.payload = payload;
      return builder;
    },
    delete() {
      state.op = "delete";
      return builder;
    },
    eq() {
      return builder;
    },
    in() {
      return builder;
    },
    gte() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    single: finalize,
    maybeSingle: finalize,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: any, reject: any) {
      return finalize().then(resolve, reject);
    },
  };
  return builder;
}

const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  auth: {
    admin: {
      getUserById: async () => ({
        data: { user: { email: "u@example.com" } },
      }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeAdmin,
}));
mock.module("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeAdmin,
}));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({
    active: true,
    plan: "admin_master",
  }),
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({
    active: true,
    plan: "admin_master",
  }),
}));

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";

beforeEach(() => {
  inserts.length = 0;
  pendingRow = null;
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
  ];
});

const gastosInserts = () => inserts.filter((i) => i.table === "gastos");

// ============================================================
// Regra 1+2: nova mensagem completa só cria pendência
// ============================================================

test("Pix completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Paguei R$ 18 no pix hoje no lanche",
    external_id: "ext-pix-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
  expect(pendingRow).not.toBeNull();
});

test("Débito completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Comprei remédio R$ 42,50 no débito hoje",
    external_id: "ext-deb-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

test("Cartão de crédito completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "ext-cred-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

// ============================================================
// Regra 5: "sim" sem pendência ativa
// ============================================================

test("Confirmação 'sim' sem pendência NÃO grava gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "ext-sim-vazio",
  });
  expect(r.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(0);
});

// ============================================================
// Regra 4: "não" descarta pendência
// ============================================================

test("Cancelamento descarta pendência sem gravar gasto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "n-1",
  });
  expect(pendingRow).not.toBeNull();
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "não",
    external_id: "n-2",
  });
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
  expect(pendingRow).toBeNull();
});

// ============================================================
// Regra 3 + 6: confirmação cria UM gasto, segunda confirmação não duplica
// ============================================================

test("Confirmação cria UM gasto e segunda confirmação NÃO duplica", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "d-1",
  });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "d-2",
  });
  expect(r1.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "d-3",
  });
  expect(r2.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(1);
});

// ============================================================
// Regra 7: nova mensagem enquanto há pendência ativa
// ============================================================

test("Nova despesa com pendência ativa avisa e NÃO grava gasto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "p-1",
  });
  expect(pendingRow).not.toBeNull();
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber R$ 27 hoje no pix",
    external_id: "p-2",
  });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toMatch(/aguardando confirma[cç][aã]o/i);
  expect(gastosInserts()).toHaveLength(0);
  // pendência original permanece
  expect(pendingRow).not.toBeNull();
});

// ============================================================
// Regra 3: forma de pagamento correta após confirmação
// ============================================================

test("Confirmação salva como Pix (forma=pix, sem cartão)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Paguei R$ 18 no pix hoje no lanche",
    external_id: "fp-pix-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "fp-pix-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("pix");
  expect(gasto?.cartao_id).toBeNull();
});

test("Confirmação salva como débito (forma=debito, sem cartão)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Comprei remédio R$ 42,50 no débito hoje",
    external_id: "fp-deb-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "fp-deb-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("debito");
  expect(gasto?.cartao_id).toBeNull();
});

test("Confirmação salva como crédito vincula cartao_id correto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "fp-cred-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "fp-cred-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("credito");
  expect(gasto?.cartao_id).toBe("c-nu");
});

// ============================================================
// Variantes de confirmação (ok / salvar / ✅)
// ============================================================

test("Variantes de confirmação salvam o gasto", async () => {
  for (const palavra of ["ok", "salvar", "confirmar", "✅"]) {
    inserts.length = 0;
    pendingRow = null;
    await processarMensagemWhatsApp({
      telefone: tel,
      texto: "Paguei R$ 18 no pix hoje no lanche",
      external_id: `v-${palavra}-1`,
    });
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: palavra,
      external_id: `v-${palavra}-2`,
    });
    expect(r.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
  }
});
