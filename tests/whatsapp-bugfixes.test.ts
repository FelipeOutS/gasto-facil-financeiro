/**
 * Regressão dos 3 bugs do canário (data/fuso, resumo duplicado, resposta inválida).
 */
import { test, expect, beforeEach, afterAll } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp, formatarConfirmacao } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";

function cartoesMercadoPago(): Record<string, unknown>[] {
  return [
    {
      id: "c-mp",
      nome: "Mercado Pago",
      banco: "Mercado Pago",
      limite_total: 0,
      dia_fechamento: 1,
      dia_vencimento: 10,
      cor: "#000",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
}

beforeEach(() => {
  resetState({ cartoes: cartoesMercadoPago() });
});

// ---------- Bug 1: fuso horário ----------

test("mensagem às 22h em America/Sao_Paulo salva a data local (não rola para o dia seguinte)", async () => {
  // 21/06/2026 01:00 UTC = 20/06/2026 22:00 em America/Sao_Paulo
  const originalNow = Date.now;
  const fixed = new Date("2026-06-21T01:00:00Z").getTime();
  Date.now = () => fixed;
  // monkey-patch construtor para honrar Date.now()
  const RealDate = Date;
  // @ts-expect-error patch global
  globalThis.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<typeof RealDate>) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  };

  try {
    await processarMensagemWhatsApp({
      telefone: tel,
      texto: "Mercado 45,90 hoje no cartão Mercado Pago",
      external_id: "tz-1",
    });
    await processarMensagemWhatsApp({
      telefone: tel,
      texto: "sim",
      external_id: "tz-2",
    });
    const gasto = gastosInserts()[0]?.row;
    expect(gasto?.data).toBe("2026-06-20");
    expect(gasto?.ano).toBe(2026);
    expect(gasto?.mes).toBe(6);
  } finally {
    // @ts-expect-error restore
    globalThis.Date = RealDate;
    Date.now = originalNow;
  }
});

// ---------- Bug 2: resumo limpo, sem categoria duplicada ----------

test("Mercado 45,90 → cartão → Mercado Pago: resumo separa Descrição/Categoria sem duplicar", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 45,90",
    external_id: "r1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "r2",
  });
  const r3 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado Pago",
    external_id: "r3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");

  // não pode existir "Mercado mercado 45,90" no resumo
  expect(r3.resposta).not.toMatch(/Mercado\s+mercado/i);
  expect(r3.resposta).not.toMatch(/Categoria:.*45[,.]\s*9/i);
  // estrutura esperada
  expect(r3.resposta).toMatch(/Descri[cç][aã]o:\s*Mercado/);
  expect(r3.resposta).toMatch(/Categoria:\s*Mercado\b/);
  expect(r3.resposta).toMatch(/Valor:\s*R\$\s*45,90/);
  expect(r3.resposta).toMatch(/Pagamento:.*Mercado Pago/i);

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "r4",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.descricao).toBe("Mercado");
  expect(gasto?.estabelecimento).toBe("Mercado");
  expect(gasto?.cartao_id).toBe("c-mp");
});

// ---------- Bug 3: resposta inválida durante confirmação ----------

test('"sin" durante aguardando_confirmacao não cria gasto, não reinicia sessão e responde curto', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 45,90 pix",
    external_id: "s1",
  });
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  const snapshotValor = state.pendingRow?.parsed?.valor;

  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sin",
    external_id: "s2",
  });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toMatch(/n[aã]o entendi/i);
  expect(r.resposta).not.toMatch(/Categoria:/);
  expect(r.resposta).not.toMatch(/Descri[cç][aã]o:/);
  expect(gastosInserts()).toHaveLength(0);
  // sessão original intacta
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  expect(state.pendingRow?.parsed?.valor).toBe(snapshotValor);
});

test('"sim" depois de "sin" cria exatamente um gasto', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 45,90 pix",
    external_id: "ss1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sin",
    external_id: "ss2",
  });
  expect(gastosInserts()).toHaveLength(0);
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "ss3",
  });
  expect(r.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
});

test('"não" cancela sessão sem criar gasto', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 45,90 pix",
    external_id: "n1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "não",
    external_id: "n2",
  });
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).toBeNull();
});

// sanidade: formatarConfirmacao não emite categoria com texto cru
test("formatarConfirmacao nunca repete valor ou mensagem original na categoria", () => {
  const out = formatarConfirmacao({
    nome: "Mercado",
    valor: 45.9,
    data: "2026-06-20",
    formaPagamento: "credito",
    cartaoNomeDetectado: "Mercado Pago",
    mensagemOriginal: "Mercado 45,90",
    confianca: 0.9,
    notas: [],
  });
  expect(out).toMatch(/Categoria:\s*Mercado\b/);
  expect(out).not.toMatch(/Categoria:.*45/);
  expect(out).not.toMatch(/Mercado\s+mercado/i);
});

afterAll(() => {});
