import { useState, useCallback } from "react";
import type { FeatureKey } from "@/lib/plans";

/**
 * Etapa 23 — Helpers para detectar e tratar erros 403 de plano
 * vindos das APIs premium (import-extrato, import-fatura-*, import-conta-*,
 * ocr-gasto, import-investimentos). Mantém erros técnicos reais (parser,
 * arquivo inválido, 500, timeout) fora do fluxo de upgrade.
 */

export type PremiumApiErrorPayload = {
  error?: string;
  code?: string;
  feature?: string;
  requiredPlan?: string | null;
  message?: string;
};

/** Códigos que o servidor usa em `forbiddenResponse` enriquecido. */
const PREMIUM_ERROR_CODE = "PREMIUM_FEATURE_REQUIRED";

/**
 * Retorna `true` apenas quando o payload sinaliza explicitamente bloqueio
 * por plano. Não consideramos qualquer 403 como premium para não confundir
 * com auth/permissão real.
 */
export function isPremiumApiError(
  payload: unknown,
  status?: number,
): payload is PremiumApiErrorPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.code === PREMIUM_ERROR_CODE) return true;
  // Heurística de transição: 403 + error "forbidden" + mensagem contendo "plano"
  // — cobre endpoints legados que ainda não foram migrados, sem capturar
  // erros 403 de auth (que normalmente trazem outras chaves/textos).
  if (
    status === 403 &&
    typeof p.error === "string" &&
    p.error === "forbidden" &&
    typeof p.message === "string" &&
    /plano|premium|recurso/i.test(p.message)
  ) {
    return true;
  }
  return false;
}

/** Mapeia o nome textual da feature recebida do servidor para FeatureKey. */
export function featureFromPayload(
  payload: PremiumApiErrorPayload | null | undefined,
): FeatureKey | null {
  const f = payload?.feature;
  if (!f || typeof f !== "string") return null;
  // Lista das features permitidas em `ensurePremiumFeatureAccess`.
  const allowed: FeatureKey[] = [
    "importacoes",
    "importar_extrato",
    "importar_fatura",
    "importar_conta",
    "investimentos",
  ];
  return (allowed as string[]).includes(f) ? (f as FeatureKey) : null;
}

export type PremiumGateState = {
  open: boolean;
  feature: FeatureKey | null;
  title: string;
  description: string;
};

const EMPTY_STATE: PremiumGateState = {
  open: false,
  feature: null,
  title: "",
  description: "",
};

/**
 * Hook utilitário para uploads premium: chame `handleResponse(resp, jsonBody, { title, description, fallbackFeature })`
 * logo após `await resp.json()`. Se for erro premium, abre o modal e retorna
 * `true` — o caller deve então `return` sem disparar toast de erro genérico.
 * Para qualquer outro erro, retorna `false` e o caller mantém seu tratamento.
 */
export function usePremiumApiGate() {
  const [state, setState] = useState<PremiumGateState>(EMPTY_STATE);

  const handleResponse = useCallback(
    (
      resp: { ok: boolean; status: number },
      body: unknown,
      opts: { title: string; description: string; fallbackFeature?: FeatureKey },
    ): boolean => {
      if (resp.ok) return false;
      if (!isPremiumApiError(body, resp.status)) return false;
      const payload = body as PremiumApiErrorPayload;
      const feature = featureFromPayload(payload) ?? opts.fallbackFeature ?? null;
      setState({
        open: true,
        feature,
        title: opts.title,
        description: opts.description,
      });
      return true;
    },
    [],
  );

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  return { state, handleResponse, close };
}
