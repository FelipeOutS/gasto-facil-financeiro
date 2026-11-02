import {test,expect,mock} from "bun:test";
let calls=0;
const forbidden=()=>{calls++;throw Error("financial I/O forbidden");};
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{from:forbidden,rpc:forbidden}}));
const {persistirReceita,startReceitaFromText}=await import("../src/server/whatsapp-receitas.server");
const {persistirGasto}=await import("../src/server/whatsapp.server");
test("adiantamento conhecido não cria gasto nem receita, nem consome quota",async()=>{
 const text="Adiantei 185 de empréstimo para minha mãe";
 expect(startReceitaFromText(text).status).toBe("cancelada");
 expect((await persistirReceita("fixture",{kind:"receita",mensagemOriginal:text,descricao:"Devolução",valor:185},"fixture-message")).ok).toBe(false);
 expect((await persistirGasto("fixture",{mensagemOriginal:text,nome:"Adiantamento",valor:185} as never,"fixture-message")).ok).toBe(false);
 expect(calls).toBe(0);
});
