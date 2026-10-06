import { beforeEach, expect, mock, test } from "bun:test";

const state = {
  spent: 79,
  optedIn: true,
  budgetEnabled: true,
  sentKeys: new Set<string>(),
  scheduled: [] as Date[],
};

const rows = (table: string) => {
  switch (table) {
    case "limites": return [{ id: "limit-1", tipo: "total", valor: 100 }];
    case "gastos": return [{ id: "expense-1", valor: state.spent, confirmado: true, categoria_id: null }];
    case "receitas": return [{ id: "income-1", valor: 200 }];
    case "categorias": return [];
    case "recorrencias": return [{ id: "subscription-1", proxima_cobranca: "2026-06-02", valor: 39.9, moeda: "BRL" }];
    case "metas_financeiras": return [{ id: "goal-1", valor_atual: 100, valor_objetivo: 100, updated_at: "2026-06-01T00:00:00Z" }];
    case "dinheiro_guardado":
    case "movimentacoes_meta": return [];
    default: return [];
  }
};

function query(table: string) {
  const result = { data: rows(table), error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lt: () => chain,
    is: () => chain,
    order: () => chain,
    range: () => chain,
    maybeSingle: async () => table === "whatsapp_notification_templates"
      ? { data: { active: true, meta_template_name: "approved_test_template" }, error: null }
      : { data: null, error: null },
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: query },
}));
mock.module("@/server/whatsapp-notification-gates.server", () => ({
  getUserTimezone: async () => "UTC",
  getPreferences: async () => ({
    orcamento: state.budgetEnabled,
    faturas: true,
    renovacao_assinatura: true,
    metas: true,
    resumo_semanal: true,
    resumo_mensal: true,
  }),
  isChannelOptedIn: async () => ({ ok: state.optedIn }),
}));
mock.module("@/server/whatsapp-c11-gates.server", () => ({
  canCreateNotificationForUser: async () => ({ allowed: true }),
}));
mock.module("@/server/cartao-fatura.server", () => ({
  loadCartoesDoUsuario: async () => [{ id: "card-1" }],
  getFaturaPorMes: async (_userId: string, _card: unknown, month: string) => month === "2026-06"
    ? { total: 300, vencimento: new Date("2026-06-04T12:00:00Z"), competencia: month, anoRef: 2026, mesRef: 6 }
    : null,
}));
mock.module("@/server/whatsapp-meta-template-mapping.server", () => ({
  resolveAllowedMapping: () => ({ ok: true }),
}));
mock.module("@/server/whatsapp-notifications.server", () => ({
  enqueueNotification: async ({ dedupeKey, scheduledAt }: { dedupeKey: string; scheduledAt: Date }) => {
    if (state.sentKeys.has(dedupeKey)) return null;
    state.sentKeys.add(dedupeKey);
    state.scheduled.push(scheduledAt);
    return { id: dedupeKey };
  },
}));

const { collectProactiveCandidates, generateProactiveAlerts } = await import("../src/server/whatsapp-proactive-alerts.server");
const now = new Date("2026-06-01T03:00:00Z"); // primeiro dia do mês e segunda-feira

beforeEach(() => {
  state.spent = 79;
  state.optedIn = true;
  state.budgetEnabled = true;
  state.sentKeys.clear();
  state.scheduled.length = 0;
});

test("preferências e candidatos cobrem orçamento, fatura, assinatura, meta e resumos", async () => {
  state.spent = 80;
  const candidates = await collectProactiveCandidates("user-1", now);
  expect(candidates.map(c => c.type).sort()).toEqual([
    "gi_assinatura_renovacao", "gi_fatura_proxima", "gi_meta_atingida",
    "gi_orcamento_limiar", "gi_resumo_mensal", "gi_resumo_semanal",
  ].sort());
  expect(candidates.find(c => c.category === "orcamento")?.dedupeKey).toBe("wa13:budget:limit-1:2026-06:80");
  state.budgetEnabled = false;
  expect((await collectProactiveCandidates("user-1", now)).some(c => c.category === "orcamento")).toBe(false);
});

test("79→80→85→90→100 enfileira cada limiar uma vez, com opt-out e horário seguro", async () => {
  state.optedIn = false;
  expect(await generateProactiveAlerts("user-1", now)).toEqual({ candidates: 0, enqueued: 0 });
  expect(state.sentKeys.size).toBe(0);
  state.optedIn = true;
  const newlyEnqueued: number[] = [];
  for (const used of [79, 80, 85, 90, 100]) {
    state.spent = used;
    const before = [...state.sentKeys].filter(key => key.startsWith("wa13:budget:")).length;
    await generateProactiveAlerts("user-1", now);
    const after = [...state.sentKeys].filter(key => key.startsWith("wa13:budget:")).length;
    newlyEnqueued.push(after - before);
  }
  expect(newlyEnqueued).toEqual([0, 1, 0, 1, 1]);
  expect([...state.sentKeys].filter(key => key.startsWith("wa13:budget:")).sort()).toEqual([
    "wa13:budget:limit-1:2026-06:100",
    "wa13:budget:limit-1:2026-06:80",
    "wa13:budget:limit-1:2026-06:90",
  ]);
  expect(state.scheduled.every(date => date.toISOString() === "2026-06-01T09:00:00.000Z")).toBe(true);
});
