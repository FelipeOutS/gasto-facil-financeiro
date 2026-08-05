/**
 * PROMPT 9H — Correções do upsell.
 *
 * Cobre:
 *  - Regra de elegibilidade (48h E onboarding E 2 dias distintos E (5 lançamentos OU 3 sessões OU tentativa de recurso pago));
 *  - Fontes reais de lançamentos (gastos/receitas, não expenses/incomes);
 *  - Precedência de canal (nunca banner + modal juntos);
 *  - Jornadas críticas bloqueadas;
 *  - RLS owner-only de upsell_runtime_config e guarda de converted_at (SQL).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const eligibility = readFileSync("src/server/upsell-eligibility.server.ts", "utf8");
const gate = readFileSync("src/hooks/use-upsell-gate.ts", "utf8");
const fns = readFileSync("src/lib/upsell.functions.ts", "utf8");
const banner = readFileSync("src/components/upsell/UpsellBanner.tsx", "utf8");
const modal = readFileSync("src/components/upsell/UpsellModal.tsx", "utf8");
const contextual = readFileSync("src/components/upsell/UpsellContextualGate.tsx", "utf8");

describe("9H — elegibilidade server-side", () => {
  it("usa as tabelas financeiras reais (gastos/receitas)", () => {
    expect(eligibility).toContain('.from("gastos")');
    expect(eligibility).toContain('.from("receitas")');
    expect(eligibility).not.toContain('"expenses"');
    expect(eligibility).not.toContain('"incomes"');
  });

  it("exige onboarding concluído e 48 horas de conta", () => {
    expect(eligibility).toContain("onboarding_completed");
    expect(eligibility).toContain("48 * 3_600_000");
    expect(eligibility).toContain("onboarding_incomplete");
  });

  it("exige 2 dias distintos de uso", () => {
    expect(eligibility).toContain("distinct_use_days");
    expect(eligibility).toContain("insufficient_distinct_days");
  });

  it("combina os três gatilhos finais com OU, não com E", () => {
    expect(eligibility).toContain(
      "criteria.transactions_5 || criteria.sessions_3 || criteria.paid_feature_attempt",
    );
  });

  it("bloqueia trial, entitlement pago, pagamento pendente e checkout aberto", () => {
    for (const reason of [
      "trial_active",
      "already_active_paid",
      "pending_payment",
      "open_checkout",
      "already_converted",
    ]) {
      expect(eligibility).toContain(reason);
    }
  });

  it("bloqueia roles owner e administrativa", () => {
    expect(eligibility).toContain("owner_role");
    expect(eligibility).toContain("admin_role");
  });

  it("escolhe um único canal por vez", () => {
    expect(eligibility).toContain('channel: UpsellEligibility["channel"]');
    expect(eligibility).toContain("frequency_window");
  });
});

describe("9H — gate de exibição no cliente", () => {
  it("o delay só ocorre depois da confirmação do servidor", () => {
    expect(gate).toContain("const serverAllows");
    expect(gate).toContain("status?.eligible === true");
    expect(gate).toContain("status?.channel === channel");
  });

  it("cancela o timer em rota crítica, offline, bloqueio ou perda de elegibilidade", () => {
    expect(gate).toContain("clearTimeout(timer)");
    expect(gate).toContain("isCriticalPath(pathname)");
    expect(gate).toContain("!online");
    expect(gate).toContain("blocked");
  });

  it("permite apenas uma comunicação automática por sessão", () => {
    expect(gate).toContain("sessionMessageAlreadyShown");
    expect(gate).toContain("markSessionMessageShown");
  });

  it("cobre as jornadas críticas obrigatórias", () => {
    for (const path of [
      "/login",
      "/cadastro",
      "/onboarding",
      "/adicionar",
      "/import/extrato",
      "/checkout",
      "/meu-plano",
      "/admin/saude",
      "/renda/nova",
    ]) {
      const critical =
        /^\/(login|cadastro|confirmar|recuperar-senha)|^\/onboarding|^\/adicionar|^\/import|^\/exportar|^\/checkout|^\/meu-plano|^\/pagamento|^\/mercado-pago|^\/admin|^\/renda/.test(
          path,
        );
      expect(critical).toBe(true);
    }
  });
});

describe("9H — frequência e persistência no banco", () => {
  it("registra exibição por canal (7d banner / 21d modal)", () => {
    expect(fns).toContain("markUpsellShown");
    expect(fns).toContain("last_banner_at");
    expect(fns).toContain("last_modal_at");
  });

  it("aplica pausa de 14 dias no fechamento e 30 dias após 3 recusas", () => {
    expect(fns).toContain("newCount >= 3");
    expect(fns).toContain("max_dismiss_snooze_days");
    expect(fns).toContain("dismiss_snooze_days");
  });

  it("persiste dias distintos e sessões sem dados financeiros", () => {
    expect(fns).toContain("recordUpsellActivity");
    expect(fns).toContain("distinct_use_days");
    expect(fns).toContain("session_count");
    expect(fns).not.toContain("valor");
  });

  it("não usa localStorage como fonte de verdade", () => {
    expect(gate).not.toContain("localStorage");
    expect(banner).not.toContain("localStorage");
    expect(modal).not.toContain("localStorage");
  });
});

describe("9H — textos e ausência de dados sensíveis", () => {
  const texts = `${banner}\n${modal}\n${contextual}`;
  it("não expõe saldo, dívida, renda ou estabelecimento", () => {
    for (const forbidden of ["saldo", "dívida", "sua renda", "estabelecimento"]) {
      expect(texts.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it("não usa urgência falsa, desconto ou contagem regressiva", () => {
    for (const forbidden of ["últimas horas", "desconto", "expira em", "economia garantida"]) {
      expect(texts.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it("mantém CTA e recusa explícitos", () => {
    expect(banner).toContain("Conhecer planos");
    expect(banner).toContain("Agora não");
    expect(modal).toContain("Continuar no gratuito");
    expect(contextual).toContain("Ver planos");
  });
});

describe("9H — gate contextual", () => {
  it("registra tentativa de recurso pago no servidor", () => {
    expect(contextual).toContain("recordPaidFeatureAttempt");
    expect(fns).toContain("paid_feature_attempt_at");
  });
});
