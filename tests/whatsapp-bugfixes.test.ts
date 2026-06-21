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

// ---------- Bug 4: pontuação residual na descrição ----------

test('"Padaria 1,00" → descrição salva sem vírgula residual', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00 pix",
    external_id: "p1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "p2",
  });
  expect(r.status).toBe("salva");
  const g = gastosInserts()[0]?.row as Record<string, unknown>;
  expect(g.descricao).toBe("Padaria");
  expect(g.estabelecimento).toBe("Padaria");
});

// ---------- Bug 5: capitalização do cartão preservada ----------

test("cartão cadastrado com caixa errada é exibido com capitalização canônica", async () => {
  // cadastro foi gravado como "Mercado pago" (lowercase p) — display canônico
  resetState({
    cartoes: [
      {
        id: "c-mp-low",
        nome: "Mercado pago",
        banco: "Mercado pago",
        limite_total: 0,
        dia_fechamento: 1,
        dia_vencimento: 10,
        cor: "#000",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00",
    external_id: "mp1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "mp2",
  });
  const r3 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado Pago",
    external_id: "mp3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(r3.resposta).toMatch(/Pagamento:\s*Cartão Mercado Pago/);
  expect(r3.resposta).not.toMatch(/Mercado pago/);
});

// ---------- Bug 6: padaria → Alimentação quando categoria existe ----------

test('"Padaria" usa categoria Alimentação quando ela existe', async () => {
  resetState({
    categorias: [
      { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
      { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
      { id: "cat-ali", legacy_id: "alimentacao", nome: "Alimentação", user_id: "u1" },
    ],
  });

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00 pix",
    external_id: "pa1",
  });
  const conf = state.pendingRow;
  expect(conf?.status).toBe("aguardando_confirmacao");

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "pa2",
  });
  const g = gastosInserts()[0]?.row as Record<string, unknown>;
  expect(g.categoria_id).toBe("cat-ali");
});

test('"Padaria" cai em Mercado quando Alimentação não existe', async () => {
  // default fake state não tem alimentacao
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00 pix",
    external_id: "pf1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "pf2",
  });
  const g = gastosInserts()[0]?.row as Record<string, unknown>;
  expect(g.categoria_id).toBe("cat-mer");
});

// ---------- Bug 7: resolução de categoria por nome (acento / variações) ----------

const { diagnoseCategoriaResolution } = await import("../src/server/whatsapp.server");

test('Padaria → Alimentação quando a categoria se chama exatamente "Alimentação"', () => {
  const cats = [
    { id: "a", legacy_id: null, nome: "Alimentação" },
    { id: "m", legacy_id: null, nome: "Mercado" },
  ];
  const r = diagnoseCategoriaResolution("Padaria", cats);
  expect(r.categoria_alimentacao_disponivel).toBe("sim");
  expect(r.categoria_resolvida).toBe("alimentacao");
});

test('Padaria → Alimentação quando a categoria se chama "Alimentacao" (sem acento)', () => {
  const cats = [
    { id: "a", legacy_id: null, nome: "Alimentacao" },
    { id: "m", legacy_id: null, nome: "Mercado" },
  ];
  const r = diagnoseCategoriaResolution("Padaria", cats);
  expect(r.categoria_resolvida).toBe("alimentacao");
});

test('Padaria → Alimentação quando a categoria se chama "Refeições"', () => {
  const cats = [
    { id: "r", legacy_id: null, nome: "Refeições" },
    { id: "m", legacy_id: null, nome: "Mercado" },
  ];
  const r = diagnoseCategoriaResolution("Padaria", cats);
  expect(r.categoria_alimentacao_disponivel).toBe("sim");
  expect(r.categoria_resolvida).toBe("alimentacao");
});

test("Sem categoria compatível com Alimentação → fallback Mercado", () => {
  const cats = [
    { id: "m", legacy_id: null, nome: "Mercado" },
    { id: "t", legacy_id: null, nome: "Transporte" },
  ];
  const r = diagnoseCategoriaResolution("Padaria", cats);
  expect(r.categoria_alimentacao_disponivel).toBe("nao");
  expect(r.categoria_resolvida).toBe("fallback_mercado");
});

test('Padaria salva com a categoria oficial "Refeições" quando existe', async () => {
  resetState({
    categorias: [
      { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
      { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
      { id: "cat-ref", legacy_id: null, nome: "Refeições", user_id: "u1" },
    ],
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00 pix",
    external_id: "ref1",
  });
  // confirmação deve mostrar o nome oficial "Refeições"
  const resp = state.pendingRow?.parsed as { resposta?: string } | null;
  // pendingRow.parsed é a sessão; a resposta foi gravada à parte, conferimos via segunda mensagem
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "ref2",
  });
  const g = gastosInserts()[0]?.row as Record<string, unknown>;
  expect(g.categoria_id).toBe("cat-ref");
  void resp;
});

// ---------- Bug 8: negação de cartão não trata texto como nome literal ----------

test('"nenhum desses" não exibe nome literal e segue para confirmação', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 1,00",
    external_id: "neg1",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "neg2",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "nenhum desses",
    external_id: "neg3",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).not.toMatch(/nenhum desses/i);
  expect(r.resposta).toMatch(/Não encontrei nenhum dos seus cartões cadastrados/i);
  expect(r.resposta).toMatch(/cartão não cadastrado/i);
  expect(r.resposta).toMatch(/Responda sim ou não/);

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "neg4",
  });
  const g = gastosInserts()[0]?.row as Record<string, unknown>;
  expect(g.cartao_id).toBeNull();
  expect(g.observacao).not.toMatch(/nenhum desses/i);
});

test('"não tenho" segue como cartão não cadastrado sem nome literal', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 12,00",
    external_id: "neg5",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "neg6",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "não tenho",
    external_id: "neg7",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).toMatch(/Não encontrei nenhum dos seus cartões cadastrados/i);
  expect(r.resposta).not.toMatch(/"não tenho"/i);
});

test('"outro cartão" segue como cartão não cadastrado sem nome literal', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 12,00",
    external_id: "neg8",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "neg9",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "outro cartão",
    external_id: "neg10",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).toMatch(/Não encontrei nenhum dos seus cartões cadastrados/i);
  expect(r.resposta).not.toMatch(/"outro cartão"/i);
});

test('nome de cartão inexistente ainda mostra o nome literal', async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 12,00",
    external_id: "neg11",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "neg12",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Itaú Platinum",
    external_id: "neg13",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(r.resposta).toMatch(/Não encontrei "Itaú Platinum"/i);
});

afterAll(() => {});

