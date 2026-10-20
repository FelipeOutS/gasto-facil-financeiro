import { expect, test } from "bun:test";
import { runAuthorizedRealBatches, type AutomaticDeps } from "../src/server/pluggy/pluggy-real-automatic.server";
import type { PlanAction } from "../src/lib/pluggy/import-plan";
const owner = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const item = { account_id: "a", transaction_id: "t" };
const action: PlanAction = { op: "insert", table: "receitas", ...item, row: { descricao: "Test", valor: 1, data: "2026-10-19", tipo: "outros", origem: "pluggy", id_operacao_banco: "pluggy:a:t" } };
const setup = () => {
  let calls = 0;
  const deps: AutomaticDeps = { roles: async () => ["owner"], enabled: async () => true, grants: async () => [{ batch_id: "b", expires_at: "2099-01-01", items: [item] }], plan: async () => [action], apply: async () => { calls++; } };
  return { deps, calls: () => calls };
};
test("real automation defaults off before reading any financial data", async () => {
  const s=setup(); s.deps.roles=async()=>{throw Error("must not read")};
  expect(await runAuthorizedRealBatches(owner,s.deps)).toEqual({blocked:true,batches:0});
});
test("Michael cannot use first real financial automation", async () => {
  const s=setup(); await expect(runAuthorizedRealBatches("47df50ce-df1e-4c54-8fae-0ffb5105478d",s.deps,true)).rejects.toThrow("pluggy_nao_autorizado"); expect(s.calls()).toBe(0);
});
test("only exact eligible authorized selection is submitted", async () => {
  const s=setup(); expect(await runAuthorizedRealBatches(owner,s.deps,true)).toEqual({batches:1}); expect(s.calls()).toBe(1);
  s.deps.plan=async()=>[{op:"review",...item,reason:"ambiguous"}];
  expect(await runAuthorizedRealBatches(owner,s.deps,true)).toEqual({batches:0}); expect(s.calls()).toBe(1);
});
test("revocation while planning prevents submission", async () => {
  const s=setup(); let checks=0;s.deps.enabled=async()=>++checks===1;
  expect(await runAuthorizedRealBatches(owner,s.deps,true)).toEqual({batches:0}); expect(s.calls()).toBe(0);
});
