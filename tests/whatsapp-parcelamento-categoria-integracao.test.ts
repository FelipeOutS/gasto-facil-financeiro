/**
 * WA-F3.3 — categoria manual em compra parcelada, memória de
 * estabelecimento, integração com WA-F1 (fatura) e WA-F2 (itens),
 * idempotência concorrente, e blindagem da RPC.
 *
 * Nenhum teste usa Supabase, Meta, Graph, OCR ou transcrição reais.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import { resetState, state, gastosInserts, fakeAdmin } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { getItensFaturaAtualPorCartao, getFaturaAtualPorCartao, nowInAppTz } =
  await import("../src/server/cartao-fatura.server");

function msg(texto: string, externalId = "e-1") {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  };
}

function nubank() {
  return {
    id: "c-nu", nome: "Nubank", banco: "Nubank",
    limite_total: 0, dia_fechamento: 28, dia_vencimento: 10, cor: "#000",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

function memoryInserts() {
  return state.inserts.filter((i) => i.table === "whatsapp_merchant_category_memories");
}

describe("WA-F3.3 — categoria manual em compra parcelada", () => {
  beforeEach(() => resetState({ cartoes: [nubank()] }));

  it('"categoria" abre o picker e não cria parcelas', async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("categoria", "e-2"));
    expect(out.status).toBe("parc_aguardando_categoria");
    expect(out.resposta.toLowerCase()).toContain("categoria");
    expect(gastosInserts().length).toBe(0);
  });

  it("escolha por NÚMERO no picker marca manual e atualiza prévia", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria", "e-2"));
    const out = await processarMensagemWhatsApp(msg("2", "e-3"));
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta).toContain("Categoria:");
    expect(gastosInserts().length).toBe(0);
  });

  it('"categoria Mercado" (direct) marca manual sem passar pelo picker', async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta).toContain("Mercado");
    expect(gastosInserts().length).toBe(0);
  });

  it('"coloca em Saúde" marca manual', async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("coloca em Saúde", "e-2"));
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta).toContain("Saúde");
  });

  it("cancelar dentro do picker não cria parcelas", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria", "e-2"));
    const out = await processarMensagemWhatsApp(msg("cancelar", "e-3"));
    expect(out.status).toBe("cancelada");
    expect(gastosInserts().length).toBe(0);
  });

  it('"sim" dentro do picker NÃO confirma e não cria parcelas', async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria", "e-2"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
    expect(out.status).toBe("parc_aguardando_categoria");
    expect(gastosInserts().length).toBe(0);
  });

  it("categoria AUTOMÁTICA confirmada grava memória uma única vez como confirmed", async () => {
    await processarMensagemWhatsApp(msg("Padaria 30 em 2x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(out.status).toBe("salva");
    const mems = memoryInserts();
    expect(mems.length).toBe(1);
    expect((mems[0].row as Record<string, unknown>).manual_confirmed_count ?? 0).toBe(0);
  });

  it("categoria MANUAL confirmada grava memória uma única vez como manual", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
    expect(out.status).toBe("salva");
    const mems = memoryInserts();
    expect(mems.length).toBe(1);
    const r = mems[0].row as Record<string, unknown>;
    expect(r.manual_confirmed_count).toBe(1);
    expect(r.category_id).toBe("cat-mer");
  });
});

describe("WA-F3.3 — integração com WA-F1 (fatura) e WA-F2 (itens)", () => {
  beforeEach(() => resetState({ cartoes: [nubank()] }));

  it("R$ 300 em 3x no Nubank: WA-F2 mostra apenas a parcela do ciclo atual com marcador 1/3", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const ok = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(ok.status).toBe("salva");

    const cartao = state.cartoesData[0] as Record<string, unknown>;
    const itens = await getItensFaturaAtualPorCartao("u1", {
      id: cartao.id as string,
      nome: cartao.nome as string,
      banco: cartao.banco as string,
      dia_fechamento: cartao.dia_fechamento as number,
      dia_vencimento: cartao.dia_vencimento as number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Apenas UMA parcela cai no ciclo atual.
    expect(itens.length).toBe(1);
    expect(itens[0].parcelaAtual).toBe(1);
    expect(itens[0].totalParcelas).toBe(3);
    // Marcador "1/3" no formato esperado de exibição.
    const marker = `${itens[0].parcelaAtual}/${itens[0].totalParcelas}`;
    expect(marker).toBe("1/3");
    // Valor da parcela ≈ R$ 100,00.
    expect(Math.round(itens[0].valor * 100)).toBe(10000);

    // Soma total persistida (todas as 3 parcelas) = R$ 300,00.
    const todas = gastosInserts().filter((g) => g.row.cartao_id === "c-nu");
    expect(todas.length).toBe(3);
    const somaCent = todas.reduce((a, g) => a + Math.round(Number(g.row.valor) * 100), 0);
    expect(somaCent).toBe(30000);

    // Nenhuma linha "única" de R$ 300 existe.
    expect(todas.find((g) => Number(g.row.valor) === 300)).toBeUndefined();
  });

  it("WA-F1 vê apenas a parcela do ciclo atual no total da fatura", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("sim", "e-2"));

    const cartao = state.cartoesData[0] as Record<string, unknown>;
    const fat = await getFaturaAtualPorCartao("u1", {
      id: cartao.id as string,
      nome: cartao.nome as string,
      banco: cartao.banco as string,
      dia_fechamento: cartao.dia_fechamento as number,
      dia_vencimento: cartao.dia_vencimento as number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // Apenas R$ 100 dessa compra entram na fatura atual.
    expect(Math.round(fat.total * 100)).toBe(10000);
  });

  it("R$ 100 em 3x → centavos 33,34 / 33,33 / 33,33 (soma exata)", async () => {
    await processarMensagemWhatsApp(msg("Cinema 100 em 3x no Nubank", "e-1"));
    const ok = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(ok.status).toBe("salva");
    const gs = gastosInserts().sort(
      (a, b) => (a.row.parcela_atual as number) - (b.row.parcela_atual as number),
    );
    expect(gs.length).toBe(3);
    const cents = gs.map((g) => Math.round(Number(g.row.valor) * 100));
    expect(cents).toEqual([3334, 3333, 3333]);
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe("WA-F3.3 — blindagem da RPC (validações server-side)", () => {
  let original: typeof fakeAdmin.rpc;
  beforeEach(() => {
    resetState({ cartoes: [nubank()] });
    original = fakeAdmin.rpc;
  });

  function withRpcValidator(extraCheck: (args: Record<string, unknown>) => string | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeAdmin as any).rpc = async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_installment_purchase") {
        const a = args ?? {};
        const parcelas = (a.p_parcelas ?? []) as Array<Record<string, unknown>>;
        const total = a.p_total_parcelas as number;
        // Espelha as validações server-side principais.
        if (!Array.isArray(parcelas) || parcelas.length !== total) {
          return { data: null, error: { message: "quantidade de parcelas difere de total_parcelas" } };
        }
        for (const p of parcelas) {
          const v = Number(p.valor);
          if (!Number.isFinite(v) || v <= 0) {
            return { data: null, error: { message: "parcela com valor inválido" } };
          }
          const im = String(p.invoice_month ?? "");
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(im)) {
            return { data: null, error: { message: "invoice_month inválido" } };
          }
        }
        const seq = parcelas.map((p) => Number(p.numero)).sort((x, y) => x - y);
        for (let i = 0; i < total; i++) {
          if (seq[i] !== i + 1) {
            return { data: null, error: { message: "sequência de parcelas inválida" } };
          }
        }
        const cartaoOwner = (state.cartoesData.find((c) => c.id === a.p_cartao_id) as
          | { user_id?: string } | undefined)?.user_id;
        if (cartaoOwner !== undefined && cartaoOwner !== a.p_user_id) {
          return { data: null, error: { message: "cartão não pertence ao usuário" } };
        }
        if (a.p_categoria_id) {
          const cat = state.categoriasData.find((c) => c.id === a.p_categoria_id) as
            { user_id?: string } | undefined;
          if (cat && cat.user_id !== a.p_user_id) {
            return { data: null, error: { message: "categoria não pertence ao usuário" } };
          }
        }
        const extra = extraCheck(a);
        if (extra) return { data: null, error: { message: extra } };
        return original.call(fakeAdmin, name, args);
      }
      return original.call(fakeAdmin, name, args);
    };
  }

  it("rejeita quando p_total_parcelas difere do tamanho do array", async () => {
    withRpcValidator((a) => {
      // Força mismatch substituindo p_total_parcelas.
      (a as Record<string, unknown>).p_total_parcelas =
        ((a.p_parcelas as unknown[]).length + 1);
      return null;
    });
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally { fakeAdmin.rpc = original; }
  });

  it("rejeita parcela com valor zero (não cria parcial)", async () => {
    withRpcValidator((a) => {
      const parc = (a.p_parcelas as Array<Record<string, unknown>>);
      parc[1].valor = 0;
      return null;
    });
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally { fakeAdmin.rpc = original; }
  });

  it("rejeita sequência de parcelas inválida (com furo)", async () => {
    withRpcValidator((a) => {
      const parc = (a.p_parcelas as Array<Record<string, unknown>>);
      parc[2].numero = 99;
      return null;
    });
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally { fakeAdmin.rpc = original; }
  });

  it("rejeita cartão pertencente a OUTRO usuário", async () => {
    // Re-injeta o cartão como sendo de outro user.
    resetState({
      cartoes: [{ ...nubank(), user_id: "outro-user" }],
    });
    withRpcValidator(() => null);
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally { fakeAdmin.rpc = original; }
  });

  it("rejeita categoria pertencente a OUTRO usuário", async () => {
    // Marca cat-mer como sendo de outro user.
    resetState({
      cartoes: [nubank()],
      categorias: [
        { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
        { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "outro" },
      ],
    });
    withRpcValidator(() => null);
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().filter((g) => g.row.grupo_parcelamento_id).length).toBe(0);
    } finally { fakeAdmin.rpc = original; }
  });
});

describe("WA-F3.3 — idempotência concorrente (mesmo external_message_id)", () => {
  beforeEach(() => resetState({ cartoes: [nubank()] }));

  it("dois 'sim' simultâneos com o mesmo external_id criam apenas UM grupo", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const [a, b] = await Promise.all([
      processarMensagemWhatsApp(msg("sim", "e-confirm")),
      processarMensagemWhatsApp(msg("sim", "e-confirm")),
    ]);
    const okCount = [a, b].filter((r) => r.status === "salva").length;
    const dupCount = [a, b].filter((r) => r.status === "duplicada").length;
    expect(okCount + dupCount).toBe(2);
    // Apenas uma das chamadas pode ter persistido um grupo.
    const grupos = new Set(
      gastosInserts().map((g) => g.row.grupo_parcelamento_id as string).filter(Boolean),
    );
    expect(grupos.size).toBe(1);
    expect(gastosInserts().length).toBe(3);
  });
});
