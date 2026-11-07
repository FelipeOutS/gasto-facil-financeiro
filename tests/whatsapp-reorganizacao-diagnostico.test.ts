import { test, expect } from "bun:test";
import { dispatchReorganization, isDiagnosticRequest } from "../src/server/whatsapp-reorganization-dispatch.server";
import { buildReorganizationDiagnostic, supabaseDiagReader } from "../src/server/whatsapp-reorganizacao-diagnostico.server";

const base = { userId: "U", phone: "5511999999999", externalId: "x", localDate: "2026-11-05", pendingSession: false };
const noStore = async () => { throw Error("store must not load"); };

test("exclua tudo returns read-only diagnostic", async () => {
  let calls = 0;
  const r = await dispatchReorganization({ ...base, text: "GI, exclua tudo" }, noStore, async () => { calls++; return "DIAG"; });
  expect(r).toBe("DIAG"); expect(calls).toBe(1);
});
test("gastos receitas e contas a pagar also diagnostic", () => {
  expect(isDiagnosticRequest("exclua meus gastos, receitas e contas a pagar")).toBe(true);
});
for (const t of ["apagar 123456", "apagar um dois três quatro cinco seis", "restaurar última limpeza", "restaurar limpeza", "cancelar limpeza"]) {
  test(`control "${t}" stays blocked without diagnostic`, async () => {
    let calls = 0;
    const r = await dispatchReorganization({ ...base, text: t }, noStore, async () => { calls++; return "DIAG"; });
    expect(calls).toBe(0); expect(r).not.toBe("DIAG"); expect(r).not.toBeNull();
  });
}
test("normal expense is untouched", async () => {
  const r = await dispatchReorganization({ ...base, text: "gastei 10 reais no mercado" }, noStore, async () => "DIAG");
  expect(r).toBeNull();
});
test("pending session blocks diagnostic", async () => {
  const r = await dispatchReorganization({ ...base, pendingSession: true, text: "GI, exclua tudo" }, noStore, async () => "DIAG");
  expect(r).not.toBe("DIAG");
});

function fakeClient(log: string[], fail = new Set<string>()) {
  const writes: string[] = [];
  const q = (table: string) => {
    const filters: string[] = [];
    const o: any = {
      select: () => o, eq: (c: string, v: string) => (filters.push(`${c}=${v}`), o), is: () => o, not: () => o,
      insert: () => writes.push(table), update: () => writes.push(table), delete: () => writes.push(table),
      limit: async () => { log.push(`${table}:${filters.join("&")}`); return fail.has(table) ? { data: null, error: { message: "x" } } : { data: [{ valor: 10, valor_total: 5 }], error: null }; },
    };
    return o;
  };
  return { client: { from: q }, writes };
}
test("diagnostic scopes every read to the linked user and never writes", async () => {
  const log: string[] = []; const { client, writes } = fakeClient(log);
  const txt = await buildReorganizationDiagnostic(supabaseDiagReader(client, "OWNER"));
  expect(log.length).toBe(8); expect(log.every((l) => l.endsWith("user_id=OWNER"))).toBe(true);
  expect(writes.length).toBe(0); expect(txt).toContain("não é a prévia definitiva");
  expect(txt).not.toMatch(/\d{6}/);
});
test("failed read shows 'não foi possível consultar' instead of zero", async () => {
  const { client } = fakeClient([], new Set(["contas_a_pagar"]));
  const txt = await buildReorganizationDiagnostic(supabaseDiagReader(client, "OWNER"));
  expect(txt).toContain("Contas a pagar: não foi possível consultar");
});

for (const text of ["Mostrar meus gastos excluídos", "Listar receitas excluídas"]) {
  test(`consulta individual não inicia diagnóstico de limpeza: ${text}`, async () => {
    expect(isDiagnosticRequest(text)).toBe(false);
    let calls = 0;
    const result = await dispatchReorganization({ ...base, text }, noStore, async () => { calls++; return "DIAG"; });
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
}
