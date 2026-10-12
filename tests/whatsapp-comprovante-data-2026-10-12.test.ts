import { describe, it, expect, mock, beforeEach } from "bun:test";

type GastoInsert = {
  id?: string;
  user_id: string;
  categoria_id: string | null;
  descricao: string;
};
const insertedGastos: GastoInsert[] = [];
const memoryCalls: Array<{
  userId: string;
  merchantKey: string;
  categoryId: string;
  evidence: "manual" | "confirmed";
}> = [];

const CATS = [
  { id: "cat-outros", legacy_id: "outros", nome: "Outros" },
  { id: "cat-transp", legacy_id: "transporte", nome: "Transporte" },
  { id: "cat-ali", legacy_id: "alimentacao", nome: "Alimentação" },
];

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === "categorias") {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => Promise.resolve({ data: CATS, error: null });
        return q;
      }
      if (table === "gastos") {
        return {
          insert(payload: GastoInsert) {
            if (payload.id && insertedGastos.some((g) => g.id === payload.id)) {
              return { select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) };
            }
            insertedGastos.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: { id: "gasto-" + insertedGastos.length },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      // catch-all: tabela history, etc.
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.gte = () => q;
      q.order = () => q;
      q.limit = () => Promise.resolve({ data: [], error: null });
      (q as { then?: unknown }).then = (
        resolve: (v: { data: unknown[]; error: null }) => unknown,
      ) => Promise.resolve(resolve({ data: [], error: null }));
      q.insert = () => Promise.resolve({ error: null });
      q.update = () => ({ eq: () => Promise.resolve({ error: null }) });
      return q;
    },
  },
}));

mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  merchantKeyFor: (s: string | null | undefined) => {
    if (!s) return null;
    const k = s.toLowerCase().trim();
    if (k.length < 4) return null;
    return k;
  },
  lookupMerchantMemory: async () => ({ kind: "none" }),
  recordMerchantMemory: async (args: {
    userId: string;
    merchantKey: string;
    categoryId: string;
    evidence: "manual" | "confirmed";
  }) => {
    memoryCalls.push(args);
    return { ok: true };
  },
  logMerchantMemoryDecision: () => {},
  MERCHANT_MEMORY_HINT_LINE: "Sugestão baseada em lançamentos confirmados anteriormente.",
}));

mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({
  assertFinancialActionQuotaForWhatsApp: async () => ({
    allowed: true,
    reason: "allowed",
    duplicate: false,
    adminMaster: false,
    planCode: "free_ads",
    idempotencyKey: "wa:financial:test:expense_receipt:v1",
    cycleSource: "calendar_month",
    quota: { limit: 100, used: 1, remaining: 99 },
  }),
  financialQuotaBlockedReply: () => "blocked",
}));

const { processarRespostaImagem, interpretarRespostaData } = await import(
  "@/server/whatsapp-comprovantes.server"
);
const { escolherDataComprovante } = await import("@/server/ocr-comprovante.server");

// Cenário fictício (sem dados reais): NFC-e Sam's Club, 33 itens, R$ 1.107,71.
function sessaoNota(extra: Record<string, unknown> = {}) {
  return {
    kind: "imagem_comprovante" as const,
    descricao: "Sams Club",
    valor: 1107.71,
    data: "2006-10-11",
    categoriaId: "cat-ali",
    categoriaLabel: "Alimentação",
    categoriaNaoIdentificada: false,
    formaPagamento: "debito",
    dataConfirmada: false,
    mensagemOriginal: "(foto)",
    ...extra,
  };
}
const responder = (texto: string, session = sessaoNota(), userId = "user-a", ext = "wamid.1") =>
  processarRespostaImagem({
    userId,
    texto,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: session as any,
    status: "img_aguardando_data_confirmacao",
    decisao: texto.toLowerCase().startsWith("sim") ? "confirm" : "outro",
    externalMessageId: ext,
  });

beforeEach(() => {
  insertedGastos.length = 0;
});

describe("data do comprovante — ano", () => {
  it("NFC-e: data de emissão 2026 prevalece sobre leitura genérica 2006", () => {
    const r = escolherDataComprovante({
      data: "2006-10-11",
      dataEmissao: "2026-10-11",
      dataAutorizacao: "2026-10-11",
      tipoDocumento: "nfce",
    });
    expect(r.data).toBe("2026-10-11");
    expect(r.incerta).toBe(true); // divergência é sinalizada, não escondida
  });
  it("NFC-e com emissão e autorização 2026 concordando não fica incerta", () => {
    const r = escolherDataComprovante({
      data: "2026-10-11",
      dataEmissao: "2026-10-11",
      dataAutorizacao: "2026-10-11",
      tipoDocumento: "nfce",
    });
    expect(r).toEqual({ data: "2026-10-11", incerta: false });
  });
  it("NFC-e lida como 2006 (ano impossível para NFC-e) fica incerta — sem trocar para 2026", () => {
    const r = escolherDataComprovante({ data: "2006-10-11", tipoDocumento: "nfce" });
    expect(r).toEqual({ data: "2006-10-11", incerta: true });
  });
  it("recibo antigo verdadeiro de 2006 continua válido", () => {
    const r = escolherDataComprovante({ data: "2006-10-11", tipoDocumento: "outro" });
    expect(r).toEqual({ data: "2006-10-11", incerta: false });
  });
});

describe("resposta à pergunta de data", () => {
  for (const t of ["Essa", "Usar essa", "essa data", "a da nota", "Sim", "USAR ESSA!"]) {
    it(`"${t}" usa a data da nota e não repete a pergunta`, async () => {
      const r = await responder(t);
      expect(r.status).toBe("salva");
      expect(insertedGastos).toHaveLength(1);
      expect(insertedGastos[0].data).toBe("2006-10-11");
      expect(r.resposta).toContain("Data usada: 11/10/2006");
      expect(r.resposta).not.toContain("Quer usar essa data");
    });
  }
  it('"Hoje" usa a data de hoje', async () => {
    const r = await responder("Hoje");
    expect(r.status).toBe("salva");
    expect(insertedGastos[0].data).not.toBe("2006-10-11");
  });
  it("data específica é aceita", async () => {
    const r = await responder("11/10/2026");
    expect(r.status).toBe("salva");
    expect(insertedGastos[0].data).toBe("2026-10-11");
  });
  it('"Não" pede a data, sem salvar e sem repetir a mesma pergunta', async () => {
    const r = await responder("Não");
    expect(r.status).toBe("aguardando_data_confirmacao");
    expect(insertedGastos).toHaveLength(0);
    expect(r.resposta).not.toContain("Quer usar essa data");
  });
  it("resposta incompreensível explica as opções em vez de repetir a pergunta", async () => {
    const r = await responder("banana");
    expect(r.resposta).toContain("Não entendi qual data usar");
    expect(insertedGastos).toHaveLength(0);
  });
  it('"Sim" é ambíguo quando a data é incerta: pede esclarecimento sem salvar', async () => {
    expect(interpretarRespostaData("sim", true).kind).toBe("indefinida");
    const r = await responder("Sim", sessaoNota({ dataIncerta: true }));
    expect(r.status).toBe("aguardando_data_confirmacao");
    expect(insertedGastos).toHaveLength(0);
  });
});

describe("idempotência e isolamento", () => {
  it("retries da mesma mensagem não duplicam o gasto", async () => {
    await responder("Essa", sessaoNota(), "user-a", "wamid.retry");
    await responder("Essa", sessaoNota(), "user-a", "wamid.retry");
    await responder("Essa", sessaoNota(), "user-a", "wamid.retry");
    expect(insertedGastos).toHaveLength(1);
  });
  it("usuários diferentes não compartilham o lançamento", async () => {
    await responder("Essa", sessaoNota(), "user-a", "wamid.same");
    await responder("Essa", sessaoNota(), "user-b", "wamid.same");
    expect(insertedGastos.map((g) => g.user_id).sort()).toEqual(["user-a", "user-b"]);
    expect(insertedGastos[0].id).not.toBe(insertedGastos[1].id);
  });
});
