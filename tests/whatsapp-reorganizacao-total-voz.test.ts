/**
 * WA-REORG-TOTAL-VOZ — Escopo total ("zerar tudo") e confirmação/restauração por voz.
 *
 * Garante que:
 *  - "GI, exclua tudo que eu já fiz até agora. Todos os gastos, receitas e
 *    lançamentos. Quero zerar meu histórico financeiro." vira pedido de
 *    escopo TOTAL (start=null, end=null → inclui o mês atual);
 *  - escopo total é DISTINTO de "meses anteriores" (end = início do mês atual);
 *  - "lançamentos"/"movimentações" e domínio financeiro total cobrem as duas
 *    tabelas; "limpa tudo" sem domínio continua ambíguo;
 *  - a prévia do escopo total diz explicitamente "incluindo o mês atual";
 *  - a confirmação por voz exige exatamente seis dígitos falados e segue
 *    vinculada ao código da prévia; frases aproximadas nunca confirmam;
 *  - "restaurar última limpeza" resolve o lote mais recente e segue o fluxo
 *    de prévia + código exclusivo (nunca restaura direto);
 *  - tudo permanece bloqueado enquanto o release estiver desligado.
 */
import { describe, expect, test } from "bun:test";
import {
  interpretReorganization,
  confirmationCode,
  spokenConfirmationCode,
} from "../src/lib/whatsapp-reorganizacao";
import {
  blockedReorganizationReply,
  runReorganization,
  WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED,
  type ReorganizationInput,
  type ReorganizationStore,
} from "../src/server/whatsapp-reorganizacao.server";

const date = "2026-11-04";
const input: ReorganizationInput = {
  userId: "A",
  phone: "5511999999999",
  externalId: "msg1",
  text: "",
  localDate: date,
  pendingSession: false,
};

describe("escopo total: zerar todo o histórico (inclui mês atual)", () => {
  test("exemplo real do usuário vira escopo total das duas tabelas", () => {
    expect(
      interpretReorganization(
        "GI, exclua tudo que eu já fiz até agora. Todos os gastos, receitas e lançamentos. Quero zerar meu histórico financeiro.",
        date,
      ),
    ).toEqual({
      kind: "request",
      scope: { tables: ["gastos", "receitas"], start: null, end: null },
      income: null,
    });
  });

  test("zerar minhas finanças cobre gastos e receitas", () => {
    expect(interpretReorganization("quero zerar minhas finanças", date)).toMatchObject({
      kind: "request",
      scope: { tables: ["gastos", "receitas"], start: null, end: null },
    });
  });

  test("exclua todos os lançamentos cobre as duas tabelas", () => {
    expect(interpretReorganization("exclua todos os lançamentos", date)).toMatchObject({
      kind: "request",
      scope: { tables: ["gastos", "receitas"], start: null, end: null },
    });
  });

  test("apague todo o meu histórico é escopo total", () => {
    expect(interpretReorganization("apague todo o meu histórico", date)).toMatchObject({
      kind: "request",
      scope: { start: null, end: null },
    });
  });

  test("DISTINÇÃO: meses anteriores preserva o mês atual", () => {
    expect(
      interpretReorganization(
        "exclua todas as minhas despesas e receitas dos meses anteriores, mantenha as deste mês",
        date,
      ),
    ).toMatchObject({ kind: "request", scope: { start: null, end: "2026-11-01" } });
  });

  test("DISTINÇÃO: escopo total NÃO preserva o mês atual", () => {
    const r = interpretReorganization("exclua todos os meus gastos e receitas, quero zerar tudo", date);
    expect(r).toMatchObject({ kind: "request", scope: { start: null, end: null } });
  });

  test("somente receitas de todo o histórico", () => {
    expect(interpretReorganization("exclua todas as minhas receitas de todo o histórico", date)).toMatchObject({
      kind: "request",
      scope: { tables: ["receitas"], start: null, end: null },
    });
  });

  test("somente despesas de todo o histórico", () => {
    expect(interpretReorganization("apague todas as despesas de todos os meses", date)).toMatchObject({
      kind: "request",
      scope: { tables: ["gastos"], start: null, end: null },
    });
  });

  test("limpa tudo sem domínio continua ambíguo", () => {
    expect(interpretReorganization("GI limpa tudo", date).kind).toBe("clarify");
  });

  test("escopo total com período explícito não se mistura", () => {
    expect(interpretReorganization("exclua tudo de outubro de 2026", date).kind).toBe("clarify");
  });
});

describe("confirmação por voz (segundo áudio)", () => {
  test("seis dígitos falados confirmam", () => {
    expect(spokenConfirmationCode("apagar zero zero quatro oito dois um")).toBe("004821");
  });

  test("com a palavra código também confirma", () => {
    expect(spokenConfirmationCode("apagar o código um dois três quatro cinco seis")).toBe("123456");
  });

  test("frase aproximada com quatro dígitos NUNCA confirma", () => {
    expect(spokenConfirmationCode("apagar quatro oito dois um")).toBeNull();
  });

  test("palavras que não são dígitos não confirmam", () => {
    expect(spokenConfirmationCode("apagar pode confirmar a limpeza agora sim")).toBeNull();
  });

  test("confirmação digitada continua funcionando", () => {
    expect(confirmationCode("apagar 004821")).toBe("004821");
  });
});

describe("pipeline: prévia de escopo total e confirmação falada", () => {
  const makeStore = () => {
    let code = "";
    let confirmed = false;
    let confirmCalls = 0;
    const store: ReorganizationStore = {
      authorize: async (user, phone) => user === "A" && phone === input.phone,
      prepare: async (_, scope, income, c) => {
        code = c;
        return {
          status: "preview",
          code: c,
          expiresAt: "2026-11-04T22:05:00Z",
          scope,
          income,
          expenses: 126,
          incomes: 38,
          totalExpenses: 9000,
          totalIncomes: 12000,
          operationId: "op-total-1",
        };
      },
      confirm: async (_, c) => {
        confirmCalls++;
        if (c !== code) return { status: "wrong_code" };
        if (confirmed) return { status: "replay" };
        confirmed = true;
        return { status: "applied", expenses: 126, incomes: 38 };
      },
      cancel: async () => ({ status: "cancelled" }),
      status: async () => ({ status: confirmed ? "applied" : "preview" }),
      restore: async () => ({ status: "blocked" }),
      prepareRestore: async (_, operationId, c) => ({
        status: "restore_preview",
        operationId,
        code: c,
        expiresAt: "2026-11-04T22:10:00Z",
        expenses: 126,
        incomes: 38,
      }),
      confirmRestore: async () => ({ status: "restored", expenses: 126, incomes: 38, kept: 0 }),
      resolveLastApplied: async () => "op-total-1",
    };
    return { store, code: () => code, confirmCalls: () => confirmCalls };
  };

  test("prévia de escopo total diz explicitamente que inclui o mês atual", async () => {
    const s = makeStore();
    const out = await runReorganization(
      { ...input, text: "GI, exclua tudo que eu já fiz até agora. Todos os gastos, receitas e lançamentos. Quero zerar meu histórico financeiro." },
      s.store,
    );
    expect(out).toContain("incluindo o mês atual");
    expect(out).toContain("126 gastos");
    expect(out).toContain("38 receitas");
    expect(out).toContain("Nada foi alterado");
  });

  test("prévia de meses anteriores NÃO diz que inclui o mês atual", async () => {
    const s = makeStore();
    const out = await runReorganization(
      { ...input, text: "exclua todas as minhas despesas e receitas dos meses anteriores, mantenha as deste mês" },
      s.store,
    );
    expect(out).not.toContain("incluindo o mês atual");
    expect(out).toContain("2026-11-01 (não incluído)");
  });

  test("confirmação falada com seis dígitos executa uma única vez", async () => {
    const s = makeStore();
    await runReorganization({ ...input, text: "exclua todos os lançamentos" }, s.store);
    const spoken = `apagar ${s.code().split("").map((d) => ({ "0": "zero", "1": "um", "2": "dois", "3": "tres", "4": "quatro", "5": "cinco", "6": "seis", "7": "sete", "8": "oito", "9": "nove" })[d]!).join(" ")}`;
    const out = await runReorganization({ ...input, text: spoken }, s.store);
    expect(out).toContain("Reorganização concluída");
    expect(s.confirmCalls()).toBe(1);
    const replay = await runReorganization({ ...input, text: spoken }, s.store);
    expect(replay).toContain("já foi concluída");
    expect(s.confirmCalls()).toBe(2);
  });

  test("restaurar última limpeza resolve o lote e pede código novo", async () => {
    const s = makeStore();
    const out = await runReorganization({ ...input, text: "restaurar última limpeza" }, s.store);
    expect(out).toContain("Prévia de restauração do lote op-total-1");
    expect(out).toContain("RESTAURAR op-total-1");
    expect(out).toContain("Nada foi restaurado");
  });

  test("restaurar última limpeza sem store compatível falha fechada", async () => {
    const s = makeStore();
    delete (s.store as Partial<ReorganizationStore>).resolveLastApplied;
    const out = await runReorganization({ ...input, text: "restaurar última limpeza" }, s.store);
    expect(out).toContain("bloqueada");
  });
});

describe("bloqueio de produção permanece", () => {
  test("release continua desligado", () => {
    expect(WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED).toBe(false);
  });

  test("pedido de zerar tudo é interceptado mesmo bloqueado", () => {
    const out = blockedReorganizationReply(
      "GI, exclua tudo que eu já fiz até agora. Todos os gastos, receitas e lançamentos. Quero zerar meu histórico financeiro.",
      false,
    );
    expect(out).toContain("bloqueada");
  });

  test("confirmação falada é interceptada mesmo bloqueada", () => {
    expect(blockedReorganizationReply("apagar zero zero quatro oito dois um", false)).toContain("bloqueada");
  });

  test("restaurar última limpeza é interceptado mesmo bloqueado", () => {
    expect(blockedReorganizationReply("restaurar última limpeza", false)).toContain("bloqueada");
  });
});
