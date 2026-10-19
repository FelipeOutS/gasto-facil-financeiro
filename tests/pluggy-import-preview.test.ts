import { describe, it, expect } from "bun:test";
import fixture from "./fixtures/pluggy-sandbox-40.json";
import { simulateCardLinks } from "@/lib/pluggy/import-preview";
import { planImport, type PlanInput, type PlanTx } from "@/lib/pluggy/import-plan";

const txs: PlanTx[] = fixture.map((x) => ({ transaction_id:x.id, account_id:x.accountId, account_type:x.acct as PlanTx["account_type"], description:x.description, amount:Math.abs(x.amount), amount_original:x.amount, date:x.date, status:x.status, type:x.type as PlanTx["type"], operation_type:x.operationType, installment_number:x.inst, total_installments:x.total, classification:x.cls as PlanTx["classification"], classification_reason:x.reason, categoria_sugerida:x.cat, categoria_manual:null, review_status:null, mp_match_ids:null, deleted_at:null }));
const input: PlanInput = { userId:"felipe", txs, categorias:["Contas","Moradia","Saúde","Assinaturas","Outros"].map((nome,i)=>({id:String(i),nome})), imported:[],existing:[],cardLinks:[] };
const accountId = txs.find((t)=>t.account_type==="CREDIT")?.account_id ?? "missing";
const card = {id:"own-card",dia_fechamento:25,dia_vencimento:5};

describe("vínculo hipotético sem persistência",()=>{
  it("distribui todas as 40: 16 gastos, 5 receitas, 15 cartões, 1 boleto, 3 ignoradas",()=>{
    const r=simulateCardLinks(input,[card],[]);
    expect([r.resumo.gastos,r.resumo.receitas,r.resumo.revisao,r.resumo.ignorados]).toEqual([16,5,16,3]);
    expect(r.resumo.motivos.cartao_sem_vinculo_confirmado).toBe(15);
    expect(r.resumo.motivos.boleto_sem_identificacao).toBe(1);
    expect(r.resumo.motivos.pagamento_de_fatura).toBe(3);
    expect(r.actions).toHaveLength(40);
  });
  it("seleção explícita torna 15 compras elegíveis sem alterar input ou inventar cartões",()=>{
    const r=simulateCardLinks(input,[card],[{accountId,cardId:card.id}]);
    expect([r.resumo.gastos,r.resumo.receitas,r.resumo.revisao,r.resumo.ignorados]).toEqual([31,5,1,3]);
    expect(new Set(r.actions.map(a=>`${a.account_id}:${a.transaction_id}`)).size).toBe(40);
    expect(input.cardLinks).toHaveLength(0);
  });
  it("cartão que não veio da leitura do titular é rejeitado",()=>{
    expect(()=>simulateCardLinks(input,[card],[{accountId,cardId:"michael-card"}])).toThrow("pluggy_vinculo_simulado_invalido");
  });
  it("conta de outro titular é rejeitada",()=>{
    expect(()=>simulateCardLinks(input,[card],[{accountId:"michael-account",cardId:card.id}])).toThrow();
  });
  it("vínculo não aprova duplicação Mercado Pago",()=>{
    const altered={...input,txs:txs.map(t=>t.account_type==="CREDIT"?{...t,mp_match_ids:["mp-existing"]}:t)};
    const r=simulateCardLinks(altered,[card],[{accountId,cardId:card.id}]);
    expect(r.resumo.gastos).toBe(16);
    expect(r.resumo.motivos.possivel_duplicata_mercado_pago).toBe(15);
  });
  it("desvincular/corrigir não altera nem remove compras previamente relacionadas",()=>{
    const tx=txs.find(t=>t.account_type==="CREDIT");
    if(!tx) throw new Error("fixture sem cartão");
    const snapshot={valor:tx.amount,data:tx.date,descricao:tx.description??"",cartao_id:"old-card"};
    const state={...input,txs:[{...tx,deleted_at:"2026-10-19"}],imported:[{transaction_id:tx.transaction_id,account_id:tx.account_id,entry_table:"gastos" as const,entry_id:"existing",snapshot,current:snapshot,state:"ativo" as const}]};
    for(const cardLinks of [[],[{account_id:accountId,cartao_id:card.id,dia_fechamento:25,dia_vencimento:5}]]){
      expect(planImport({...state,cardLinks})[0]).toMatchObject({op:"review",reason:"vinculo_alterado_preservar_lancamento_anterior"});
    }
  });
});