/** P0 — milhar PT-BR no fluxo simulado (sem rede, Supabase fake). */
import { test, expect, beforeEach } from "bun:test";
process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET ??= "test-secret-ficticio-0123456789abcdef";
import { resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511900000001";
let seq = 0;
const send = (texto: string) =>
  processarMensagemWhatsApp({ telefone: tel, texto, external_id: `p0v-${++seq}` });

beforeEach(() => resetState({}));

test("R$ 1.950,00 mercado mostra R$ 1.950,00 na confirmação", async () => {
  const r = await send("Gastei R$ 1.950,00 no mercado no pix");
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).toMatch(/R\$\s1.950,00/);
  expect(gastosInserts()).toHaveLength(0);
});

test("Mercado 1.950 hoje no pix não mostra R$ 1,95", async () => {
  const r = await send("Mercado 1.950 hoje no pix");
  expect(r.resposta).toMatch(/R\$\s1.950,00/);
  expect(r.resposta).not.toMatch(/R\$\s1,95/);
});

test("Ajustar valor '2.500' => R$ 2.500,00 e salva 2500, nunca 2,50", async () => {
  await send("Gastei 12,60 no Uber em dinheiro");
  await send("ajustar");
  const a = await send("valor");
  expect(a.status).toBe("aguardando_ajuste_valor");
  const r = await send("2.500");
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).toMatch(/R\$\s2.500,00/);
  expect(r.resposta).not.toMatch(/R\$\s2,50/);
  const s = await send("confirmar");
  expect(s.status).toBe("salva");
  const ins = gastosInserts();
  expect(ins).toHaveLength(1);
  expect(Number((ins[0] as any).row.valor)).toBe(2500);
});

test("Ajustar valor malformado '2.500.00' pede de novo, sem salvar", async () => {
  await send("Gastei 12,60 no Uber em dinheiro");
  await send("ajustar");
  await send("valor");
  const r = await send("2.500.00");
  expect(r.status).toBe("aguardando_ajuste_valor");
  expect(gastosInserts()).toHaveLength(0);
});
