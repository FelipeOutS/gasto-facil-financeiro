/**
 * Helper central para transformar erros técnicos de bloqueio premium / RLS
 * em mensagens amigáveis para o usuário final.
 *
 * Sprint 3 — Etapa 4. NÃO altera regras de plano, RLS ou gates server-side.
 * Apenas traduz mensagens já lançadas por:
 *  - serverFns com `assertFeatureAccess` (lançam `feature_locked` / similares);
 *  - PostgreSQL/Supabase quando RLS bloqueia (`42501`,
 *    "new row violates row-level security policy", "permission denied" …);
 *  - bibliotecas que repassam essas mensagens via `Error.message`.
 *
 * Não esconde erros reais: erros de validação, rede ou desconhecidos passam
 * pelo `fallback`.
 */

import { toast } from "sonner";

export type PremiumErrorKind =
  | "feature_locked" // plano não inclui o recurso (mesmo ativo)
  | "plan_expired" // plano venceu / cancelado / sem acesso vigente
  | "plan_required" // usuário sem assinatura nenhuma
  | "permission"; // negação genérica de permissão

export type PremiumErrorInfo = {
  kind: PremiumErrorKind;
  message: string;
};

const FEATURE_LOCKED_HINTS = [
  "feature_locked",
  "feature locked",
  "upgrade_required",
  "upgrade required",
  "insufficient plan",
  "plano insuficiente",
  "plano atual não inclui",
  "recurso indisponível",
  "recurso indisponivel",
];

const PLAN_EXPIRED_HINTS = [
  "plan_expired",
  "plano expirado",
  "plano vencido",
  "subscription expired",
  "subscription_cancelled",
  "no_active_access",
];

const PLAN_REQUIRED_HINTS = [
  "plan_required",
  "premium_required",
  "subscription_required",
  "sem assinatura",
];

const PERMISSION_HINTS = [
  "42501",
  "row-level security",
  "row level security",
  "new row violates row-level security policy",
  "violates row-level security",
  "permission denied",
  "forbidden",
  "not allowed",
  "acesso negado",
];

function extractMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "";
  if (typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    // Supabase PostgrestError: { code, message, details, hint }
    const fromMessage = typeof anyErr.message === "string" ? anyErr.message : "";
    const fromError =
      typeof anyErr.error === "string"
        ? anyErr.error
        : anyErr.error && typeof (anyErr.error as { message?: unknown }).message === "string"
          ? (anyErr.error as { message: string }).message
          : "";
    const code = typeof anyErr.code === "string" ? anyErr.code : "";
    return [fromMessage, fromError, code].filter(Boolean).join(" | ");
  }
  return String(err);
}

function matches(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

/**
 * Detecta se o erro é de bloqueio premium / RLS / permissão e devolve
 * uma mensagem amigável + classificação. Retorna `null` caso o erro
 * NÃO seja de natureza premium/permissão (deixar o caller usar fallback).
 */
export function parsePremiumError(err: unknown): PremiumErrorInfo | null {
  const raw = extractMessage(err);
  if (!raw) return null;

  if (matches(raw, PLAN_EXPIRED_HINTS)) {
    return {
      kind: "plan_expired",
      message: "Seu plano expirou. Renove sua assinatura para continuar usando este recurso.",
    };
  }
  if (matches(raw, FEATURE_LOCKED_HINTS)) {
    return {
      kind: "feature_locked",
      message: "Seu plano atual não inclui este recurso. Faça upgrade para liberar.",
    };
  }
  if (matches(raw, PLAN_REQUIRED_HINTS)) {
    return {
      kind: "plan_required",
      message: "Este recurso faz parte dos planos pagos do Gasto Inteligente.",
    };
  }
  if (matches(raw, PERMISSION_HINTS)) {
    // RLS bloqueando: na prática, no nosso modelo de dados, isso quase
    // sempre significa plano sem acesso/recurso. Tratamos como premium.
    return {
      kind: "feature_locked",
      message:
        "Este recurso está disponível apenas em planos superiores. Faça upgrade para liberar.",
    };
  }
  return null;
}

/**
 * Retorna a mensagem amigável a exibir. Se for erro premium/RLS, devolve a
 * mensagem amigável; caso contrário devolve `fallback` (ou a mensagem crua
 * se nenhum fallback for informado).
 */
export function friendlyError(err: unknown, fallback?: string): string {
  const info = parsePremiumError(err);
  if (info) return info.message;
  if (fallback) return fallback;
  const raw = extractMessage(err);
  return raw || "Algo deu errado. Tente novamente em instantes.";
}

/**
 * Atalho: mostra `toast.error` com mensagem amigável. Em erros premium,
 * anexa uma ação "Ver planos" que leva o usuário para `/meu-plano`.
 */
export function toastFromError(err: unknown, fallback?: string): PremiumErrorInfo | null {
  const info = parsePremiumError(err);
  if (info) {
    toast.error(info.message, {
      duration: 7000,
      action: {
        label: "Ver planos",
        onClick: () => {
          try {
            window.location.assign("/meu-plano");
          } catch {
            /* ignore */
          }
        },
      },
    });
    return info;
  }
  toast.error(fallback || extractMessage(err) || "Algo deu errado. Tente novamente.");
  return null;
}

/** Heurística usada por chamadores que querem decidir se devem abrir o modal de upgrade. */
export function isPremiumBlock(err: unknown): boolean {
  return parsePremiumError(err) !== null;
}
