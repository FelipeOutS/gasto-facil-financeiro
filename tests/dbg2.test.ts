import "./_whatsapp-fake";
import { it, expect } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
it("dbg cancel", async () => {
  resetState({});
  const r1 = await processarMensagemWhatsApp({ telefone: "5511999998888", texto: "Pix 50 para João Silva chave (11) 99999-8888", external_id: "cx1" });
  console.log("R1", r1.status);
  console.log("secrets before cancel:", state.pixPendingSecretsData.length);
  const r2 = await processarMensagemWhatsApp({ telefone: "5511999998888", texto: "cancelar", external_id: "cx2" });
  console.log("R2", r2.status, r2.resposta);
  console.log("secrets after cancel:", state.pixPendingSecretsData);
});
