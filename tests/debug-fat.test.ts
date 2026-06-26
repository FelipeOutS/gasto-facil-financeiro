import { test } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";
import { loadCartoesDoUsuario } from "../src/server/cartao-fatura.server";

test("debug", async () => {
  resetState();
  console.log("STATE", state.cartoesData.length);
  const out = await loadCartoesDoUsuario("u1");
  console.log("OUT", out.length, out[0]);
});
