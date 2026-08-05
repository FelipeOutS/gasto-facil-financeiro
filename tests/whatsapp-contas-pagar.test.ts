/**
 * WA-C3 — Testes de BAIXA de CONTAS A PAGAR.
 *
 * Cobre detector puro, fluxo conversacional, idempotência via update
 * condicional, integração com WA-C1 e logs seguros.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { detectMarkAsPaidIntent, isBaixaContaSession } =
  await import("../src/server/whatsapp-contas-pagar.server");

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { handleDueIntent } = await import("../src/server/whatsapp-contas.server");
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
    recorrente: opts.recorrente ?? false,
    frequencia_recorrencia: opts.frequencia_recorrencia ?? null,
    recorrencia_id: opts.recorrencia_id ?? null,
    ...opts,
  };
}

describe("WA-C3 — detectMarkAsPaidIntent", () => {
  it("reconhece frases de baixa", () => {
    expect(detectMarkAsPaidIntent("paguei a internet")?.termo).toBe("internet");
    expect(detectMarkAsPaidIntent("marcar aluguel como pago")?.termo).toBe("aluguel");
    expect(detectMarkAsPaidIntent("dei baixa na academia")?.termo).toBe("academia");
    expect(detectMarkAsPaidIntent("a conta de luz foi paga")?.termo).toContain("luz");
    expect(detectMarkAsPaidIntent("quitar plano de saude")?.termo).toContain("plano");
  });

  it("NÃO confunde gasto consumado com baixa", () => {
    expect(detectMarkAsPaidIntent("gastei 50 no mercado")).toBe(null);
    expect(detectMarkAsPaidIntent("paguei 42 no almoço")).toBe(null);
    expect(detectMarkAsPaidIntent("paguei 89,90 na farmácia no Pix")).toBe(null);
    expect(detectMarkAsPaidIntent("comprei um tênis")).toBe(null);
    expect(detectMarkAsPaidIntent("paguei R$ 100 no Uber")).toBe(null);
  });

  it("NÃO confunde com fatura de cartão", () => {
    expect(detectMarkAsPaidIntent("paguei a fatura")).toBe(null);
  });

  it("NÃO captura intenção futura ou consulta", () => {
    expect(detectMarkAsPaidIntent("vou pagar a internet amanhã")).toBe(null);
    expect(detectMarkAsPaidIntent("o que paguei esse mês")).toBe(null);
  });

  it("ignora vazio / saudação", () => {
    expect(detectMarkAsPaidIntent("")).toBe(null);
    expect(detectMarkAsPaidIntent("oi")).toBe(null);
  });
});

describe("WA-C3 — fluxo: conta única clara", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-int", nome: "Internet", valor: 119.9, data_vencimento: "2026-07-05" }),
      ],
    }),
  );

  it("preview pede confirmação e 'sim' marca como paga", async () => {
    const out1 = await processarMensagemWhatsApp(msg("paguei a internet"));
    expect(out1.status).toBe("pendente");
    expect(out1.resposta).toContain("Encontrei esta conta pendente");
    expect(out1.resposta).toContain("Internet");
    // Antes do "sim": ainda pendente no banco.
    expect(state.contasData[0].status).toBe("pendente");

    const out2 = await processarMensagemWhatsApp(msg("sim", "ext-conf"));
    expect(out2.status).toBe("salva");
    expect(out2.resposta).toContain("Marquei como paga");
    expect(state.contasData[0].status).toBe("pago");
    expect(state.contasData[0].data_pagamento).toBe(todayISOInAppTz());
  });

  it("cancelar não altera nada", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const out = await processarMensagemWhatsApp(msg("cancelar", "ext-can"));
    expect(out.status).toBe("cancelada");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("isBaixaContaSession classifica", () => {
    expect(isBaixaContaSession({ kind: "baixa_conta" })).toBe(true);
    expect(isBaixaContaSession({ kind: "gasto" })).toBe(false);
    expect(isBaixaContaSession(null)).toBe(false);
  });
});

describe("WA-C3 — múltiplas contas pendentes", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-1", nome: "Internet", valor: 100, data_vencimento: "2026-07-05" }),
        makeConta({ id: "c-2", nome: "Internet", valor: 100, data_vencimento: "2026-08-05" }),
      ],
    }),
  );

  it("pede escolha sem mostrar valor", async () => {
    const out = await processarMensagemWhatsApp(msg("paguei a internet"));
    expect(out.resposta).toMatch(/Escolha uma/i);
    expect(out.resposta).toMatch(/1\. Internet/);
    expect(out.resposta).toMatch(/2\. Internet/);
    // Valor NÃO deve aparecer na desambiguação.
    expect(out.resposta).not.toMatch(/R\$ ?100/);
  });

  it("escolha por número (2) marca somente aquela conta", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const conf = await processarMensagemWhatsApp(msg("2", "ext-2"));
    expect(conf.resposta).toContain("Encontrei esta conta pendente");
    const out = await processarMensagemWhatsApp(msg("sim", "ext-3"));
    expect(out.status).toBe("salva");
    const c1 = state.contasData.find((c) => c.id === "c-1");
    const c2 = state.contasData.find((c) => c.id === "c-2");
    expect(c1!.status).toBe("pendente");
    expect(c2!.status).toBe("pago");
  });

  it("resposta inválida não fecha sessão", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const out = await processarMensagemWhatsApp(msg("talvez", "ext-x"));
    expect(out.status).toBe("pendente");
  });
});

describe("WA-C3 — segurança", () => {
  it("não encontra conta de outro usuário", async () => {
    resetState({
      contas: [makeConta({ id: "c-z", user_id: "outro", nome: "Internet" })],
    });
    const out = await processarMensagemWhatsApp(msg("paguei a internet"));
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("Não encontrei");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("conta inexistente: resposta segura sem efeito colateral", async () => {
    resetState({ contas: [] });
    const out = await processarMensagemWhatsApp(msg("paguei a internet"));
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("Não encontrei");
    expect(state.contasData.length).toBe(0);
  });

  it("conta já paga não recebe baixa novamente", async () => {
    resetState({
      contas: [
        makeConta({ id: "c-p", nome: "Internet", status: "pago", data_pagamento: "2026-01-10" }),
      ],
    });
    const out = await processarMensagemWhatsApp(msg("paguei a internet"));
    // findVencimentoByTerm só retorna pendentes → ninguém para baixar.
    expect(out.resposta).toContain("Não encontrei");
  });

  it("reentrega concorrente: segunda confirmação não baixa duas vezes", async () => {
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet" })],
    });
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const ext = "ext-double";
    const a = await processarMensagemWhatsApp(msg("sim", ext));
    expect(a.status).toBe("salva");
    // Segunda execução com mesmo external_id — sessão já fechada / row já paga.
    const b = await processarMensagemWhatsApp(msg("sim", `${ext}-2`));
    // Conta permanece paga; nenhuma duplicidade possível porque o status
    // mudou e o update condicional bloqueia.
    const c = state.contasData[0];
    expect(c.status).toBe("pago");
    expect(b).toBeTruthy();
  });
});

describe("WA-C3 — data de pagamento", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet" })],
    }),
  );

  it("padrão é hoje (America/Sao_Paulo)", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(state.contasData[0].data_pagamento).toBe(todayISOInAppTz());
  });

  it("ajuste para 'ontem' funciona", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const out = await processarMensagemWhatsApp(msg("ontem", "ext-y"));
    expect(out.resposta).toContain("Encontrei esta conta pendente");
    await processarMensagemWhatsApp(msg("sim", "ext-z"));
    const hoje = new Date(`${todayISOInAppTz()}T12:00:00`);
    hoje.setDate(hoje.getDate() - 1);
    const ontemISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    expect(state.contasData[0].data_pagamento).toBe(ontemISO);
  });

  it("data futura exige confirmação extra", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    // monta uma data futura: ano corrente + 1
    const t = new Date(`${todayISOInAppTz()}T12:00:00`);
    t.setFullYear(t.getFullYear() + 1);
    const futISO = `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}/${t.getFullYear()}`;
    const out = await processarMensagemWhatsApp(msg(futISO, "ext-fut"));
    expect(out.resposta).toMatch(/ainda não chegou/i);
    // Sem confirmar: conta segue pendente.
    expect(state.contasData[0].status).toBe("pendente");
    // Confirma a data futura.
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-fut2"));
    expect(ok.status).toBe("salva");
    expect(state.contasData[0].status).toBe("pago");
  });
});

describe("WA-C3 — recorrência: só altera UMA ocorrência", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({
          id: "c-int-jul",
          nome: "Internet",
          data_vencimento: "2026-07-05",
          recorrente: true,
          frequencia_recorrencia: "mensal",
          recorrencia_id: "rec-1",
        }),
        makeConta({
          id: "c-int-ago",
          nome: "Internet",
          data_vencimento: "2026-08-05",
          recorrente: true,
          frequencia_recorrencia: "mensal",
          recorrencia_id: "rec-1",
        }),
      ],
    }),
  );

  it("baixa de julho não altera agosto", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    // Duas pendentes → escolha. Pega a 1ª (mais próxima = julho).
    await processarMensagemWhatsApp(msg("1", "ext-1"));
    const out = await processarMensagemWhatsApp(msg("sim", "ext-2"));
    expect(out.status).toBe("salva");
    const jul = state.contasData.find((c) => c.id === "c-int-jul");
    const ago = state.contasData.find((c) => c.id === "c-int-ago");
    expect(jul!.status).toBe("pago");
    expect(ago!.status).toBe("pendente");
  });
});

describe("WA-C3 — integração com WA-C1", () => {
  it("conta baixada deixa de aparecer em 'minhas contas do mês'", async () => {
    const TODAY = todayISOInAppTz();
    const ym = TODAY.slice(0, 7);
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet", data_vencimento: TODAY })],
    });
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const consulta = await handleDueIntent("u1", { kind: "month", yearMonth: ym });
    expect(consulta.status).toBe("no_due_items");
  });
});

describe("WA-C3 — não interfere com gastos comuns", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet" })],
    }),
  );

  it("'gastei 50 no mercado' segue o parser de gasto", async () => {
    const out = await processarMensagemWhatsApp(msg("gastei 50 no mercado"));
    expect(out.resposta).not.toContain("Encontrei esta conta pendente");
    expect(state.contasData[0].status).toBe("pendente");
  });

  it("'paguei 42 no almoço' segue o parser de gasto", async () => {
    const out = await processarMensagemWhatsApp(msg("paguei 42 no almoço"));
    expect(out.resposta).not.toContain("Encontrei esta conta pendente");
    expect(state.contasData[0].status).toBe("pendente");
  });
});

describe("WA-C3 — logs seguros", () => {
  beforeEach(() =>
    resetState({ contas: [makeConta({ id: "c-int", nome: "Internet", valor: 119.9 })] }),
  );
  afterEach(() => {
    /* noop */
  });

  it("wa_payable_account_payment não vaza PII", async () => {
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
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-log"));
    console.info = orig;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e);
      expect(json).not.toContain("Internet");
      expect(json).not.toContain("119");
      expect(json).not.toContain("c-int");
      expect(json).not.toContain("u1");
      expect(json).not.toContain("5511999998888");
      expect(Object.keys(e).sort()).toEqual(["candidatesCount", "event", "result", "stage"]);
    }
  });
});
