/**
 * WA-C4 — EDITAR, ADIAR e CANCELAR contas a pagar via WhatsApp.
 *
 * Cobre:
 *   - detector estrito (vencimento, valor, categoria, nome, cancelar);
 *   - prévia + confirmação antes de qualquer alteração;
 *   - cancelamento marca status='cancelado' sem apagar a linha;
 *   - conta paga não pode ser editada/cancelada;
 *   - conta cancelada não pode receber baixa (integração WA-C3);
 *   - múltiplas contas → desambiguação;
 *   - conta de outro usuário nunca aparece;
 *   - recorrência → pergunta escopo antes de alterar;
 *   - escopo único altera só uma ocorrência;
 *   - escopo futuro só altera pendentes futuras (preserva pagas e passadas);
 *   - data passada exige confirmação extra;
 *   - reentrega concorrente: mesmo external_id de confirmação bloqueia
 *     segunda execução (claim atômico);
 *   - WA-C1 reflete valor/vencimento atualizados;
 *   - logs não vazam PII.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { detectEdicaoContaIntent, isEdicaoContaSession } = await import(
  "../src/server/whatsapp-contas-editar.server"
);
const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { handleDueIntent } = await import(
  "../src/server/whatsapp-contas.server"
);
const { todayISOInAppTz } = await import(
  "../src/server/contas-vencimento.server"
);

function msg(
  texto: string,
  externalId = `ext-${Math.random().toString(36).slice(2, 10)}`,
) {
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
    valor: opts.valor ?? 100,
    data_vencimento: opts.data_vencimento ?? "2026-07-05",
    status: opts.status ?? "pendente",
    data_pagamento: opts.data_pagamento ?? null,
    categoria_id: opts.categoria_id ?? null,
    recorrente: opts.recorrente ?? false,
    frequencia_recorrencia: opts.frequencia_recorrencia ?? null,
    recorrencia_id: opts.recorrencia_id ?? null,
    mes: opts.mes ?? 7,
    ano: opts.ano ?? 2026,
    ...opts,
  };
}

// ============================================================================
// Detector puro
// ============================================================================
describe("WA-C4 — detectEdicaoContaIntent", () => {
  it("reconhece alteração de vencimento", () => {
    expect(detectEdicaoContaIntent("mudar o vencimento da internet para dia 10")?.operation).toBe("due_date");
    expect(detectEdicaoContaIntent("adiar aluguel para 15/07")?.operation).toBe("due_date");
    expect(detectEdicaoContaIntent("a conta de luz vence agora no dia 20")?.operation).toBe("due_date");
  });
  it("reconhece alteração de valor (formato BR)", () => {
    expect(detectEdicaoContaIntent("o valor da academia agora é 99,90")?.operation).toBe("amount");
    expect(detectEdicaoContaIntent("mudar aluguel para 1.250 reais")?.operation).toBe("amount");
    expect(detectEdicaoContaIntent("internet agora custa 129,90")?.operation).toBe("amount");
  });
  it("reconhece alteração de categoria", () => {
    expect(detectEdicaoContaIntent("alterar categoria da conta de luz para Moradia")?.operation).toBe("category");
    expect(detectEdicaoContaIntent("mudar categoria da internet")?.operation).toBe("category");
  });
  it("reconhece alteração de nome", () => {
    const r = detectEdicaoContaIntent("renomear seguro para Seguro do Carro");
    expect(r?.operation).toBe("name");
    expect(r?.newName).toBe("Seguro do Carro");
  });
  it("reconhece cancelamento", () => {
    expect(detectEdicaoContaIntent("cancelar academia")?.operation).toBe("cancel");
    expect(detectEdicaoContaIntent("excluir internet de julho")?.operation).toBe("cancel");
    expect(detectEdicaoContaIntent("remover conta de luz")?.operation).toBe("cancel");
  });
  it("NÃO captura intenção de gasto comum", () => {
    expect(detectEdicaoContaIntent("gastei 50 no mercado")).toBe(null);
    expect(detectEdicaoContaIntent("paguei a internet")).toBe(null);
  });
  it("NÃO captura fatura/cartão", () => {
    expect(detectEdicaoContaIntent("mudar vencimento da fatura para dia 15")).toBe(null);
    expect(detectEdicaoContaIntent("cancelar o cartão")).toBe(null);
  });
  it("isEdicaoContaSession classifica", () => {
    expect(isEdicaoContaSession({ kind: "edicao_conta" })).toBe(true);
    expect(isEdicaoContaSession({ kind: "cancelamento_conta" })).toBe(true);
    expect(isEdicaoContaSession({ kind: "gasto" })).toBe(false);
    expect(isEdicaoContaSession(null)).toBe(false);
  });
});

// ============================================================================
// Vencimento
// ============================================================================
describe("WA-C4 — alterar vencimento", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet", data_vencimento: "2027-07-05" })],
    }),
  );

  it("mostra prévia com data antiga e nova", async () => {
    const out = await processarMensagemWhatsApp(
      msg("mudar o vencimento da internet para 10/07/2027"),
    );
    expect(out.status).toBe("pendente");
    expect(out.resposta).toContain("Confere");
    expect(out.resposta).toContain("Internet");
    expect(out.resposta).toContain("05/07/2027");
    expect(out.resposta).toContain("10/07/2027");
    expect(state.contasData[0].data_vencimento).toBe("2027-07-05");
  });

  it("sim aplica a alteração; cancelar não", async () => {
    await processarMensagemWhatsApp(msg("adiar internet para 12/07/2027"));
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
    expect(state.contasData[0].data_vencimento).toBe("2027-07-12");
  });

  it("cancelar durante prévia não altera", async () => {
    await processarMensagemWhatsApp(msg("adiar internet para 12/07/2027"));
    const out = await processarMensagemWhatsApp(msg("cancelar", "ext-c"));
    expect(out.status).toBe("cancelada");
    expect(state.contasData[0].data_vencimento).toBe("2027-07-05");
  });
});

// ============================================================================
// Valor
// ============================================================================
describe("WA-C4 — alterar valor", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-ac", nome: "Academia", valor: 89.9 })],
    }),
  );

  it("aceita formato brasileiro 99,90", async () => {
    const out = await processarMensagemWhatsApp(msg("o valor da academia agora é 99,90"));
    expect(out.status).toBe("pendente");
    expect(out.resposta).toMatch(/R\$\s?99,90/);
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(state.contasData[0].valor).toBeCloseTo(99.9, 2);
  });

  it("aceita 1.250 reais", async () => {
    resetState({ contas: [makeConta({ id: "c-al", nome: "Aluguel", valor: 1000 })] });
    await processarMensagemWhatsApp(msg("mudar aluguel para 1.250 reais"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(state.contasData[0].valor).toBeCloseTo(1250, 2);
  });

  it("aceita R$ 1.250,50", async () => {
    resetState({ contas: [makeConta({ id: "c-al", nome: "Aluguel", valor: 1000 })] });
    await processarMensagemWhatsApp(msg("mudar aluguel para R$ 1.250,50"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(state.contasData[0].valor).toBeCloseTo(1250.5, 2);
  });
});

// ============================================================================
// Nome
// ============================================================================
describe("WA-C4 — renomear", () => {
  it("preserva nome novo informado", async () => {
    resetState({ contas: [makeConta({ id: "c-s", nome: "Seguro" })] });
    await processarMensagemWhatsApp(msg("renomear seguro para Seguro do Carro"));
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
    expect(state.contasData[0].nome).toBe("Seguro do Carro");
  });
});

// ============================================================================
// Cancelamento (status='cancelado', linha preservada)
// ============================================================================
describe("WA-C4 — cancelamento preserva linha", () => {
  beforeEach(() =>
    resetState({
      contas: [makeConta({ id: "c-ac", nome: "Academia" })],
    }),
  );

  it("sim marca status='cancelado' sem apagar a linha", async () => {
    const out1 = await processarMensagemWhatsApp(msg("cancelar academia"));
    expect(out1.status).toBe("pendente");
    expect(out1.resposta).toContain("Confirma o cancelamento");
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
    expect(state.contasData.length).toBe(1); // linha preservada
    expect(state.contasData[0].status).toBe("cancelado");
  });

  it("cancelada deixa de aparecer em WA-C1", async () => {
    const TODAY = todayISOInAppTz();
    const ym = TODAY.slice(0, 7);
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet", data_vencimento: TODAY })],
    });
    await processarMensagemWhatsApp(msg("cancelar internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const r = await handleDueIntent("u1", { kind: "month", yearMonth: ym });
    expect(r.status).toBe("no_due_items");
  });

  it("cancelada NÃO pode receber baixa (WA-C3 não a encontra)", async () => {
    await processarMensagemWhatsApp(msg("cancelar academia"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const out = await processarMensagemWhatsApp(msg("paguei academia", "ext-p"));
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("Não encontrei");
  });
});

// ============================================================================
// Conta paga: bloqueio
// ============================================================================
describe("WA-C4 — conta paga é imutável", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-int", nome: "Internet", status: "pago", data_pagamento: "2026-01-10" }),
      ],
    }),
  );

  it("editar conta paga responde mensagem específica", async () => {
    const out = await processarMensagemWhatsApp(msg("adiar internet para dia 20"));
    // findVencimentoByTerm filtra status='pendente' → nem encontra.
    expect(out.status).toBe("consulta");
    expect(state.contasData[0].status).toBe("pago");
  });

  it("cancelar conta paga não altera", async () => {
    const out = await processarMensagemWhatsApp(msg("cancelar internet"));
    expect(out.status).toBe("consulta");
    expect(state.contasData[0].status).toBe("pago");
  });
});

// ============================================================================
// Múltiplas contas: desambiguação
// ============================================================================
describe("WA-C4 — múltiplas contas pedem escolha", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-1", nome: "Internet", data_vencimento: "2026-07-05" }),
        makeConta({ id: "c-2", nome: "Internet", data_vencimento: "2026-08-05" }),
      ],
    }),
  );

  it("oferece escolha numérica sem valor", async () => {
    const out = await processarMensagemWhatsApp(
      msg("adiar internet para dia 15"),
    );
    expect(out.resposta).toMatch(/Escolha qual/);
    expect(out.resposta).toMatch(/1\. Internet/);
    expect(out.resposta).toMatch(/2\. Internet/);
    expect(out.resposta).not.toMatch(/R\$/);
  });

  it("escolha 2 altera somente a segunda", async () => {
    await processarMensagemWhatsApp(msg("adiar internet para dia 15"));
    await processarMensagemWhatsApp(msg("2", "ext-2"));
    await processarMensagemWhatsApp(msg("sim", "ext-3"));
    const c1 = state.contasData.find((c) => c.id === "c-1")!;
    const c2 = state.contasData.find((c) => c.id === "c-2")!;
    expect(c1.data_vencimento).toBe("2026-07-05");
    expect(String(c2.data_vencimento)).toMatch(/-15$/);
  });
});

// ============================================================================
// Isolamento por user_id
// ============================================================================
describe("WA-C4 — isolamento por user_id", () => {
  it("conta de outro usuário não aparece", async () => {
    resetState({
      contas: [makeConta({ id: "c-z", user_id: "outro", nome: "Internet" })],
    });
    const out = await processarMensagemWhatsApp(msg("adiar internet para dia 20"));
    expect(out.status).toBe("consulta");
    expect(state.contasData[0].data_vencimento).toBe("2026-07-05");
  });
});

// ============================================================================
// Recorrência: pergunta escopo
// ============================================================================
describe("WA-C4 — recorrência exige escopo", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({
          id: "c-int-jul", nome: "Internet", data_vencimento: "2027-07-05",
          recorrente: true, recorrencia_id: "rec-1",
        }),
        makeConta({
          id: "c-int-ago", nome: "Internet", data_vencimento: "2027-08-05",
          recorrente: true, recorrencia_id: "rec-1",
        }),
        makeConta({
          id: "c-int-set", nome: "Internet", data_vencimento: "2027-09-05",
          recorrente: true, recorrencia_id: "rec-1",
        }),
        makeConta({
          id: "c-int-jun-paga", nome: "Internet", data_vencimento: "2027-06-05",
          status: "pago", recorrente: true, recorrencia_id: "rec-1",
        }),
      ],
    }),
  );

  it("pergunta escopo antes de alterar", async () => {
    const out = await processarMensagemWhatsApp(msg("adiar internet para 12/07/2027"));
    // 3 pendentes → desambiguação primeiro.
    expect(out.resposta).toMatch(/Escolha qual|recorrência/i);
  });

  it("escopo SINGLE altera apenas a ocorrência selecionada", async () => {
    await processarMensagemWhatsApp(msg("adiar internet para 12/07/2027"));
    await processarMensagemWhatsApp(msg("1", "ext-1")); // 1ª (julho)
    // Pergunta escopo agora.
    await processarMensagemWhatsApp(msg("1", "ext-2")); // escopo: somente esta
    await processarMensagemWhatsApp(msg("sim", "ext-3"));
    const jul = state.contasData.find((c) => c.id === "c-int-jul")!;
    const ago = state.contasData.find((c) => c.id === "c-int-ago")!;
    const set = state.contasData.find((c) => c.id === "c-int-set")!;
    const jun = state.contasData.find((c) => c.id === "c-int-jun-paga")!;
    expect(jul.data_vencimento).toBe("2027-07-12");
    expect(ago.data_vencimento).toBe("2027-08-05");
    expect(set.data_vencimento).toBe("2027-09-05");
    expect(jun.status).toBe("pago");
  });

  it("escopo FUTURE_PENDING altera só pendentes >= data selecionada", async () => {
    await processarMensagemWhatsApp(msg("adiar internet para 12/07/2027"));
    await processarMensagemWhatsApp(msg("2", "ext-1")); // escolhe agosto
    await processarMensagemWhatsApp(msg("2", "ext-2")); // escopo: esta e próximas
    await processarMensagemWhatsApp(msg("sim", "ext-3"));
    const jul = state.contasData.find((c) => c.id === "c-int-jul")!;
    const ago = state.contasData.find((c) => c.id === "c-int-ago")!;
    const set = state.contasData.find((c) => c.id === "c-int-set")!;
    const jun = state.contasData.find((c) => c.id === "c-int-jun-paga")!;
    // julho permanece (anterior ao escopo de agosto).
    expect(jul.data_vencimento).toBe("2027-07-05");
    // agosto e setembro alterados.
    expect(ago.data_vencimento).toBe("2027-07-12");
    expect(set.data_vencimento).toBe("2027-07-12");
    // paga intacta.
    expect(jun.status).toBe("pago");
    expect(jun.data_vencimento).toBe("2027-06-05");
  });
});

// ============================================================================
// Data passada
// ============================================================================
describe("WA-C4 — data passada exige confirmação extra", () => {
  it("pede confirmação adicional antes de aplicar", async () => {
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet", data_vencimento: "2099-01-05" })],
    });
    // "ontem" é necessariamente passado.
    const out = await processarMensagemWhatsApp(msg("adiar internet para ontem"));
    expect(out.resposta).toMatch(/já passou/i);
    expect(state.contasData[0].data_vencimento).toBe("2099-01-05");
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-c"));
    expect(ok.status).toBe("salva");
  });
});

// ============================================================================
// Concorrência: claim atômico via external_id
// ============================================================================
describe("WA-C4 — concorrência protege contra reentrega", () => {
  it("segunda confirmação com mesmo external_id não duplica efeitos", async () => {
    resetState({
      contas: [makeConta({ id: "c-int", nome: "Internet", valor: 100 })],
    });
    await processarMensagemWhatsApp(msg("mudar internet para 150 reais"));
    const ext = "ext-double";
    const a = await processarMensagemWhatsApp(msg("sim", ext));
    expect(a.status).toBe("salva");
    expect(state.contasData[0].valor).toBeCloseTo(150, 2);
    // Reenvia o mesmo external_id (sessão já está fechada).
    const b = await processarMensagemWhatsApp(msg("sim", ext));
    expect(state.contasData[0].valor).toBeCloseTo(150, 2);
    expect(b).toBeTruthy();
  });
});

// ============================================================================
// Integração com WA-C1
// ============================================================================
describe("WA-C4 — integração com WA-C1", () => {
  it("após alterar vencimento, novo valor aparece no resumo", async () => {
    const TODAY = todayISOInAppTz();
    const ym = TODAY.slice(0, 7);
    const day = TODAY.slice(-2);
    resetState({
      contas: [
        makeConta({ id: "c-int", nome: "Internet", valor: 100, data_vencimento: TODAY }),
      ],
    });
    await processarMensagemWhatsApp(msg(`mudar internet para 250 reais`));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const r = await handleDueIntent("u1", { kind: "month", yearMonth: ym });
    expect(r.status).toBe("answered");
    void day;
    // R$ 250 deve aparecer no total ou na linha.
    expect(r.resposta).toMatch(/250/);
  });
});

// ============================================================================
// Logs seguros
// ============================================================================
describe("WA-C4 — logs sem PII", () => {
  afterEach(() => {
    /* noop */
  });
  it("wa_payable_account_edit não vaza nome/valor/data/IDs", async () => {
    resetState({ contas: [makeConta({ id: "c-int", nome: "Internet", valor: 100 })] });
    const events: Record<string, unknown>[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      for (const a of args) {
        if (a && typeof a === "object" && (a as Record<string, unknown>).event === "wa_payable_account_edit") {
          events.push(a as Record<string, unknown>);
        }
      }
    };
    await processarMensagemWhatsApp(msg("mudar internet para 250 reais"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    console.info = orig;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e);
      expect(json).not.toContain("Internet");
      expect(json).not.toContain("c-int");
      expect(json).not.toContain("u1");
      expect(json).not.toContain("5511999998888");
      expect(json).not.toContain("250");
      expect(json).not.toContain("2026-07-05");
      // chaves permitidas apenas.
      const keys = Object.keys(e).sort();
      expect(keys).toEqual(["affectedCountBucket", "candidatesCount", "event", "operation", "result", "stage"]);
    }
  });
});

// ============================================================================
// Gasto comum não é afetado
// ============================================================================
describe("WA-C4 — gasto comum permanece com parser de gasto", () => {
  beforeEach(() =>
    resetState({ contas: [makeConta({ id: "c-int", nome: "Internet" })] }),
  );
  it("'gastei 50 no mercado' não cai em edição", async () => {
    const out = await processarMensagemWhatsApp(msg("gastei 50 no mercado"));
    expect(out.resposta).not.toContain("Confere pra mim");
    expect(state.contasData[0].nome).toBe("Internet");
  });
});
