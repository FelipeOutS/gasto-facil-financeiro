// Gera SQL de semente (Sandbox) + plano de importação para o banco DESCARTÁVEL.
import fixture from "../../fixtures/pluggy-sandbox-40.json";
import { planImport, type PlanTx } from "@/lib/pluggy/import-plan";
const F = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const CARD = "1df8e595-a756-4c47-b2ad-20fc8c4d8da8";
const q = (v: unknown) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const CATS = ["Contas", "Moradia", "Saúde", "Assinaturas", "Alimentação", "Outros"].map((n, i) => ({ id: `00000000-0000-0000-0000-0000000c00${i}0`, nome: n }));
const CARTAO = "00000000-0000-0000-0000-00000000ca01";
const out: string[] = [];
out.push(`INSERT INTO public.pluggy_items(user_id,item_id,is_sandbox) VALUES ('${F}','itemF',true);`);
const accts = [...new Map(fixture.map((x) => [x.accountId, x.acct])).entries()];
for (const [a, t] of accts) out.push(`INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES ('${F}','itemF',${q(a)},${q(t)},true);`);
for (const c of CATS) out.push(`INSERT INTO public.categorias(id,user_id,nome,icon_name,color_var) VALUES ('${c.id}','${F}',${q(c.nome)},'x','x');`);
out.push(`INSERT INTO public.cartoes(id,user_id,nome,banco,dia_fechamento,dia_vencimento) VALUES ('${CARTAO}','${F}','Black','Pluggy',25,5);`);
for (const x of fixture) {
  out.push(`INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,amount_original,date,status,type,classification,classification_reason,categoria_sugerida,installment_number,total_installments,is_sandbox) VALUES ('${F}','itemF',${q(x.accountId)},${q(x.id)},${q("k" + x.id)},${q(x.description)},${Math.abs(x.amount)},${x.amount},${q(x.date)},${q(x.status)},${q(x.type)},${q(x.cls)},${q(x.reason)},${q(x.cat)},${x.inst ?? "NULL"},${x.total ?? "NULL"},true);`);
}
const txs: PlanTx[] = fixture.map((x) => ({ transaction_id: x.id, account_id: x.accountId, account_type: x.acct as "BANK", description: x.description, amount: Math.abs(x.amount), amount_original: x.amount, date: x.date, status: x.status, type: x.type as "DEBIT", operation_type: x.operationType, installment_number: x.inst, total_installments: x.total, classification: x.cls as "gasto", classification_reason: x.reason, categoria_sugerida: x.cat, categoria_manual: null, review_status: null, mp_match_ids: null, deleted_at: null }));
const writes = (links: boolean) => planImport({ userId: F, txs, categorias: CATS, imported: [], existing: [], cardLinks: links ? [{ account_id: CARD, cartao_id: CARTAO, dia_fechamento: 25, dia_vencimento: 5 }] : [] })
  .filter((a) => a.op === "insert");
out.push(`\\set plan_nolink '${JSON.stringify(writes(false)).replace(/'/g, "''")}'`);
out.push(`\\set plan '${JSON.stringify(writes(true)).replace(/'/g, "''")}'`);
out.push(`\\set CARD '${CARD}'`); out.push(`\\set CARTAO '${CARTAO}'`);
console.log(out.join("\n"));
