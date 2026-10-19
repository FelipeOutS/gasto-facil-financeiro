import { describe, expect, it } from "bun:test";
import { createImportDeps, importSchemaReady } from "@/server/pluggy/pluggy-import-store.server";
import { runIncrementalAfterSync } from "@/server/pluggy/pluggy-import.server";
import { planImport, type PlanTx } from "@/lib/pluggy/import-plan";

const F = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const tx: PlanTx = { transaction_id: "t", account_id: "a", account_type: "BANK", description: "Salário", amount: 100, amount_original: 100, date: "2026-05-05", status: "POSTED", type: "CREDIT", operation_type: null, installment_number: null, total_installments: null, classification: "receita", classification_reason: "entrada", categoria_manual: null, categoria_sugerida: "Salário", review_status: null, mp_match_ids: null, deleted_at: null };
type Data = Record<string, Array<Record<string, unknown>>>;
// Small query fake exercises concrete query scoping and pagination, not source text.
function database(data: Data, missing = false) {
  return { from(table: string) {
    let list = data[table] ?? [];
    const error = missing && table.startsWith("pluggy_") && !["pluggy_items", "pluggy_accounts", "pluggy_transactions"].includes(table) ? { code: "PGRST205" } : null;
    const q = {
      select: (_: string) => q,
      eq: (key: string, value: unknown) => { list = list.filter((r) => r[key] === value); return q; },
      is: (key: string, value: unknown) => { list = list.filter((r) => (r[key] ?? null) === value); return q; },
      gte: (key: string, value: string) => { list = list.filter((r) => String(r[key]) >= value); return q; },
      lte: (key: string, value: string) => { list = list.filter((r) => String(r[key]) <= value); return q; },
      order: (_: string) => q,
      limit: (n: number) => Promise.resolve({ data: list.slice(0, n), error }),
      range: (start: number, end: number) => Promise.resolve({ data: list.slice(start, end + 1), error }),
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: list, error }).then(resolve),
    };
    return q;
  } };
}

describe("Pluggy Fase3 wiring", () => {
  it("null status is not normalized to POSTED by preview", () => {
    const result = planImport({ userId: F, categorias: [], cardLinks: [], existing: [], imported: [], txs: [{ ...tx, status: null }] });
    expect(result[0]).toMatchObject({ op: "skip", reason: "pendente_aguardando_confirmacao" });
  });
  it("snapshot preserves actual status/type counts: POSTED 40, CREDIT 20, DEBIT 20", async () => {
    const { default: fixture } = await import("./fixtures/pluggy-sandbox-40.json");
    expect(fixture.filter((t) => t.status === "POSTED")).toHaveLength(40);
    expect(fixture.filter((t) => t.type === "CREDIT")).toHaveLength(20);
    expect(fixture.filter((t) => t.type === "DEBIT")).toHaveLength(20);
  });
  it("incremental default stays blocked before any DB/service import", async () => {
    expect(await runIncrementalAfterSync(F)).toEqual({ ok: true, blocked: true });
  });
  it("reads only owner's active Sandbox accounts", async () => {
    const db = database({
      pluggy_items: [{ user_id: F, item_id: "i", is_sandbox: true }, { user_id: F, item_id: "live", is_sandbox: false }],
      pluggy_accounts: [{ user_id: F, account_id: "a", item_id: "i", type: "BANK", is_sandbox: true }, { user_id: F, account_id: "b", item_id: "live", type: "BANK", is_sandbox: false }],
      pluggy_transactions: [{ ...tx, user_id: F, is_sandbox: true }, { ...tx, user_id: "other", is_sandbox: true }, { ...tx, account_id: "b", user_id: F, is_sandbox: false }],
    });
    expect((await createImportDeps(db).txs(F)).map((t) => t.account_id)).toEqual(["a"]);
  });
  it("missing candidate schema permits preview only, no assumed links/entries", async () => {
    const db = database({}, true);
    expect(await importSchemaReady(db, F)).toBe(false);
    expect(await createImportDeps(db).cardLinks(F)).toEqual([]);
    expect(await createImportDeps(db).imported(F)).toEqual([]);
  });
  it("paginates >1000 entries and includes duplicate date boundaries ±1 day", async () => {
    const receita = (i: number, date: string) => ({ id: String(i), user_id: F, valor: 100, data: date, descricao: "Salário", origem: "manual" });
    const db = database({ receitas: [...Array.from({ length: 1001 }, (_, i) => receita(i, "2026-05-05")), receita(1001, "2026-05-04"), receita(1002, "2026-05-06"), receita(1003, "2026-05-07")] });
    expect((await createImportDeps(db).existing(F, "2026-05-05", "2026-05-05")).length).toBe(1003);
  });
  it("pending previously-imported source is reviewed, never updated", () => {
    const snapshot = { valor: 100, data: tx.date, descricao: "Salário" };
    const result = planImport({ userId: F, categorias: [], cardLinks: [], existing: [], txs: [{ ...tx, amount: 200, status: "PENDING" }], imported: [{ transaction_id: "t", account_id: "a", entry_table: "receitas", entry_id: "e", snapshot, current: snapshot, state: "ativo" }] });
    expect(result[0]).toMatchObject({ op: "review", reason: "importada_voltou_para_pendente" });
  });
  it("notes/card edits detected via timestamp prevent updates", () => {
    const snapshot = { valor: 100, data: tx.date, descricao: "Salário", updated_at: "2026-05-05T00:00:00Z" };
    const result = planImport({ userId: F, categorias: [], cardLinks: [], existing: [], txs: [{ ...tx, amount: 200 }], imported: [{ transaction_id: "t", account_id: "a", entry_table: "receitas", entry_id: "e", snapshot, current: { ...snapshot, updated_at: "2026-05-05T01:00:00Z" }, state: "ativo" }] });
    expect(result[0]).toMatchObject({ op: "review", reason: "atualizacao_conflita_com_edicao_manual" });
  });
});