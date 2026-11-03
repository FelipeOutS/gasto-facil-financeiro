import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Row = Record<string, any>;
let rows: Row[] = [];
let writes: string[] = [];
let alerts: string[] = [];
let fail: string | null = null;
let noRow = false;
let lostResponse = false;
let pause: ((op: string) => Promise<void>) | null = null;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      let op = "read";
      let fields: Row = {};
      const filters: Row = {};
      let prefix = "";
      const q: any = {
        select: () => q, single: () => q, maybeSingle: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        in: () => q,
        like: (_k: string, v: string) => { prefix = v; return q; },
        update: (v: Row) => { op = "update"; fields = v; return q; },
        insert: (v: Row) => { op = "insert"; fields = v; return q; },
        delete: () => { op = "delete"; return q; },
        then: (resolve: any, reject: any) => (async () => {
          if (table === "user_alerts") {
            alerts.push(prefix);
            if (fail === "alerts") throw new Error("alert offline");
            return { data: null, error: null };
          }
          if (table !== "faturas_cartao") throw new Error("Unexpected table: " + table);
          if (pause) await pause(op);
          if (fail === "connection") throw new Error("offline");
          if (fail === op) return { data: null, error: new Error(op + " failed") };
          const index = rows.findIndex(r => Object.entries(filters).every(([k,v]) => r[k] === v));
          if (op === "read") return { data: index < 0 ? null : { ...rows[index] }, error: null };
          writes.push(op);
          if (noRow) return { data: null, error: null };
          let data: Row | null = null;
          if (op === "insert") {
            if (rows.some(r => ["user_id","cartao_id","mes","ano"].every(k => r[k] === fields[k]))) {
              return { data: null, error: { code: "23505", message: "unique" } };
            }
            data = { id: "invoice", ...fields };
            rows.push(data);
          } else if (index >= 0 && op === "update") {
            data = { ...rows[index], ...fields };
            rows[index] = data;
          } else if (index >= 0 && op === "delete") {
            data = { id: rows[index].id };
            rows.splice(index, 1);
          }
          if (lostResponse) throw new Error("response lost");
          return { data, error: null };
        })().then(resolve, reject),
      };
      return q;
    },
  },
}));
const store = await import("../src/lib/store");
const paid = () => store.marcarFaturaPaga("card", 10, 2026, {
  valorPago: 123.45, dataPagamento: "2026-11-02",
});
const reopen = () => store.desmarcarFaturaPaga("card", 10, 2026);
function seed(status = "aberta") {
  rows = [{
    id: "invoice", user_id: "owner", cartao_id: "card", mes: 10, ano: 2026,
    status, valor_pago: status === "paga" ? 123.45 : 0,
    data_pagamento: status === "paga" ? "2026-11-02" : null, observacao: "original",
  }];
  reload();
}
// Simula apenas a transformação usada pela hidratação; sem chamar hydrateUser,
// que pode executar backfills. O conteúdo vem do fake persistente, não do estado anterior.
function reload() {
  store.getFaturas().splice(0, store.getFaturas().length, ...rows.map(r => ({
    id: r.id, cartaoId: r.cartao_id, mes: r.mes, ano: r.ano, status: r.status,
    valorPago: r.valor_pago, dataPagamento: r.data_pagamento ?? undefined,
    observacao: r.observacao ?? undefined,
  })));
}
beforeEach(() => {
  store.setActiveUserId(null);
  store.setActiveUserId("owner");
  store.setStoreCanWrite(true);
  rows = []; writes = []; alerts = []; fail = null;
  pause = null; noRow = false; lostResponse = false;
});
test("INSERT confirmado publica a linha persistida e só então resolve alertas", async () => {
  await paid();
  expect(writes).toEqual(["insert"]);
  expect(store.getFatura("card", 10, 2026)?.id).toBe("invoice");
  expect(store.getFatura("card", 10, 2026)?.valorPago).toBe(123.45);
  expect(alerts).toHaveLength(2);
  reload();
  expect(store.getFatura("card", 10, 2026)?.status).toBe("paga");
});
test("UPDATE confirmado preserva observação e recarrega como paga", async () => {
  seed(); await paid();
  expect(writes).toEqual(["update"]);
  reload();
  expect(store.getFatura("card",10,2026)?.status).toBe("paga");
  expect(store.getFatura("card",10,2026)?.observacao).toBe("original");
});
for (const op of ["insert", "update", "read", "connection"]) {
  test("falha " + op + " rejeita, preserva memória/banco/alertas e libera retry", async () => {
    if (op !== "insert") seed(op === "delete" ? "paga" : "aberta");
    const previous = structuredClone(store.getFaturas());
    const persisted = structuredClone(rows);
    fail = op;
    await expect(op === "delete" ? reopen() : paid()).rejects.toThrow();
    expect(store.getFaturas()).toEqual(previous);
    expect(rows).toEqual(persisted);
    expect(alerts).toEqual([]);
    reload();
    expect(store.getFaturas()).toEqual(previous);
    fail = null;
    await (op === "delete" ? reopen() : paid());
  });
}
test("reabertura preserva pagamento real e repetição não escreve de novo", async () => {
  seed("paga"); await reopen(); await reopen();
  expect(writes).toEqual(["update"]);
  expect(rows[0].valor_pago).toBe(123.45);
  expect(rows[0].data_pagamento).toBe("2026-11-02");
  expect(store.getFaturas()[0].status).toBe("aberta");
  expect(alerts).toEqual([]);
  reload(); expect(store.getFaturas()[0].valorPago).toBe(123.45);
});
test("pagamento repetido preserva data/valor sem duplicar INSERT ou UPDATE", async () => {
  await paid();
  await store.marcarFaturaPaga("card", 10, 2026, { valorPago: 999 });
  expect(writes).toEqual(["insert"]);
  expect(rows).toHaveLength(1);
  expect(rows[0].valor_pago).toBe(123.45);
});
test("duplo clique e ação oposta concorrente bloqueados antes de escrita", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  pause = () => gate;
  const first = paid();
  await expect(paid()).rejects.toThrow("andamento");
  await expect(reopen()).rejects.toThrow("andamento");
  expect(store.getFaturas()).toEqual([]);
  expect(alerts).toEqual([]);
  release(); await first;
  expect(writes).toEqual(["insert"]);
});
for (const op of ["insert", "update"]) {
  test(op + " sem confirmação de linha nunca resolve como sucesso", async () => {
    if (op !== "insert") seed(op === "delete" ? "paga" : "aberta");
    const previous = structuredClone(store.getFaturas());
    noRow = true;
    await expect(op === "delete" ? reopen() : paid()).rejects.toThrow("confirmar");
    expect(store.getFaturas()).toEqual(previous);
    expect(alerts).toEqual([]);
  });
}
for (const op of ["insert", "update"]) {
  test("resposta perdida após " + op + ": retry consulta banco sem duplicar", async () => {
    if (op !== "insert") seed(op === "delete" ? "paga" : "aberta");
    lostResponse = true;
    await expect(op === "delete" ? reopen() : paid()).rejects.toThrow("response lost");
    expect(alerts).toEqual([]);
    lostResponse = false;
    await (op === "delete" ? reopen() : paid());
    expect(writes).toEqual([op]);
    const state = structuredClone(store.getFaturas());
    reload(); expect(store.getFaturas()).toEqual(state);
  });
}
test("sessão trocada durante leitura não escreve nem altera novo usuário", async () => {
  let release!: () => void;
  pause = () => new Promise<void>(r => { release = r; });
  const pending = paid();
  await Promise.resolve(); await Promise.resolve();
  store.setActiveUserId("other");
  release();
  await expect(pending).rejects.toThrow("sessão");
  expect(writes).toEqual([]); expect(alerts).toEqual([]);
  expect(store.getFaturas()).toEqual([]);
});
test("sem usuário ou sem permissão rejeita em vez de sucesso silencioso", async () => {
  store.setActiveUserId(null);
  await expect(paid()).rejects.toThrow();
  store.setActiveUserId("owner"); store.setStoreCanWrite(false);
  await expect(reopen()).rejects.toThrow();
  expect(writes).toEqual([]);
});

// Executa os handlers reais extraídos via AST, sem carregar Router/DOM ou rede.
const route = readFileSync(new URL("../src/routes/cartoes.index.tsx", import.meta.url), "utf8");
function handler(name: string, deps: Record<string, unknown>) {
  const ast = ts.createSourceFile("route.tsx", route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!text) throw new Error("handler missing");
  const js = ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return new Function(...Object.keys(deps), js + ";return " + name)(...Object.values(deps));
}
for (const name of ["handleMarcarPaga", "togglePaga"]) {
  for (const status of name === "togglePaga" ? ["aberta","paga"] : ["aberta"]) {
    test(name + "/" + status + ": erro não gera toast de sucesso; retry e clique duplo", async () => {
      let release!: () => void;
      let reject!: (e: Error) => void;
      let calls = 0, success = 0, errors = 0;
      const busy = { current: false };
      const states: boolean[] = [];
      const mutation = () => {
        calls++;
        return new Promise<void>((r,j) => { release = r; reject = j; });
      };
      const fn = handler(name, {
        cartao: { id: "card" }, fatRef: { mes: 10, ano: 2026 },
        ref: { mes:10,ano:2026 }, status,
        faturaResumo: { total:123.45 }, resumo: { total:123.45 },
        marcarFaturaPaga: mutation, desmarcarFaturaPaga: mutation,
        pagamentoEmCurso: busy, setSalvandoPagamento: (v:boolean) => states.push(v),
        toast: { success: () => success++ }, toastFromError: () => errors++,
        t: (v:string) => v, console: { error: () => {} },
      });
      const event = { stopPropagation() {} };
      const first = fn(event);
      await fn(event);
      expect(calls).toBe(1); expect(success).toBe(0);
      reject(new Error("persist failed")); await first;
      expect(success).toBe(0); expect(errors).toBe(1);
      expect(busy.current).toBe(false);
      const retry = fn(event); release(); await retry;
      expect(success).toBe(1);
      expect(states).toEqual([true,false,true,false]);
    });
  }
}

test("estado e alertas aguardam a resposta da escrita", async () => {
  seed();
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  pause = op => op === "update" ? gate : Promise.resolve();
  const pending = paid();
  await new Promise(r => setTimeout(r, 0));
  expect(store.getFatura("card",10,2026)?.status).toBe("aberta");
  expect(alerts).toEqual([]);
  release(); await pending;
  expect(store.getFatura("card",10,2026)?.status).toBe("paga");
});
test("concorrente externo no INSERT causa conflito, não duplica nem confirma falso sucesso", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  pause = op => op === "insert" ? gate : Promise.resolve();
  const pending = paid();
  await new Promise(r => setTimeout(r, 0));
  seed("paga"); // Outro cliente persistiu depois do SELECT deste cliente.
  store.getFaturas().splice(0);
  release();
  await expect(pending).rejects.toMatchObject({ code: "23505" });
  expect(rows).toHaveLength(1);
  expect(store.getFaturas()).toEqual([]);
  expect(alerts).toEqual([]);
  pause = null;
  await paid(); // Reconsulta recupera a linha sem INSERT adicional.
  expect(rows).toHaveLength(1);
  expect(store.getFatura("card",10,2026)?.status).toBe("paga");
});
test("resposta de escrita da sessão anterior não contamina memória/alertas da nova", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  pause = op => op === "insert" ? gate : Promise.resolve();
  const pending = paid();
  await new Promise(r => setTimeout(r, 0));
  store.setActiveUserId("other");
  release();
  await expect(pending).rejects.toThrow("sessão");
  expect(store.getFaturas()).toEqual([]);
  expect(alerts).toEqual([]);
});
