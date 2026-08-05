/**
 * WA-C3.1 — Reconhecer baixa de conta com data após o nome.
 *
 * Cobre:
 *   - termo extraído com data no meio/final;
 *   - data passada vai direto à confirmação normal;
 *   - data futura pede confirmação extra (askFutureConfirm);
 *   - frase com valor monetário continua sendo gasto comum;
 *   - logs continuam sem PII.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { detectMarkAsPaidIntent } = await import("../src/server/whatsapp-contas-pagar.server");

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { todayISOInAppTz } = await import("../src/server/contas-vencimento.server");

function msg(texto: string, externalId = `ext-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

function makeConta(opts: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: opts.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    user_id: opts.user_id ?? "u1",
    nome: opts.nome ?? "Internet",
    valor: opts.valor ?? 119.9,
    data_vencimento: opts.data_vencimento ?? "2026-07-05",
    status: opts.status ?? "pendente",
    data_pagamento: opts.data_pagamento ?? null,
    categoria_id: null,
    recorrente: false,
    frequencia_recorrencia: null,
    recorrencia_id: null,
    ...opts,
  };
}

function pastISO(daysAgo = 1): string {
  const d = new Date(`${todayISOInAppTz()}T12:00:00`);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function futureISO(daysFromNow = 1): string {
  const d = new Date(`${todayISOInAppTz()}T12:00:00`);
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("WA-C3.1 — detector com data embutida", () => {
  it("extrai termo e ontem", () => {
    const r = detectMarkAsPaidIntent("paguei a internet ontem");
    expect(r?.termo).toBe("internet");
    expect(r?.paymentDate).toBe("ontem");
  });

  it("extrai termo e dia N (marcar)", () => {
    const r = detectMarkAsPaidIntent("marcar aluguel como pago dia 5");
    expect(r?.termo).toBe("aluguel");
    expect(r?.paymentDate).toContain("dia 5");
  });

  it("extrai termo e DD/MM (dei baixa)", () => {
    const r = detectMarkAsPaidIntent("dei baixa na academia em 03/07");
    expect(r?.termo).toBe("academia");
    expect(r?.paymentDate).toContain("03/07");
  });

  it("extrai termo (preserva nome composto) e advérbio em 'foi paga'", () => {
    const r = detectMarkAsPaidIntent("a conta de luz foi paga ontem");
    expect(r?.termo).toBe("conta de luz");
    expect(r?.paymentDate).toBe("ontem");
  });

  it("extrai termo e 'no dia 10' (quitar)", () => {
    const r = detectMarkAsPaidIntent("quitar plano de saude no dia 10");
    expect(r?.termo).toContain("plano");
    expect(r?.paymentDate).toContain("dia 10");
  });

  it("'amanhã' é reconhecido como data", () => {
    const r = detectMarkAsPaidIntent("paguei a internet amanhã");
    expect(r?.termo).toBe("internet");
    expect(r?.paymentDate).toBe("amanha");
  });

  it("'dia N do mês que vem' é reconhecido", () => {
    const r = detectMarkAsPaidIntent("marcar aluguel como pago dia 20 do mês que vem");
    expect(r?.termo).toBe("aluguel");
    expect(r?.paymentDate).toContain("mes que vem");
  });

  it("sem data → paymentDate é null e funciona normal", () => {
    const r = detectMarkAsPaidIntent("paguei a internet");
    expect(r?.termo).toBe("internet");
    expect(r?.paymentDate).toBeNull();
  });

  it("NÃO confunde gasto com valor mesmo havendo data", () => {
    expect(detectMarkAsPaidIntent("paguei 42 reais no almoço ontem")).toBe(null);
    expect(detectMarkAsPaidIntent("paguei 89,90 na farmácia no Pix")).toBe(null);
    expect(detectMarkAsPaidIntent("gastei 50 no mercado hoje")).toBe(null);
  });
});

describe("WA-C3.1 — fluxo end-to-end com data embutida", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet" })],
    }),
  );

  it("'paguei a internet ontem' usa ontem como data_pagamento", async () => {
    const out1 = await processarMensagemWhatsApp(msg("paguei a internet ontem"));
    expect(out1.status).toBe("pendente");
    expect(out1.resposta).toContain("Encontrei esta conta pendente");
    // A data exibida na prévia já deve ser ontem (DD/MM/YYYY).
    const ontem = pastISO(1);
    const [y, m, d] = ontem.split("-");
    expect(out1.resposta).toContain(`${d}/${m}/${y}`);
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
    expect(state.contasData[0].status).toBe("pago");
    expect(state.contasData[0].data_pagamento).toBe(ontem);
  });

  it("'marcar aluguel como pago dia 5' usa dia 5 do mês corrente", async () => {
    resetState({ contas: [makeConta({ id: "c-alug", nome: "Aluguel" })] });
    await processarMensagemWhatsApp(msg("marcar aluguel como pago dia 5"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const today = todayISOInAppTz();
    const [y, m] = today.split("-");
    const expected = `${y}-${m}-05`;
    // Se "dia 5" for futuro neste ciclo o teste vira o fluxo futuro;
    // nos demais, baixa direta.
    if (expected > today) {
      // pulamos — caímos no fluxo futuro (coberto em outro teste).
      return;
    }
    expect(state.contasData[0].data_pagamento).toBe(expected);
  });

  it("'dei baixa na academia em 03/07' usa 03/07 do ano corrente", async () => {
    resetState({ contas: [makeConta({ id: "c-ac", nome: "Academia" })] });
    await processarMensagemWhatsApp(msg("dei baixa na academia em 03/07"));
    const out = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const y = todayISOInAppTz().slice(0, 4);
    const expected = `${y}-07-03`;
    if (expected > todayISOInAppTz()) {
      // Data futura — exige confirmação extra; nesse caso o "sim" ainda
      // estará no passo de confirmação de data futura e finaliza igual.
      expect(out.status).toBe("salva");
    } else {
      expect(out.status).toBe("salva");
    }
    expect(state.contasData[0].data_pagamento).toBe(expected);
  });

  it("'a conta de luz foi paga ontem' identifica 'Conta de Luz'", async () => {
    resetState({ contas: [makeConta({ id: "c-luz", nome: "Conta de Luz" })] });
    const out = await processarMensagemWhatsApp(msg("a conta de luz foi paga ontem"));
    expect(out.status).toBe("pendente");
    expect(out.resposta).toContain("Conta de Luz");
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(state.contasData[0].status).toBe("pago");
    expect(state.contasData[0].data_pagamento).toBe(pastISO(1));
  });
});

describe("WA-C3.1 — data futura embutida exige confirmação extra", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet" })],
    }),
  );

  it("'paguei a internet amanhã' pede confirmação", async () => {
    const out = await processarMensagemWhatsApp(msg("paguei a internet amanhã"));
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/ainda não chegou/i);
    // Não pode persistir sem segunda confirmação.
    expect(state.contasData[0].status).toBe("pendente");
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
    expect(state.contasData[0].data_pagamento).toBe(futureISO(1));
  });

  it("cancelar na confirmação extra deixa conta intacta", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet amanhã"));
    const out = await processarMensagemWhatsApp(msg("cancelar", "ext-c"));
    expect(out.status).toBe("cancelada");
    expect(state.contasData[0].status).toBe("pendente");
  });
});

describe("WA-C3.1 — segurança preservada", () => {
  it("conta inexistente: resposta segura mesmo com data na frase", async () => {
    resetState({ contas: [] });
    const out = await processarMensagemWhatsApp(msg("paguei a internet ontem"));
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("Não encontrei");
  });

  it("conta de outro usuário não aparece, mesmo com data", async () => {
    resetState({
      contas: [makeConta({ id: "c-z", user_id: "outro", nome: "Internet" })],
    });
    const out = await processarMensagemWhatsApp(msg("paguei a internet ontem"));
    expect(out.status).toBe("consulta");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("frase com valor monetário e data continua sendo gasto comum", async () => {
    resetState({ contas: [makeConta({ id: "c-int", nome: "Internet" })] });
    const out = await processarMensagemWhatsApp(msg("paguei 42 reais no almoço ontem"));
    expect(out.resposta).not.toContain("Encontrei esta conta pendente");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("logs com data embutida não vazam PII", async () => {
    resetState({ contas: [makeConta({ id: "c-int", nome: "Internet" })] });
    const events: Record<string, unknown>[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      for (const a of args) {
        if (
          a &&
          typeof a === "object" &&
          (a as Record<string, unknown>).event === "wa_payable_account_payment"
        ) {
          events.push(a as Record<string, unknown>);
        }
      }
    };
    await processarMensagemWhatsApp(msg("paguei a internet ontem"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    console.info = orig;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e);
      expect(json).not.toContain("Internet");
      expect(json).not.toContain("ontem");
      expect(json).not.toContain("c-int");
      expect(json).not.toContain("u1");
      expect(json).not.toContain("5511999998888");
    }
  });
});
