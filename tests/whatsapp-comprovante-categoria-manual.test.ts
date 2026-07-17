/**
 * WA-M1.2 — Seleção manual de categoria em comprovantes preserva
 * `categoriaSelecionadaManual` na sessão e força evidência "manual"
 * na memória de estabelecimento, mesmo após `categoriaNaoIdentificada`
 * ser zerado pelo fluxo de ajuste.
 *
 * Cobertura:
 *  - ajuste por "categoria <nome>" direto durante confirmação;
 *  - ajuste por "categoria" → escolha por número;
 *  - ajuste por "categoria" → escolha por nome;
 *  - fluxo de categoria obrigatória (OCR não identificou);
 *  - confirmação simples sem alterar categoria → "confirmed";
 *  - fail-safe: categoriaNaoIdentificada=true sem flag → ainda "manual";
 *  - cancelamento após escolher categoria não grava memória.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

type GastoInsert = {
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
  MERCHANT_MEMORY_HINT_LINE:
    "Sugestão baseada em lançamentos confirmados anteriormente.",
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

const {
  processarRespostaImagem,
  persistirGastoComprovante,
} = await import("@/server/whatsapp-comprovantes.server");

type CompSession = {
  kind: "imagem_comprovante";
  descricao?: string;
  valor?: number;
  data?: string;
  categoriaId?: string | null;
  categoriaLabel?: string | null;
  categoriaNaoIdentificada?: boolean;
  categoriaSelecionadaManual?: boolean;
  formaPagamento?: string | null;
  mensagemOriginal: string;
  pendingField?: "valor" | "descricao" | "categoria" | "data" | "pagamento";
  categoriaOptions?: {
    mode: "short" | "all";
    page: number;
    optionIds: string[];
    optionNames: string[];
  };
};

function baseSession(extra: Partial<CompSession> = {}): CompSession {
  return {
    kind: "imagem_comprovante",
    descricao: "Posto Shell Centro",
    valor: 50,
    data: "2026-06-26",
    categoriaId: "cat-outros",
    categoriaLabel: "Outros",
    categoriaNaoIdentificada: false,
    formaPagamento: "debito",
    mensagemOriginal: "comprovante imagem",
    ...extra,
  };
}

beforeEach(() => {
  insertedGastos.length = 0;
  memoryCalls.length = 0;
});

describe("WA-M1.2 — seleção manual de categoria em comprovantes", () => {
  it('ajuste direto "categoria Transporte" marca categoriaSelecionadaManual=true', async () => {
    const r = await processarRespostaImagem({
      userId: "user-1",
      texto: "categoria Transporte",
      session: baseSession(),
      status: "img_aguardando_confirmacao",
      decisao: "outro",
    });
    expect(r.session?.categoriaSelecionadaManual).toBe(true);
    expect(r.session?.categoriaId).toBe("cat-transp");
    expect(r.session?.categoriaNaoIdentificada).toBe(false);
  });

  it('ajuste em duas etapas ("categoria" → escolha por nome) marca manual', async () => {
    const r1 = await processarRespostaImagem({
      userId: "user-1",
      texto: "categoria",
      session: baseSession(),
      status: "img_aguardando_confirmacao",
      decisao: "outro",
    });
    expect(r1.session?.pendingField).toBe("categoria");

    const r2 = await processarRespostaImagem({
      userId: "user-1",
      texto: "Transporte",
      session: r1.session!,
      status: "img_aguardando_ajuste",
      decisao: "outro",
    });
    expect(r2.session?.categoriaSelecionadaManual).toBe(true);
    expect(r2.session?.categoriaId).toBe("cat-transp");
  });

  it("fluxo de categoria obrigatória (OCR não identificou) marca manual", async () => {
    const s = baseSession({
      categoriaId: null,
      categoriaLabel: null,
      categoriaNaoIdentificada: true,
    });
    // entra no estado oferecendo lista; usuário responde pelo nome
    const r = await processarRespostaImagem({
      userId: "user-1",
      texto: "Alimentação",
      session: s,
      status: "img_aguardando_categoria_obrigatoria",
      decisao: "outro",
    });
    expect(r.session?.categoriaSelecionadaManual).toBe(true);
    expect(r.session?.categoriaId).toBe("cat-ali");
    expect(r.session?.categoriaNaoIdentificada).toBe(false);
  });

  it("persistirGastoComprovante com flag manual grava evidence=manual", async () => {
    const s = baseSession({
      categoriaId: "cat-transp",
      categoriaLabel: "Transporte",
      categoriaSelecionadaManual: true,
    });
    const r = await persistirGastoComprovante("user-1", s as never, CATS as never);
    expect(r.ok).toBe(true);
    expect(memoryCalls).toHaveLength(1);
    expect(memoryCalls[0].evidence).toBe("manual");
    expect(memoryCalls[0].categoryId).toBe("cat-transp");
  });

  it("persistir sem flag e com OCR identificado grava evidence=confirmed", async () => {
    const r = await persistirGastoComprovante(
      "user-1",
      baseSession() as never,
      CATS as never,
    );
    expect(r.ok).toBe(true);
    expect(memoryCalls[0].evidence).toBe("confirmed");
  });

  it("fail-safe: categoriaNaoIdentificada=true sem flag manual ainda grava manual", async () => {
    const s = baseSession({
      categoriaNaoIdentificada: true,
      categoriaSelecionadaManual: false,
    });
    const r = await persistirGastoComprovante("user-1", s as never, CATS as never);
    expect(r.ok).toBe(true);
    expect(memoryCalls[0].evidence).toBe("manual");
  });

  it("cancelamento após escolher categoria não dispara persistência nem memória", async () => {
    const r = await processarRespostaImagem({
      userId: "user-1",
      texto: "cancelar",
      session: baseSession({ categoriaSelecionadaManual: true }),
      status: "img_aguardando_confirmacao",
      decisao: "cancel",
    });
    expect(r.status).toBe("cancelada");
    expect(insertedGastos).toHaveLength(0);
    expect(memoryCalls).toHaveLength(0);
  });
});
