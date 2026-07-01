import "./_whatsapp-fake";
import { it } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
it("dbg", async () => {
  resetState({});
  await processarMensagemWhatsApp({ telefone: "5511999998888", texto: "Pix 50 para João Silva chave (11) 99999-8888", external_id: "d1" });
  const msgs = state.inserts.filter((i:any)=>i.table==='whatsapp_messages');
  for (const m of msgs) {
    console.log("---msg---", m.row.status);
    console.log("parsed:", JSON.stringify(m.row.parsed));
  }
  console.log("secrets:", state.pixPendingSecretsData);
});
