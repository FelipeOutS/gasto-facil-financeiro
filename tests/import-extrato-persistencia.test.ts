import { beforeAll, afterAll, beforeEach, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let loseResponse = false;
let pause: Promise<void> | null = null;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      // No client-side writes allowed in this import path.
      return {
        select: () => ({
          eq: async (_field: string, id: string) => ({
            data: (
              await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE user_id=$1`, [
                id,
              ])
            ).rows.map((r: any) => r.row),
            error: null,
          }),
        }),
      };
    },
    async rpc(name: string, args: any) {
      expect(name).toBe("import_extrato_atomic");
      if (pause) await pause;
      try {
        const result = await db.query<{ result: any }>(
          "SELECT public.import_extrato_atomic($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) AS result",
          [
            args.p_owner_id,
            args.p_batch_id,
            JSON.stringify(args.p_gastos),
            JSON.stringify(args.p_receitas),
            JSON.stringify(args.p_transferencias),
            JSON.stringify(args.p_extrato),
          ],
        );
        if (loseResponse) {
          loseResponse = false;
          throw Error("Response lost after commit");
        }
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },
}));
const store = await import("../src/lib/store");
const migration = async (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END';`);
  const base = await migration("20260424172418_824996a1-2d41-4090-a056-93d3c267449c.sql");
  await db.exec(base.split("-- ============= LIMITES")[0]);
  await db.exec(`ALTER TABLE gastos ADD COLUMN cartao_id uuid, ADD COLUMN horario text,
    ADD COLUMN origem text, ADD COLUMN invoice_month text;
    ALTER TABLE receitas ADD COLUMN deleted_at timestamptz;
    CREATE TABLE dinheiro_guardado(id uuid); CREATE TABLE movimentacoes_meta(id uuid);`);
  await db.exec(await migration("20260429030746_8e0ca191-85c8-4155-a6db-25b0eff1fcfa.sql"));
  await db.exec(await migration("20260429133308_f58c81c3-4272-478e-9ef4-9ef1c5084f8c.sql"));
  await db.exec(await migration("20260924120000_import_extrato_atomic.sql"));
  await db.exec(`CREATE FUNCTION import_test_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE n integer;
    BEGIN
      IF current_setting('test.fail_table',true) = TG_TABLE_NAME THEN RAISE EXCEPTION 'simulated insert failure'; END IF;
      IF TG_TABLE_NAME = 'extratos_importados' THEN
        SELECT (SELECT count(*) FROM gastos WHERE import_batch_id=NEW.id)
          + (SELECT count(*) FROM receitas WHERE import_batch_id=NEW.id)
          + (SELECT count(*) FROM transferencias_internas WHERE import_batch_id=NEW.id) INTO n;
        IF n <> NEW.qtd_movimentacoes THEN RAISE EXCEPTION 'history before financial rows'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO auth.users VALUES ('${owner}'),('${other}');`);
  for (const table of ["gastos", "receitas", "transferencias_internas", "extratos_importados"]) {
    await db.exec(
      `CREATE TRIGGER test_import_guard BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION import_test_guard()`,
    );
  }
});
afterAll(() => db.close());
beforeEach(async () => {
  pause = null;
  loseResponse = false;
  await db.exec(
    "RESET ROLE; TRUNCATE gastos,receitas,transferencias_internas,extratos_importados; SELECT set_config('test.fail_table','',false);",
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("SET ROLE authenticated");
  store.setActiveUserId(null);
  store.setActiveUserId(owner);
  store.setStoreCanWrite(true);
});
function input(mixed = false) {
  return {
    batchId: crypto.randomUUID(),
    gastos: [
      {
        descricao: "Mercado",
        valor: 42,
        data: "2026-09-20",
        categoriaId: "outros",
        formaPagamento: "debito" as const,
        idOperacaoBanco: "bank-expense",
      },
    ],
    receitas: mixed
      ? [
          {
            descricao: "Salário",
            valor: 100,
            data: "2026-09-20",
            tipo: "salario" as const,
            idOperacaoBanco: "bank-income",
          },
        ]
      : [],
    transferencias: mixed
      ? [
          {
            descricao: "Entre contas",
            valor: 20,
            data: "2026-09-20",
            idOperacaoBanco: "bank-transfer",
          },
        ]
      : [],
    historico: {
      tipoOrigem: "csv" as const,
      nomeArquivo: "extrato.csv",
      qtdDuplicadasIgnoradas: 0,
    },
  };
}
async function counts() {
  const rows = await db.query<{ g: number; r: number; t: number; h: number }>(`SELECT
    (SELECT count(*)::int FROM gastos) g, (SELECT count(*)::int FROM receitas) r,
    (SELECT count(*)::int FROM transferencias_internas) t, (SELECT count(*)::int FROM extratos_importados) h`);
  return rows.rows[0];
}
test("expense persists, batch is linked, history is last, and refetch restores Gastos", async () => {
  const request = input();
  const result = await store.importExtratoPersistido(request);
  expect(result.gastos[0].importBatchId).toBe(request.batchId);
  expect(result.gastos[0].idOperacaoBanco).toBe("bank-expense");
  expect(result.gastos[0].confirmado).toBe(true);
  expect(result.extrato?.qtdMovimentacoes).toBe(1);
  expect(await counts()).toEqual({ g: 1, r: 0, t: 0, h: 1 });
  store.setActiveUserId(null);
  store.setActiveUserId(owner);
  expect(store.getGastos()).toHaveLength(0);
  await store.refreshGastos();
  expect(store.getGastos()).toHaveLength(1);
  expect(store.getGastos()[0].importBatchId).toBe(request.batchId);
});
test("mixed batch persists in the three correct tables", async () => {
  const result = await store.importExtratoPersistido(input(true));
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
  expect(result.extrato).toMatchObject({
    qtdMovimentacoes: 3,
    totalDespesas: 42,
    totalReceitas: 100,
    totalTransferencias: 20,
  });
  expect(store.getReceitas()[0].idOperacaoBanco).toBe("bank-income");
  expect(store.getTransferenciasInternas()[0].idOperacaoBanco).toBe("bank-transfer");
});
for (const table of ["gastos", "receitas", "transferencias_internas", "extratos_importados"]) {
  test(`failure inserting ${table} rolls back the entire batch, including history and memory`, async () => {
    await db.query("SELECT set_config('test.fail_table',$1,false)", [table]);
    await expect(store.importExtratoPersistido(input(true))).rejects.toThrow(
      "simulated insert failure",
    );
    expect(await counts()).toEqual({ g: 0, r: 0, t: 0, h: 0 });
    expect(store.getGastos()).toHaveLength(0);
    expect(store.getReceitas()).toHaveLength(0);
    expect(store.getTransferenciasInternas()).toHaveLength(0);
    expect(store.getExtratosImportados()).toHaveLength(0);
  });
}
test("no optimistic rows or success while database confirmation is pending", async () => {
  let release!: () => void;
  pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  const pending = store.importExtratoPersistido(input()).then((result) => {
    finished = true;
    return result;
  });
  expect(finished).toBe(false);
  expect(store.getGastos()).toHaveLength(0);
  expect(store.getExtratosImportados()).toHaveLength(0);
  release();
  await pending;
  expect(finished).toBe(true);
});
test("lost response retries the same batch without duplicate rows or memory entries", async () => {
  const request = input(true);
  loseResponse = true;
  await expect(store.importExtratoPersistido(request)).rejects.toThrow("Response lost");
  expect(store.getGastos()).toHaveLength(0);
  const retried = await store.importExtratoPersistido(request);
  await store.importExtratoPersistido(request);
  expect(retried.extrato?.qtdMovimentacoes).toBe(3);
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
  expect(store.getGastos()).toHaveLength(1);
  expect(store.getExtratosImportados()).toHaveLength(1);
});
test("reimport in another batch and within-batch duplicates are ignored by operation ID", async () => {
  const request = input(true);
  request.gastos.push({ ...request.gastos[0] });
  expect((await store.importExtratoPersistido(request)).duplicados).toBe(1);
  const again = await store.importExtratoPersistido({ ...request, batchId: crypto.randomUUID() });
  expect(again.gastos).toHaveLength(0);
  expect(again.extrato).toBeNull();
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
});
test("reimport without bank IDs is deduplicated after memory reset", async () => {
  const request = input(true);
  for (const row of [...request.gastos, ...request.receitas, ...request.transferencias])
    row.idOperacaoBanco = "";
  await store.importExtratoPersistido(request);
  store.setActiveUserId(null);
  store.setActiveUserId(owner);
  await store.importExtratoPersistido({ ...request, batchId: crypto.randomUUID() });
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
});
test("RLS rejects another owner without any partial import", async () => {
  store.setActiveUserId(other);
  await expect(store.importExtratoPersistido(input(true))).rejects.toThrow();
  expect(await counts()).toEqual({ g: 0, r: 0, t: 0, h: 0 });
});
test("account switch during request does not publish rows into another account", async () => {
  let release!: () => void;
  pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = store.importExtratoPersistido(input());
  store.setActiveUserId(other);
  release();
  await pending;
  expect(store.getGastos()).toHaveLength(0);
  expect(store.getExtratosImportados()).toHaveLength(0);
});

test("different bank IDs preserve separate transactions with the same date, description and amount", async () => {
  const request = input();
  request.gastos.push({ ...request.gastos[0], idOperacaoBanco: "another-bank-operation" });
  const result = await store.importExtratoPersistido(request);
  expect(result.gastos).toHaveLength(2);
  expect(store.getItensDoBatch(request.batchId).gastos).toHaveLength(2);
  expect(result.extrato?.totalDespesas).toBe(84);
});

test("rollback of a new batch preserves earlier imports", async () => {
  const first = await store.importExtratoPersistido(input());
  await db.query("SELECT set_config('test.fail_table',$1,false)", ["receitas"]);
  const next = input(true);
  next.gastos[0].idOperacaoBanco = "new-operation";
  await expect(store.importExtratoPersistido(next)).rejects.toThrow();
  expect(await counts()).toEqual({ g: 1, r: 0, t: 0, h: 1 });
  expect(store.getGastos()[0].id).toBe(first.gastos[0].id);
  expect(store.getItensDoBatch(next.batchId).gastos).toHaveLength(0);
});

test("RPC works without gastos.deleted_at and uses the confirmed Lovable Cloud column types", async () => {
  const { rows } = await db.query<{ table_name: string; column_name: string; udt_name: string }>(`
    SELECT table_name, column_name, udt_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('gastos','receitas','extratos_importados')
  `);
  const types = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row.udt_name]));
  expect(types.has("gastos.deleted_at")).toBe(false);
  for (const [column, type] of Object.entries({
    "extratos_importados.tipo_origem": "text",
    "extratos_importados.status": "text",
    "gastos.forma_pagamento": "text",
    "gastos.tipo_gasto": "text",
    "gastos.categoria_id": "uuid",
    "gastos.cartao_id": "uuid",
    "receitas.tipo": "text",
    "receitas.deleted_at": "timestamptz",
  }))
    expect(types.get(column)).toBe(type);
  const request = input(true);
  const result = await store.importExtratoPersistido(request);
  expect(result.extrato?.qtdMovimentacoes).toBe(3);
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
  const duplicate = await store.importExtratoPersistido({
    ...request,
    batchId: crypto.randomUUID(),
  });
  expect(duplicate.duplicados).toBe(3);
  expect(await counts()).toEqual({ g: 1, r: 1, t: 1, h: 1 });
});

test("dedup ignores soft-deleted receitas while preserving active expense and transfer dedup", async () => {
  const request = input(true);
  await store.importExtratoPersistido(request);
  await db.query("UPDATE receitas SET deleted_at=now() WHERE user_id=$1", [owner]);
  const result = await store.importExtratoPersistido({ ...request, batchId: crypto.randomUUID() });
  expect(result.gastos).toHaveLength(0);
  expect(result.transferencias).toHaveLength(0);
  expect(result.receitas).toHaveLength(1);
  expect(result.duplicados).toBe(2);
  expect(result.extrato?.qtdMovimentacoes).toBe(1);
  expect(await counts()).toEqual({ g: 1, r: 2, t: 1, h: 2 });
});
