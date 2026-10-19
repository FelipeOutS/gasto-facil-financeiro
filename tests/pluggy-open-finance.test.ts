import { describe, test, expect, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import {
  isPluggyAllowed,
  classifyTransaction,
  pluggyDedupeKey,
  categorize,
  resolveCategoria,
  reconcileWithMercadoPago,
  assertConnectorAllowed,
  accessStateFromHttp,
  clampHistoryDays,
  safeEqual,
  type PluggyTx,
} from "../src/lib/pluggy/rules";
import { syncItem, type PluggyStore, type TxRow, type PluggySettings } from "../src/server/pluggy/pluggy-sync.server";
import { PluggyHttpError, type PluggyApi } from "../src/server/pluggy/pluggy-api.server";

const FELIPE = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const MICHAEL = "47df50ce-df1e-4c54-8fae-0ffb5105478d";
const OUTRO = "11111111-1111-1111-1111-111111111111";

const tx = (o: Partial<PluggyTx>): PluggyTx => ({
  id: "t1", accountId: "a1", description: "Compra", amount: 10, date: "2026-10-10", type: "DEBIT", status: "POSTED", ...o,
});

describe("acesso exclusivo", () => {
  test("Felipe e Michael com owner passam", () => {
    expect(isPluggyAllowed(FELIPE, ["owner"])).toBe(true);
    expect(isPluggyAllowed(MICHAEL, ["owner"])).toBe(true);
  });
  test("UUID da allowlist sem owner é bloqueado", () => {
    expect(isPluggyAllowed(FELIPE, ["admin"])).toBe(false);
    expect(isPluggyAllowed(FELIPE, [])).toBe(false);
  });
  test("owner fora da allowlist é bloqueado", () => {
    expect(isPluggyAllowed(OUTRO, ["owner"])).toBe(false);
    expect(isPluggyAllowed(null, ["owner"])).toBe(false);
  });
  test("SQL candidato usa os mesmos dois UUIDs e exige owner", () => {
    const sql = readFileSync("docs/migrations-candidate/pluggy-open-finance.sql", "utf8");
    expect(sql).toContain(FELIPE);
    expect(sql).toContain(MICHAEL);
    expect(sql).toContain("role = 'owner'");
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/ALTER TABLE public\.(gastos|receitas|cartoes|imported_transactions)/);
  });
});

describe("classificação", () => {
  test("débito em conta = gasto; crédito = receita", () => {
    expect(classifyTransaction(tx({}), "BANK").kind).toBe("gasto");
    expect(classifyTransaction(tx({ type: "CREDIT" }), "BANK").kind).toBe("receita");
  });
  test("pendente nunca é importada (evita pendente + confirmada)", () => {
    expect(classifyTransaction(tx({ status: "PENDING" }), "BANK").kind).toBe("ignorado");
  });
  test("pagamento de fatura é ignorado", () => {
    expect(classifyTransaction(tx({ description: "Pagamento de fatura" }), "BANK").reason).toBe("pagamento_de_fatura");
    expect(classifyTransaction(tx({ category: "Credit card payment", type: "CREDIT" }), "CREDIT").kind).toBe("ignorado");
  });
  test("transferência entre contas próprias é ignorada", () => {
    expect(classifyTransaction(tx({ category: "Same person transfer" }), "BANK").kind).toBe("ignorado");
    const pix = tx({ type: "CREDIT", paymentData: { payer: { documentNumber: { value: "123.456.789-00" } }, receiver: { documentNumber: { value: "12345678900" } } } });
    expect(classifyTransaction(pix, "BANK", "12345678900").kind).toBe("ignorado");
  });
  test("estorno vai para revisão", () => {
    expect(classifyTransaction(tx({ description: "ESTORNO compra", type: "CREDIT" }), "CREDIT").kind).toBe("revisao");
  });
  test("compra no cartão = gasto; crédito no cartão = revisão", () => {
    expect(classifyTransaction(tx({}), "CREDIT").kind).toBe("gasto");
    expect(classifyTransaction(tx({ type: "CREDIT", description: "Ajuste" }), "CREDIT").kind).toBe("revisao");
  });
});

describe("deduplicação e categorias", () => {
  test("chave determinística e completa", () => {
    expect(pluggyDedupeKey("i", "a", "t")).toBe("pluggy:i:a:t");
    expect(() => pluggyDedupeKey("i", "", "t")).toThrow();
  });
  test("categorias", () => {
    expect(categorize({ description: "IFOOD *RESTAURANTE" }, "gasto")).toBe("Alimentação");
    expect(categorize({ category: "Groceries", description: "x" }, "gasto")).toBe("Supermercado");
    expect(categorize({ description: "NETFLIX.COM" }, "gasto")).toBe("Assinaturas");
    expect(categorize({ category: "Salary", description: "x" }, "receita")).toBe("Salário");
    expect(categorize({ description: "UBER TRIP" }, "receita")).toBe("Outros recebimentos");
    expect(categorize({ description: "zzz" }, "gasto")).toBe("Outras despesas");
  });
  test("correção manual sempre vence", () => {
    expect(resolveCategoria("Lazer", "Compras", true)).toBe("Lazer");
    expect(resolveCategoria(null, "Compras", true)).toBe("Compras");
    expect(resolveCategoria(null, "Compras", false)).toBe(null);
  });
});

describe("conciliação Mercado Pago", () => {
  const mp = [{ id: "m1", amount: 49.9, occurredAt: "2026-10-09T15:00:00Z", status: "approved" }];
  test("mesmo valor em até 1 dia → revisão (nunca descarte)", () => {
    expect(reconcileWithMercadoPago({ amount: -49.9, date: "2026-10-10" }, mp)).toEqual({ status: "revisao", matchIds: ["m1"] });
  });
  test("valor diferente em 1 centavo, 2 dias depois ou não aprovado → sem coincidência", () => {
    expect(reconcileWithMercadoPago({ amount: 49.91, date: "2026-10-10" }, mp).status).toBe("sem_coincidencia");
    expect(reconcileWithMercadoPago({ amount: 49.9, date: "2026-10-12" }, mp).status).toBe("sem_coincidencia");
    expect(reconcileWithMercadoPago({ amount: 49.9, date: "2026-10-09" }, [{ ...mp[0], status: "refunded" }]).status).toBe("sem_coincidencia");
  });
});

describe("sandbox, trial e webhook", () => {
  test("só conector Sandbox é aceito", () => {
    expect(() => assertConnectorAllowed({ id: 2, isSandbox: true })).not.toThrow();
    expect(() => assertConnectorAllowed({ id: 201, isSandbox: false })).toThrow("pluggy_conector_nao_sandbox");
    expect(() => assertConnectorAllowed(null)).toThrow();
    expect(() => assertConnectorAllowed({ id: 2, isSandbox: true }, "live")).toThrow("pluggy_live_nao_autorizado");
  });
  test("401/403 pausam; 500/429 não", () => {
    expect(accessStateFromHttp(401)).toBe("pausado_acesso");
    expect(accessStateFromHttp(403)).toBe("pausado_acesso");
    expect(accessStateFromHttp(500)).toBe("ok");
    expect(accessStateFromHttp(429)).toBe("ok");
  });
  test("histórico só aceita opções válidas", () => {
    expect(clampHistoryDays(365)).toBe(365);
    expect(clampHistoryDays(9999)).toBe(90);
  });
  test("token do webhook", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
  test("webhook exige token, é idempotente e acha o dono pelo itemId", () => {
    const src = readFileSync("src/routes/api/public/pluggy.webhook.ts", "utf8");
    expect(src).toContain("safeEqual(got, expected)");
    expect(src).toContain('request.headers.get("x-gi-webhook-token")');
    expect(src).toContain("receiveWebhook(");
    expect(src).not.toContain("syncItem"); // só grava na fila; processamento é no worker
    expect(src).not.toMatch(/clientUserId/);
  });
  test("secrets nunca no navegador", () => {
    const ui = readFileSync("src/routes/app_.integracoes.open-finance.tsx", "utf8");
    expect(ui).not.toMatch(/PLUGGY_CLIENT|process\.env/);
  });
});

// ---------- motor de sincronização (memória) ----------
function memStore(owners: Record<string, string>) {
  const tx = new Map<string, TxRow & { categoria_manual?: string }>();
  const settings: Record<string, PluggySettings> = {};
  const store: PluggyStore & { tx: typeof tx; settings: typeof settings; syncMarks: Array<{ ok: boolean; error?: string; pluggyError?: string | null }> } = {
    tx,
    settings,
    async getSettings(u) {
      return settings[u] ?? { autoImport: false, autoCategorize: true, historyDays: 90, accessState: "ok" };
    },
    async setAccessState(u, s) {
      settings[u] = { ...(await store.getSettings(u)), accessState: s };
    },
    async getItemOwner(i) {
      return owners[i] ? { userId: owners[i], isSandbox: true } : null;
    },
    async upsertItem() {},
    syncMarks: [] as Array<{ ok: boolean; error?: string; pluggyError?: string | null }>,
    async markItemSync(_u, _i, o) {
      store.syncMarks.push(o);
    },
    async markItemDeleted() {},
    async upsertAccounts() {},
    async upsertTransactions(rows) {
      for (const r of rows) {
        const k = `${r.user_id}|${r.transaction_id}`;
        const prev = tx.get(k);
        tx.set(k, { ...r, categoria_manual: prev?.categoria_manual });
      }
    },
    async markTransactionsDeleted() {},
    async mpCandidates() {
      return [{ id: "00000000-0000-0000-0000-0000000000mp", amount: 77, occurredAt: "2026-10-10T10:00:00Z", status: "approved" }];
    },
  };
  return store;
}

function fakeApi(opts: { sandbox?: boolean; clientUserId?: string; fail?: number } = {}): PluggyApi {
  const txs = [
    { id: "t1", description: "IFOOD", amount: -25.5, date: "2026-10-10", type: "DEBIT", status: "POSTED" },
    { id: "t2", description: "Salário", category: "Salary", amount: 5000, date: "2026-10-05", type: "CREDIT", status: "POSTED" },
    { id: "t3", description: "Pix", amount: -77, date: "2026-10-10", type: "DEBIT", status: "POSTED" },
    { id: "t4", description: "Pendente", amount: -10, date: "2026-10-11", type: "DEBIT", status: "PENDING" },
  ];
  return {
    item: async (id: string) => {
      if (opts.fail) throw new PluggyHttpError(opts.fail, "item");
      return { id, clientUserId: opts.clientUserId ?? FELIPE, status: "UPDATED", connector: { id: 2, name: "Pluggy Bank", isSandbox: opts.sandbox ?? true } };
    },
    accounts: async (itemId: string) => ({ results: [{ id: "a1", itemId, type: "BANK", name: "Conta", balance: 100 }] }),
    transactionsV2: async () => ({ results: txs, next: null }),
  } as unknown as PluggyApi;
}

describe("sincronização", () => {
  let store: ReturnType<typeof memStore>;
  beforeEach(() => {
    store = memStore({ itemF: FELIPE, itemM: MICHAEL });
  });
  const now = () => new Date("2026-10-19T12:00:00Z");

  test("importa, classifica, concilia e é idempotente", async () => {
    const r1 = await syncItem({ api: fakeApi(), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r1).toEqual({ ok: true, accounts: 1, transactions: 4, revisao: 1, ignorados: 1 });
    const r2 = await syncItem({ api: fakeApi(), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r2.ok).toBe(true);
    expect(store.tx.size).toBe(4);
    expect(store.tx.get(`${FELIPE}|t1`)?.classification).toBe("gasto");
    expect(store.tx.get(`${FELIPE}|t1`)?.categoria_sugerida).toBe("Alimentação");
    expect(store.tx.get(`${FELIPE}|t2`)?.classification).toBe("receita");
    expect(store.tx.get(`${FELIPE}|t3`)?.classification).toBe("revisao");
    expect(store.tx.get(`${FELIPE}|t4`)?.classification).toBe("ignorado");
  });
  test("correção manual sobrevive à nova sincronização", async () => {
    await syncItem({ api: fakeApi(), store, now }, { userId: FELIPE, itemId: "itemF" });
    store.tx.get(`${FELIPE}|t1`)!.categoria_manual = "Lazer";
    await syncItem({ api: fakeApi(), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(store.tx.get(`${FELIPE}|t1`)?.categoria_manual).toBe("Lazer");
  });
  test("isolamento: Michael não sincroniza item do Felipe", async () => {
    const r = await syncItem({ api: fakeApi(), store, now }, { userId: MICHAEL, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "item_de_outro_usuario" });
    expect(store.tx.size).toBe(0);
  });
  test("item cujo clientUserId é outro é recusado", async () => {
    const r = await syncItem({ api: fakeApi({ clientUserId: MICHAEL }), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r.ok).toBe(false);
  });
  test("conector real é recusado no modo Sandbox", async () => {
    const r = await syncItem({ api: fakeApi({ sandbox: false }), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "pluggy_conector_nao_sandbox" });
    expect(store.tx.size).toBe(0);
  });
  test("fim do trial (403) pausa e não chama mais a API", async () => {
    const r = await syncItem({ api: fakeApi({ fail: 403 }), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "acesso_pluggy_suspenso" });
    let called = false;
    const api = { ...fakeApi(), item: async () => { called = true; throw new Error("x"); } } as unknown as PluggyApi;
    const r2 = await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r2).toEqual({ ok: false, error: "sincronizacao_pausada" });
    expect(called).toBe(false);
  });
  test("API fora do ar (500) não pausa nem grava", async () => {
    const r = await syncItem({ api: fakeApi({ fail: 500 }), store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "pluggy_http_500" });
    expect((await store.getSettings(FELIPE)).accessState).toBe("ok");
  });
  test("motor não toca em gastos/receitas", () => {
    const src = readFileSync("src/server/pluggy/pluggy-sync.server.ts", "utf8") + readFileSync("src/server/pluggy/pluggy-store.server.ts", "utf8");
    expect(src).not.toMatch(/from\("(gastos|receitas|cartoes)"\)/);
  });
});

// ---------- API v2 de transações (cursor) ----------
import { transactionsV2Path } from "@/server/pluggy/pluggy-api.server";

describe("Pluggy /v2/transactions", () => {
  const now = () => new Date("2026-10-19T12:00:00Z");
  const base = { status: "POSTED" as const };
  function v2Api(pages: Record<string, Array<Record<string, unknown>> | Error>, nexts: Record<string, string | null>, calls: string[]) {
    return {
      item: async (id: string) => ({ id, clientUserId: FELIPE, status: "UPDATED", connector: { id: 2, name: "Pluggy Bank", isSandbox: true } }),
      accounts: async (itemId: string) => ({
        results: [
          { id: "bank", itemId, type: "BANK", name: "Conta", balance: 1 },
          { id: "card", itemId, type: "CREDIT", name: "Cartão", balance: -1 },
        ],
      }),
      transactionsV2: async (acc: string, from: string, next?: string | null) => {
        const key = `${acc}:${next ?? "first"}`;
        calls.push(`${key}@${from}`);
        const p = pages[key];
        if (p instanceof Error) throw p;
        return { results: p ?? [], next: nexts[key] ?? null };
      },
    } as unknown as PluggyApi;
  }

  test("caminho usa v2, accountId e dateFrom; next só no mesmo endpoint", () => {
    expect(transactionsV2Path("a b", "2025-10-19")).toBe("/v2/transactions?accountId=a%20b&dateFrom=2025-10-19");
    expect(transactionsV2Path("x", "d", "?cursor=abc%3D&accountId=x")).toBe("/v2/transactions?cursor=abc%3D&accountId=x");
    expect(transactionsV2Path("x", "d", "https://api.pluggy.ai/v2/transactions?cursor=z")).toBe("/v2/transactions?cursor=z");
    expect(() => transactionsV2Path("x", "d", "https://evil.example/v2/transactions?cursor=z")).toThrow();
    expect(() => transactionsV2Path("x", "d", "https://api.pluggy.ai/items?cursor=z")).toThrow();
  });

  test("pagina por cursor em várias contas, inclui cartão, respeita período e é idempotente", async () => {
    const store = memStore({ itemF: FELIPE });
    store.settings[FELIPE] = { autoImport: false, autoCategorize: true, historyDays: 365, accessState: "ok" };
    const calls: string[] = [];
    const tx = (id: string, date: string, amount: number, type = "DEBIT") => ({ ...base, id, description: `D ${id}`, amount, date, type });
    const api = v2Api(
      {
        "bank:first": [tx("b1", "2026-10-01", -10), tx("b2", "2026-09-01", 2000, "CREDIT")],
        "bank:?cursor=p2": [tx("b3", "2026-05-01", -5), tx("b2", "2026-09-01", 2000, "CREDIT"), tx("old", "2024-01-01", -1)],
        "card:first": [tx("c1", "2026-10-05", 50)],
      },
      { "bank:first": "?cursor=p2" },
      calls,
    );
    const r1 = await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r1.ok).toBe(true);
    expect(calls).toEqual(["bank:first@2025-10-19", "bank:?cursor=p2@2025-10-19", "card:first@2025-10-19"]);
    expect([...store.tx.keys()].sort()).toEqual([`${FELIPE}|b1`, `${FELIPE}|b2`, `${FELIPE}|b3`, `${FELIPE}|c1`]);
    expect(store.tx.get(`${FELIPE}|c1`)?.account_id).toBe("card");
    await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(store.tx.size).toBe(4);
    expect(store.syncMarks.at(-1)).toEqual({ ok: true, pluggyError: null });
  });

  test("cursor repetido não entra em loop", async () => {
    const store = memStore({ itemF: FELIPE });
    const api = v2Api({ "bank:first": [], "bank:?c=1": [] }, { "bank:first": "?c=1", "bank:?c=1": "?c=1" }, []);
    const r = await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r).toMatchObject({ ok: false, error: "sync_parcial:transacoes_cursor_repetido" });
  });

  test("falha nas transações = sucesso parcial registrado, sem marcar sincronizado", async () => {
    const store = memStore({ itemF: FELIPE });
    const api = v2Api({ "bank:first": new PluggyHttpError(410, "/v2/transactions") }, {}, []);
    const r = await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "sync_parcial:transacoes_http_410", partial: { accounts: 2 } });
    expect(store.syncMarks).toEqual([{ ok: false, error: "sync_parcial:transacoes_http_410" }]);
    expect(store.tx.size).toBe(0);
    // nova tentativa manual bem-sucedida limpa o erro
    const ok = v2Api({ "bank:first": [{ ...base, id: "b1", description: "x", amount: -1, date: "2026-10-01", type: "DEBIT" }] }, {}, []);
    expect((await syncItem({ api: ok, store, now }, { userId: FELIPE, itemId: "itemF" })).ok).toBe(true);
    expect(store.syncMarks.at(-1)).toEqual({ ok: true, pluggyError: null });
  });

  test("Michael não sincroniza item do Felipe", async () => {
    const store = memStore({ itemF: FELIPE });
    const r = await syncItem({ api: v2Api({}, {}, []), store, now }, { userId: MICHAEL, itemId: "itemF" });
    expect(r).toEqual({ ok: false, error: "item_de_outro_usuario" });
    expect(store.tx.size).toBe(0);
  });

  test("configurações: auto_import é forçado a false no servidor", async () => {
    const src = await Bun.file("src/routes/api/integrations.pluggy.$action.ts").text();
    expect(src).toMatch(/auto_import: false, auto_categorize/);
    expect(src).not.toMatch(/auto_import: s\.autoImport/);
  });
});

// ---------- correção pós-auditoria: cartão, categorias, histórico ----------
describe("cartão: compras negativas com type CREDIT (Pluggy Bank)", () => {
  const card = (o: Partial<PluggyTx>) => tx({ type: "CREDIT", status: "POSTED", ...o });
  test("Smart Fit, Spotify e Netflix negativos e confirmados = gasto de cartão", () => {
    for (const [d, c] of [["SMART FIT ACADEMIA", "Gyms and fitness centers"], ["SPOTIFY AB", "Music streaming"], ["NETFLIX.COM", "Video streaming"]]) {
      expect(classifyTransaction(card({ description: d, category: c, amount: -21.9 }), "CREDIT")).toEqual({ kind: "gasto", reason: "compra_cartao_valor_negativo" });
    }
  });
  test("negativo sem categoria de comerciante não vira compra", () => {
    expect(classifyTransaction(card({ description: "X", category: null, amount: -10 }), "CREDIT").kind).toBe("revisao");
    expect(classifyTransaction(card({ description: "Juros", category: "Interest", amount: -10 }), "CREDIT").kind).toBe("revisao");
    expect(classifyTransaction(card({ description: "Ajuste", category: "Adjustment", amount: -10 }), "CREDIT").kind).toBe("revisao");
    expect(classifyTransaction(card({ description: "Compra", category: "Shopping", amount: -10, status: "PENDING" }), "CREDIT").kind).toBe("ignorado");
  });
  test("créditos e estornos verdadeiros vão para revisão", () => {
    expect(classifyTransaction(card({ description: "Crédito", category: "Shopping", amount: 30 }), "CREDIT")).toEqual({ kind: "revisao", reason: "credito_em_cartao" });
    expect(classifyTransaction(card({ description: "ESTORNO NETFLIX", category: "Video streaming", amount: -55.9 }), "CREDIT").reason).toBe("estorno");
  });
  test("pagamento de fatura nunca é contado duas vezes", () => {
    expect(classifyTransaction(tx({ description: "PAGAMENTO FATURA CARTAO VISA", category: "Credit card payment", amount: -167.7 }), "BANK").kind).toBe("ignorado");
    expect(classifyTransaction(card({ description: "Pagamento recebido", category: "Credit card payment", amount: 167.7 }), "CREDIT").kind).toBe("ignorado");
  });
  test("compra DEBIT positiva continua gasto", () => {
    expect(classifyTransaction(tx({ category: "Shopping", amount: 10 }), "CREDIT").kind).toBe("gasto");
  });
});

describe("categorias corrigidas", () => {
  test("mapeamentos aprovados", () => {
    expect(categorize({ description: "ELETROBRAS LIGHT SA", category: "Electricity" }, "gasto")).toBe("Contas");
    expect(categorize({ description: "CONDOMINIO EDIFICIO SOLAR", category: "Housing" }, "gasto")).toBe("Moradia");
    expect(categorize({ description: "VIVO SERVICOS E COMERCIO", category: "Telecommunications" }, "gasto")).toBe("Contas");
    expect(categorize({ description: "SMART FIT ACADEMIA", category: "Gyms and fitness centers" }, "gasto")).toBe("Saúde");
    expect(categorize({ description: "SPOTIFY AB", category: "Music streaming" }, "gasto")).toBe("Assinaturas");
    expect(categorize({ description: "NETFLIX.COM", category: "Video streaming" }, "gasto")).toBe("Assinaturas");
    expect(categorize({ description: "SALARIO EMPRESA XYZ LTDA", category: "Salary" }, "receita")).toBe("Salário");
  });
  test("boleto sem identificação vai para revisão; boleto identificado não", () => {
    expect(classifyTransaction(tx({ description: "Pagamento de boleto", category: "Transfer - Bank Slip", amount: -100 }), "BANK")).toEqual({ kind: "revisao", reason: "boleto_sem_identificacao" });
    expect(classifyTransaction(tx({ description: "Boleto ESCOLA ABC", category: "Transfer - Bank Slip", amount: -100 }), "BANK").kind).toBe("gasto");
  });
  test("categorias usadas existem entre as padrão do app", async () => {
    const { GI_CATEGORIAS } = await import("@/lib/pluggy/rules");
    expect(GI_CATEGORIAS).toContain("Contas");
  });
});

describe("histórico inicial", () => {
  const now = () => new Date("2026-10-19T12:00:00Z");
  test("sem preferência salva a sincronização pede a escolha (não presume 90)", async () => {
    const store = memStore({ itemF: FELIPE });
    store.getSettings = async () => ({ autoImport: false, autoCategorize: true, historyDays: 90, accessState: "ok", configured: false });
    expect(await syncItem({ api: fakeApi(), store, now }, { userId: FELIPE, itemId: "itemF" })).toEqual({ ok: false, error: "historico_nao_escolhido" });
    expect(store.tx.size).toBe(0);
  });
  test("365 salvos => busca desde 19/10/2025 e recupera as antigas", async () => {
    const store = memStore({ itemF: FELIPE });
    store.settings[FELIPE] = { autoImport: false, autoCategorize: true, historyDays: 365, accessState: "ok", configured: true };
    let from = "";
    const api = { ...fakeApi(), transactionsV2: async (_a: string, f: string) => { from = f; return { results: [tx({ id: "abr", date: "2026-04-15", amount: -185 })], next: null }; } } as unknown as PluggyApi;
    expect((await syncItem({ api, store, now }, { userId: FELIPE, itemId: "itemF" })).ok).toBe(true);
    expect(from).toBe("2025-10-19");
    expect(store.tx.get(`${FELIPE}|abr`)?.amount_original).toBe(-185);
  });
  test("fontes: criação automática não substitui a escolha e o backend confirma", async () => {
    const store = await Bun.file("src/server/pluggy/pluggy-store.server.ts").text();
    expect(store).not.toMatch(/from\("pluggy_settings"\)\s*\.upsert/);
    const route = await Bun.file("src/routes/api/integrations.pluggy.$action.ts").text();
    expect(route).toMatch(/preferencia_nao_confirmada/);
    expect(route.match(/historico_nao_escolhido/g)?.length).toBeGreaterThanOrEqual(2);
    expect(route).not.toMatch(/pluggy_settings"\)\.upsert\(\{ user_id: a\.userId, access_state/);
  });
});

describe("recorrentes de meses diferentes", () => {
  test("setembro e outubro com mesma descrição e valor são independentes", async () => {
    const store = memStore({ itemF: FELIPE });
    const n = (id: string, date: string) => tx({ id, type: "CREDIT", description: "NETFLIX.COM", category: "Video streaming", amount: -55.9, date });
    const api = { ...fakeApi(), accounts: async (itemId: string) => ({ results: [{ id: "card", itemId, type: "CREDIT", name: "Cartão", balance: 0 }] }), transactionsV2: async () => ({ results: [n("s", "2026-09-01"), n("o", "2026-10-01")], next: null }) } as unknown as PluggyApi;
    await syncItem({ api, store, now: () => new Date("2026-10-19T12:00:00Z") }, { userId: FELIPE, itemId: "itemF" });
    await syncItem({ api, store, now: () => new Date("2026-10-19T12:00:00Z") }, { userId: FELIPE, itemId: "itemF" });
    expect(store.tx.size).toBe(2);
    expect([...store.tx.values()].map((t) => [t.classification, t.classification_reason, t.total_installments])).toEqual([["gasto", "compra_cartao_valor_negativo", null], ["gasto", "compra_cartao_valor_negativo", null]]);
  });
});
