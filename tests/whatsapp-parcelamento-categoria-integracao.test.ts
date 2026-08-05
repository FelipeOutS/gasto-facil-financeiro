/**
 * WA-F3.3 — categoria manual em compra parcelada, memória de
 * estabelecimento, integração com WA-F1 (fatura) e WA-F2 (itens),
 * idempotência concorrente, e blindagem da RPC.
 *
 * Nenhum teste usa Supabase, Meta, Graph, OCR ou transcrição reais.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import {
  resetState,
  state,
  gastosInserts,
  fakeAdmin,
  setupWhatsAppFakeMocks,
} from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { getItensFaturaAtualPorCartao, getFaturaAtualPorCartao } =
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

// dia_fechamento=1 → cycle alinhado ao mês civil. Evita borda do bug
// histórico em que `dataForInvoiceMonth` projeta o dia do mês alvo
// fora do ciclo (irrelevante para WA-F3.3; é estabilidade de teste).
function nubank(diaFechamento = 1) {
  return {
    id: "c-nu",
    nome: "Nubank",
    banco: "Nubank",
    limite_total: 0,
    dia_fechamento: diaFechamento,
    dia_vencimento: 10,
    cor: "#000",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    // "Decathlon" passa por merchantKeyFor (não está na blocklist genérica).
    await processarMensagemWhatsApp(msg("Decathlon 80 em 2x no Nubank", "e-1"));
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
  beforeEach(() => resetState({ cartoes: [nubank(1)] }));

  it("R$ 300 em 3x no Nubank: WA-F2 mostra apenas a parcela do ciclo atual com marcador 1/3", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const ok = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(ok.status).toBe("salva");

    const cartao = state.cartoesData[0] as Record<string, unknown>;
    const itens = await getItensFaturaAtualPorCartao(
      "u1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cartao as any,
    );

    expect(itens.length).toBe(1);
    expect(itens[0].parcelaAtual).toBe(1);
    expect(itens[0].totalParcelas).toBe(3);
    expect(`${itens[0].parcelaAtual}/${itens[0].totalParcelas}`).toBe("1/3");
    expect(Math.round(itens[0].valor * 100)).toBe(10000);

    const todas = gastosInserts().filter((g) => g.row.cartao_id === "c-nu");
    expect(todas.length).toBe(3);
    const somaCent = todas.reduce((a, g) => a + Math.round(Number(g.row.valor) * 100), 0);
    expect(somaCent).toBe(30000);
    // Nunca aparece como compra única.
    expect(todas.find((g) => Number(g.row.valor) === 300)).toBeUndefined();
  });

  it("WA-F1 vê apenas a parcela do ciclo atual no total da fatura", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("sim", "e-2"));

    const cartao = state.cartoesData[0] as Record<string, unknown>;
    const fat = await getFaturaAtualPorCartao(
      "u1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cartao as any,
    );
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

  function stubRpcError(message: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeAdmin as any).rpc = async (name: string) => {
      if (name === "create_installment_purchase") {
        return { data: null, error: { message } };
      }
      return { data: true, error: null };
    };
  }

  it("rejeita quando p_total_parcelas difere do tamanho do array", async () => {
    stubRpcError("quantidade de parcelas (3) difere de total_parcelas (4)");
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("rejeita parcela com valor zero (não cria parcial)", async () => {
    stubRpcError("parcela com valor inválido");
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("rejeita sequência de parcelas inválida (com furo)", async () => {
    stubRpcError("sequência de parcelas inválida (faltando 2)");
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("rejeita cartão pertencente a OUTRO usuário", async () => {
    stubRpcError("cartão não pertence ao usuário");
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("rejeita categoria pertencente a OUTRO usuário", async () => {
    stubRpcError("categoria não pertence ao usuário");
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      await processarMensagemWhatsApp(msg("categoria Mercado", "e-2"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().filter((g) => g.row.grupo_parcelamento_id).length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
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
    // Uma das duas deve ter persistido; a outra falha com erro ou
    // resposta de duplicada (ambas indicam bloqueio do claim atômico).
    const sucesso = [a, b].filter((r) => r.status === "salva");
    const bloqueada = [a, b].filter((r) => r.status === "erro" || r.status === "duplicada");
    expect(sucesso.length).toBe(1);
    expect(bloqueada.length).toBe(1);
    // Apenas UM grupo_parcelamento_id existe.
    const grupos = new Set(
      gastosInserts()
        .map((g) => g.row.grupo_parcelamento_id as string)
        .filter(Boolean),
    );
    expect(grupos.size).toBe(1);
    expect(gastosInserts().length).toBe(3);
  });
});
