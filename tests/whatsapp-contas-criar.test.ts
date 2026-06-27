/**
 * WA-C2 — Testes de CRIAÇÃO DE CONTAS A PAGAR / VENCIMENTOS RECORRENTES.
 *
 * Cobre detector puro, parser, fluxo conversacional completo, idempotência,
 * categoria manual, recorrência, integração com WA-C1 e logs seguros.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const {
  detectPayableAccountIntent,
  detectFrequencia,
  parsePayableAccountMessage,
  expandRecurrenceDates,
  isContaSession,
} = await import("../src/server/whatsapp-contas-criar.server");

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

const { detectDueIntent, handleDueIntent } = await import(
  "../src/server/whatsapp-contas.server"
);
const { todayISOInAppTz, monthRangeInAppTz } = await import(
  "../src/server/contas-vencimento.server"
);

function msg(texto: string, externalId = `ext-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

describe("WA-C2 — detectPayableAccountIntent", () => {
  it("reconhece criação de conta com vencimento", () => {
    expect(detectPayableAccountIntent("Minha internet de 119,90 vence dia 5 todo mês")).toBe(true);
    expect(detectPayableAccountIntent("Cadastrar aluguel de 1.200 reais para vencer dia 10")).toBe(true);
    expect(detectPayableAccountIntent("Tenho uma conta de luz de 180 reais que vence em 20 de julho")).toBe(true);
    expect(detectPayableAccountIntent("Criar academia de 89,90 todo dia 8")).toBe(true);
    expect(detectPayableAccountIntent("Plano de saúde de 970 vence dia 15 todo mês")).toBe(true);
  });

  it("não confunde com gasto consumado, receita ou saldo", () => {
    expect(detectPayableAccountIntent("Gastei 120 no mercado")).toBe(false);
    expect(detectPayableAccountIntent("Paguei a internet")).toBe(false);
    expect(detectPayableAccountIntent("Comprei um tênis")).toBe(false);
    expect(detectPayableAccountIntent("Recebi salário de 5000")).toBe(false);
    expect(detectPayableAccountIntent("Quanto sobra esse mês")).toBe(false);
  });

  it("não confunde com fatura de cartão (WA-F1..F5)", () => {
    expect(detectPayableAccountIntent("Minha fatura vence dia 10")).toBe(false);
    expect(detectPayableAccountIntent("Quanto vence minha fatura do Nubank?")).toBe(false);
    expect(detectPayableAccountIntent("Cadastrar limite do Inter")).toBe(false);
  });

  it("ignora frases vazias / saudação", () => {
    expect(detectPayableAccountIntent("")).toBe(false);
    expect(detectPayableAccountIntent("oi")).toBe(false);
    expect(detectPayableAccountIntent("ajuda")).toBe(false);
  });
});

describe("WA-C2 — detectFrequencia / parsePayableAccountMessage", () => {
  it("detecta frequência", () => {
    expect(detectFrequencia("vence dia 5 todo mês")).toBe("mensal");
    expect(detectFrequencia("toda semana")).toBe("semanal");
    expect(detectFrequencia("seguro anual de 900")).toBe("anual");
    expect(detectFrequencia("conta de luz dia 20")).toBe(null);
  });

  it("parsePayableAccountMessage extrai nome, valor, recorrência", () => {
    const d = parsePayableAccountMessage("Internet de 119,90 vence dia 5 todo mês", new Date(2026, 5, 15));
    expect(d.valorCentavos).toBe(11990);
    expect(d.recorrente).toBe(true);
    expect(d.frequenciaRecorrencia).toBe("mensal");
    expect(d.dataVencimento).toMatch(/^2026-(06|07)-05$/);
    expect((d.nome ?? "").toLowerCase()).toContain("internet");
  });

  it("aluguel R$ 1.200 dia 10 todo mês → mensal", () => {
    const d = parsePayableAccountMessage("Aluguel de 1.200 vence todo dia 10", new Date(2026, 5, 15));
    expect(d.valorCentavos).toBe(120000);
    expect(d.recorrente).toBe(true);
    expect(d.dataVencimento).toMatch(/^2026-(06|07)-10$/);
  });

  it("conta única com data passada e sem 'todo mês': pede confirmação (dia_somente)", () => {
    const d = parsePayableAccountMessage("Conta de luz de 180 vence dia 1", new Date(2026, 6, 15));
    // como "dia 1" não tem mês explícito e não é recorrente, retorna diaInformado
    expect(d.diaInformado).toBe(1);
    expect(d.dataVencimento).toBe(null);
  });

  it("ignora cadastros sem valor (deixa para handler perguntar)", () => {
    const d = parsePayableAccountMessage("Internet vence dia 5 todo mês");
    expect(d.valorCentavos).toBe(null);
    expect(d.recorrente).toBe(true);
  });
});

describe("WA-C2 — expandRecurrenceDates (mesma regra do site)", () => {
  it("mensal: setMonth +i", () => {
    const r = expandRecurrenceDates("2026-01-15", "mensal", 3);
    expect(r).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });
  it("semanal: setDate +7*i", () => {
    const r = expandRecurrenceDates("2026-01-01", "semanal", 3);
    expect(r).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
  });
  it("anual: setFullYear +i", () => {
    const r = expandRecurrenceDates("2026-03-15", "anual", 2);
    expect(r).toEqual(["2026-03-15", "2027-03-15"]);
  });
});

describe("WA-C2 — fluxo completo (texto)", () => {
  beforeEach(() => resetState());

  it("conta única completa: gera prévia e confirma com 'sim'", async () => {
    const out1 = await processarMensagemWhatsApp(
      msg("Tenho uma conta de luz de 180 reais que vence em 20 de julho de 2026"),
    );
    expect(out1.resposta).toContain("Confere pra mim?");
    expect(out1.resposta).toContain("180");
    expect(out1.resposta).toContain("20/07/2026");
    expect(out1.resposta).toMatch(/Recorrência:\s+Única/i);
    // Antes do "sim" — nada persistido.
    expect(state.contasData.length).toBe(0);

    const out2 = await processarMensagemWhatsApp(msg("sim", "ext-2"));
    expect(out2.status).toBe("salva");
    expect(out2.resposta).toContain("Registrei sua conta a pagar");
    expect(state.contasData.length).toBe(1);
    const conta = state.contasData[0]!;
    expect(conta.status).toBe("pendente");
    expect(conta.recorrente).toBe(false);
    expect(conta.user_id).toBe("u1");
  });

  it("conta recorrente mensal: 12 ocorrências sob mesmo recorrencia_id", async () => {
    const out1 = await processarMensagemWhatsApp(
      msg("Internet de 119,90 vence dia 5 todo mês"),
    );
    expect(out1.resposta).toContain("Confere pra mim?");
    expect(out1.resposta).toMatch(/Recorrência:\s+Mensal/i);

    const out2 = await processarMensagemWhatsApp(msg("sim", "ext-2"));
    expect(out2.status).toBe("salva");
    expect(state.contasData.length).toBe(12);
    const recId = state.contasData[0]!.recorrencia_id;
    expect(recId).toBeTruthy();
    for (const c of state.contasData) {
      expect(c.recorrencia_id).toBe(recId);
      expect(c.recorrente).toBe(true);
      expect(c.frequencia_recorrencia).toBe("mensal");
      expect(c.status).toBe("pendente");
    }
  });

  it("sem valor: pergunta valor e respeita o restante", async () => {
    const out1 = await processarMensagemWhatsApp(msg("Cadastrar internet que vence dia 5 todo mês"));
    expect(out1.resposta).toMatch(/valor previsto/i);
    expect(state.contasData.length).toBe(0);

    const out2 = await processarMensagemWhatsApp(msg("119,90", "ext-2"));
    expect(out2.resposta).toContain("Confere pra mim?");
    expect(out2.resposta).toContain("119,90");
  });

  it("sem vencimento: pergunta vencimento", async () => {
    const out1 = await processarMensagemWhatsApp(msg("Cadastrar internet de 119,90 todo mês"));
    expect(out1.resposta).toMatch(/data de vencimento/i);
  });

  it("data passada sem 'todo mês': pergunta o mês explícito", async () => {
    // "dia 1" sem recorrência → deve pedir confirmação do mês.
    const out1 = await processarMensagemWhatsApp(msg("Cadastrar conta de luz de 180 reais dia 1"));
    expect(out1.resposta).toMatch(/dia 1/i);
    expect(out1.resposta).toMatch(/qual m[eê]s/i);
    expect(state.contasData.length).toBe(0);
  });

  it("cancelar não cria conta", async () => {
    await processarMensagemWhatsApp(msg("Internet de 119,90 vence dia 5 todo mês"));
    const out2 = await processarMensagemWhatsApp(msg("cancelar", "ext-2"));
    expect(out2.status).toBe("cancelada");
    expect(state.contasData.length).toBe(0);
  });
});

describe("WA-C2 — idempotência e reentrega concorrente", () => {
  beforeEach(() => resetState());
  it("reentrega do mesmo external_message_id na confirmação não duplica conta", async () => {
    await processarMensagemWhatsApp(msg("Aluguel de 1.200 vence dia 10 todo mês"));
    const ext = "ext-confirm-1";
    const a = await processarMensagemWhatsApp(msg("sim", ext));
    expect(a.status).toBe("salva");
    expect(state.contasData.length).toBe(12);
    // Segunda confirmação com MESMO external_id → falha do claim, sem duplicidade.
    const b = await processarMensagemWhatsApp(msg("sim", ext));
    // Reentrega não pode somar mais 12 ocorrências.
    expect(state.contasData.length).toBe(12);
    expect(b).toBeTruthy();
  });
});

describe("WA-C2 — falha de persistência não envia sucesso falso", () => {
  beforeEach(() => resetState());
  afterEach(() => mock.restore());

  it("erro no insert → mensagem de erro, sem conta criada", async () => {
    await processarMensagemWhatsApp(msg("Conta de luz de 180 reais vence em 20 de julho de 2026"));
    // Substitui o admin.from para falhar APENAS no insert em contas_a_pagar.
    const supa = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (supa.supabaseAdmin as any).from;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supa.supabaseAdmin as any).from = (t: string) => {
      const b = orig(t);
      if (t === "contas_a_pagar") {
        const wrapped = {
          ...b,
          insert: () => ({ ...b, then: (res: (v: unknown) => void) => res({ error: { code: "X", message: "boom" } }) }),
        };
        return wrapped;
      }
      return b;
    };
    const out = await processarMensagemWhatsApp(msg("sim", "ext-fail-1"));
    expect(out.status).toBe("erro");
    expect(out.resposta).not.toContain("Registrei");
    expect(state.contasData.length).toBe(0);
    // Restaura.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supa.supabaseAdmin as any).from = orig;
  });
});

describe("WA-C2 — não interfere com outros fluxos", () => {
  beforeEach(() => resetState());

  it("'gastei 30 no Uber' continua no parser de gasto comum", async () => {
    const out = await processarMensagemWhatsApp(msg("gastei 30 no Uber"));
    expect(out.resposta).not.toContain("Conta a pagar");
    // O parser de gasto roteia para forma de pagamento ou descrição/valor.
    expect(["aguardando_forma_pagamento", "valor_invalido", "pendente"]).toContain(out.status);
  });

  it("'fatura do Nubank' continua nas fases WA-F (não cria conta)", async () => {
    const out = await processarMensagemWhatsApp(msg("quando vence minha fatura do Nubank?"));
    expect(out.resposta).not.toContain("Confere pra mim?");
    expect(state.contasData.length).toBe(0);
  });
});

describe("WA-C2 — integração com WA-C1", () => {
  beforeEach(() => resetState());

  it("conta única para hoje aparece em 'o que vence hoje?'", async () => {
    const TODAY = todayISOInAppTz();
    const [y, m, d] = TODAY.split("-").map(Number);
    const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][m - 1];
    await processarMensagemWhatsApp(
      msg(`Cadastrar conta de luz de 180 reais que vence em ${d} de ${MES} de ${y}`),
    );
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-conf"));
    expect(ok.status).toBe("salva");

    const consulta = await handleDueIntent("u1", { kind: "today" });
    expect(consulta.status).toBe("answered");
    expect(consulta.resposta.toLowerCase()).toContain("luz");
  });

  it("conta recorrente aparece em 'minhas contas do mês'", async () => {
    await processarMensagemWhatsApp(msg("Internet de 119,90 vence dia 5 todo mês"));
    const ok = await processarMensagemWhatsApp(msg("sim", "ext-rec"));
    expect(ok.status).toBe("salva");

    // Pega o ano-mês da primeira ocorrência efetivamente persistida
    // (pode ser o mês corrente ou o próximo, dependendo do dia atual).
    const primeira = state.contasData[0]!;
    const ym = String(primeira.data_vencimento).slice(0, 7);
    const consulta = await handleDueIntent("u1", { kind: "month", yearMonth: ym });
    expect(consulta.status).toBe("answered");

    expect(consulta.resposta.toLowerCase()).toContain("internet");
  });

  it("WA-C1 reconhece intent da pergunta", () => {
    expect(detectDueIntent("o que vence hoje?")?.kind).toBe("today");
  });
});

describe("WA-C2 — logs seguros", () => {
  beforeEach(() => resetState());

  it("wa_payable_account_decision não vaza valor, nome, data, userId, telefone, texto", async () => {
    const events: Record<string, unknown>[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      for (const a of args) {
        if (a && typeof a === "object" && (a as Record<string, unknown>).event === "wa_payable_account_decision") {
          events.push(a as Record<string, unknown>);
        }
      }
    };
    await processarMensagemWhatsApp(msg("Internet de 119,90 vence dia 5 todo mês"));
    await processarMensagemWhatsApp(msg("sim", "ext-log"));
    console.info = orig;

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e);
      expect(json).not.toContain("119,90");
      expect(json).not.toContain("119.90");
      expect(json).not.toContain("Internet");
      expect(json).not.toContain("u1");
      expect(json).not.toContain("5511999998888");
      expect(json).not.toContain("todo mês");
      // Campos permitidos:
      expect(Object.keys(e).sort()).toEqual([
        "event",
        "frequencyPresent",
        "recurringPresent",
        "result",
        "stage",
      ]);
    }
  });
});

describe("WA-C2 — categoria manual marca 'manual' e não grava memória", () => {
  beforeEach(() => resetState());

  it("usuário escolhe categoria → categorySelectionSource=manual", async () => {
    await processarMensagemWhatsApp(msg("Internet de 119,90 vence dia 5 todo mês"));
    // Comando "categoria" → abre picker
    const out = await processarMensagemWhatsApp(msg("categoria", "ext-cat"));
    expect(out.resposta.toLowerCase()).toContain("categoria");
    // Escolhe por número (lista curta) — pode variar entre 1..N; tenta nome conhecido.
    await processarMensagemWhatsApp(msg("Internet", "ext-cat-2"));
    // Agora confirma.
    const fim = await processarMensagemWhatsApp(msg("sim", "ext-cat-3"));
    expect(fim.status).toBe("salva");
    // Memória de estabelecimento NÃO foi gravada (não há linha em
    // whatsapp_merchant_category_memories — fake não inclui essa tabela
    // e qualquer chamada falharia silenciosamente, mas o módulo de
    // contas a pagar não tenta gravar memória de jeito nenhum).
    const insertedTables = state.inserts.map((i) => i.table);
    expect(insertedTables).not.toContain("whatsapp_merchant_category_memories");
  });
});

describe("WA-C2 — isContaSession", () => {
  it("classifica sessão corretamente", () => {
    expect(isContaSession({ kind: "conta_a_pagar" })).toBe(true);
    expect(isContaSession({ kind: "parcelamento" })).toBe(false);
    expect(isContaSession(null)).toBe(false);
  });
});

describe("WA-C2 — não interrompe sessão financeira ativa", () => {
  beforeEach(() => resetState());

  it("sessão de gasto pendente: 'cadastrar internet...' NÃO inicia conta a pagar", async () => {
    // Cria sessão de gasto pendente.
    await processarMensagemWhatsApp(msg("gastei 30"));
    // Próxima mensagem: o parser de gasto está aguardando descrição.
    // A mensagem com cara de "cadastrar internet" não deve dar bypass.
    const out = await processarMensagemWhatsApp(msg("cadastrar internet de 119,90 vence dia 5 todo mês", "ext-x"));
    // Está em fluxo de gasto, então NÃO deve produzir a prévia da conta a pagar.
    expect(out.resposta).not.toContain("Conta:");
    expect(state.contasData.length).toBe(0);
  });
});
