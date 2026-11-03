import { describe, expect, test } from "bun:test";
import { confirmationCode, interpretReorganization, offlineWriteDecision, REORGANIZACAO_TTL_MS } from "../src/lib/whatsapp-reorganizacao";
import { blockedReorganizationReply, runReorganization, WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED, type ReorganizationInput, type ReorganizationStore } from "../src/server/whatsapp-reorganizacao.server";
import { createReorganizationStore } from "../src/server/whatsapp-reorganizacao-store.server";

const date = "2026-11-03";
const input: ReorganizationInput = { userId: "A", phone: "5511999999999", externalId: "msg1", text: "", localDate: date, pendingSession: false };
describe("reorganização: interpretação conservadora", () => {
  test("histórico inteiro, gastos e receitas", () => {
    expect(interpretReorganization("GI, exclua todas as minhas despesas e receitas de todos os meses", date)).toEqual({ kind: "request", scope: { tables: ["gastos", "receitas"], start: null, end: null }, income: null });
  });
  test("preservar mês atual usa limite exclusivo", () => {
    expect(interpretReorganization("apague minhas despesas e receitas dos meses anteriores, mantenha as informações deste mês", date)).toMatchObject({ kind: "request", scope: { end: "2026-11-01" } });
  });
  test("gastos pagos continuam no escopo", () => {
    expect(interpretReorganization("exclua todos os meus gastos inclusive os já pagos", date)).toMatchObject({ scope: { tables: ["gastos"] } });
  });
  test("somente receitas de outubro com ano", () => {
    expect(interpretReorganization("exclua todas as receitas de outubro de 2026", date)).toMatchObject({ scope: { tables: ["receitas"], start: "2026-10-01", end: "2026-11-01" } });
  });
  test("intervalo janeiro a setembro", () => {
    expect(interpretReorganization("apaga as despesas de janeiro até setembro de 2026", date)).toMatchObject({ scope: { start: "2026-01-01", end: "2026-10-01" } });
  });
  test("sem ano pede esclarecimento", () => expect(interpretReorganization("exclua receitas de outubro", date).kind).toBe("clarify"));
  test("limpa tudo é ambíguo", () => expect(interpretReorganization("GI limpa tudo", date).kind).toBe("clarify"));
  test("pagamentos são ambíguos", () => expect(interpretReorganization("apaga todos os pagamentos", date).kind).toBe("clarify"));
  test("saldo inicial não vira receita", () => expect(interpretReorganization("tenho R$ 3.200 na Nubank como saldo inicial", date).kind).toBe("unsupported_balance"));
  test("limpar e adicionar 4500 não extrai data como dinheiro", () => {
    expect(interpretReorganization("apague gastos e receitas anteriores e depois adicione R$ 4.500 como receita deste mês", date)).toMatchObject({ income: { valor: 4500, data: date } });
  });
  test("salário com mês sem data completa pede confirmação", () => expect(interpretReorganization("exclui receitas antigas e adiciona R$ 2.800 como salário de novembro", date).kind).toBe("clarify"));
  test("consulta não é exclusão", () => expect(interpretReorganization("quanto dinheiro tenho disponível", date).kind).toBe("ignore"));
  test("todos os gastos de outubro não significa todos os meses", () => expect(interpretReorganization("exclua todos os meus gastos de outubro de 2026", date)).toMatchObject({ scope: { start: "2026-10-01", end: "2026-11-01" } }));
  test("negação nunca autoriza", () => expect(interpretReorganization("não apague todos os meus gastos", date).kind).toBe("clarify"));
  test("exceção nunca ignorada", () => expect(interpretReorganization("apague gastos exceto alimentação", date).kind).toBe("clarify"));
  test("anos distintos pedem esclarecimento", () => expect(interpretReorganization("apague gastos janeiro de 2025 até setembro de 2026", date).kind).toBe("clarify"));
  test("período específico e antigos não se sobrepõem implicitamente", () => expect(interpretReorganization("apague gastos antigos de outubro de 2026", date).kind).toBe("clarify"));
});
describe("confirmação e execução isolada", () => {
  test("sim nunca é código", () => expect(confirmationCode("sim")).toBeNull());
  test("confirmação transcrita inequívoca", () => expect(confirmationCode("apagar 004821")).toBe("004821"));
  test("frase aproximada não confirma", () => expect(confirmationCode("apagar quatro oito dois um")).toBeNull());
  test("expiração cinco minutos", () => expect(REORGANIZACAO_TTL_MS).toBe(300000));
  test("release permanece desligado", () => expect(WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED).toBe(false));
  test("comando composto bloqueado não cadastra receita", () => expect(blockedReorganizationReply("apague gastos anteriores e depois adicione R$ 4.500 como receita deste mês", false)).toBeTruthy());
  test("sessão pendente não cai em cadastro", () => expect(blockedReorganizationReply("limpa minhas finanças", true)).toContain("pendente"));
  const makeStore = () => {
    let code = ""; let calls = 0; let confirmed = false;
    const store: ReorganizationStore = {
      authorize: async (user, phone) => user === "A" && phone === input.phone,
      prepare: async (_, scope, income, c) => { code = c; return { status: "preview", code: c, expiresAt: "2026-11-03T22:05:00Z", scope, income, expenses: 126, incomes: 38 }; },
      confirm: async (_, c) => { if (c !== code) return { status: "wrong_code" }; if (confirmed) return { status: "replay" }; confirmed = true; calls++; return { status: "applied", expenses: 126, incomes: 38, incomeId: "new" }; },
      cancel: async () => { code = ""; return { status: "cancelled" }; },
      status: async () => ({ status: confirmed ? "applied" : "preview" }),
      restore: async () => ({ status: "restored", expenses: 126, incomes: 38, kept: 1 }),
    };
    return { store, code: () => code, calls: () => calls };
  };
  test("prévia puis confirmation et replay", async () => {
    const s = makeStore();
    await runReorganization({ ...input, text: "apague gastos e receitas anteriores e depois adicione R$ 4.500 como receita deste mês" }, s.store);
    expect(s.calls()).toBe(0);
    await runReorganization({ ...input, text: `APAGAR ${s.code()}` }, s.store);
    expect(s.calls()).toBe(1);
    await runReorganization({ ...input, text: `APAGAR ${s.code()}` }, s.store);
    expect(s.calls()).toBe(1);
  });
  test("outro usuário não chama executor", async () => {
    const s = makeStore(); await runReorganization({ ...input, userId: "B", text: "APAGAR 004821" }, s.store); expect(s.calls()).toBe(0);
  });
  test("cancelamento invalida código", async () => {
    const s = makeStore(); await runReorganization({ ...input, text: "apague todos os meus gastos" }, s.store);
    const c = s.code(); await runReorganization({ ...input, text: "cancelar a limpeza" }, s.store);
    await runReorganization({ ...input, text: `APAGAR ${c}` }, s.store); expect(s.calls()).toBe(0);
  });
  test("timeout não afirma sucesso nem rollback", async () => {
    const s = makeStore(); s.store.confirm = async () => { throw new Error("timeout"); };
    expect(await runReorganization({ ...input, text: "APAGAR 004821" }, s.store)).toContain("consultar limpeza");
  });
  test("adaptador falha fechado sem RPC", async () => {
    const store = createReorganizationStore({ rpc: async () => ({ data: null, error: { message: "missing RPC" } }) });
    expect(await store.authorize("A", input.phone)).toBe(false);
    await expect(store.confirm(input, "123456")).rejects.toThrow("missing RPC");
  });
});
describe("barreira offline (contrato candidato, não ligada)", () => {
  test("item legado aceito somente antes da primeira limpeza", () => expect(offlineWriteDecision(null, 0)).toBe("allow"));
  test("item legado após limpeza entra em revisão", () => expect(offlineWriteDecision(null, 1)).toBe("review"));
  test("nova receita na geração atual permitida", () => expect(offlineWriteDecision(2, 2)).toBe("allow"));
  test("outro dispositivo atrasado não repopula histórico", () => expect(offlineWriteDecision(1, 2)).toBe("review"));
});