/**
 * WA-C11 FASE 4B.2.a — Mapeamento fechado (allowlist) evento interno → template Meta.
 *
 * SERVER-ONLY. Nunca aceitar nome Meta vindo do client, da notification, ou
 * de qualquer camada não-servidora. Este módulo é a fonte única de verdade
 * da correlação evento → template aprovado.
 *
 * Regra: apenas os três eventos abaixo são elegíveis nesta fase. Qualquer
 * outra chave (fatura, metas, mercado, orçamento, IA, canary, hello_world,
 * pending, recorrente, etc.) é bloqueada com `not_allowed`.
 */

export type AllowedNotificationKey =
  | "gi_conta_vencendo_hoje"
  | "gi_conta_vencendo_amanha"
  | "gi_conta_atrasada";

export type AllowedMetaName =
  | "gi_conta_vencendo_hoje_v1"
  | "gi_conta_vencendo_amanha_v1"
  | "gi_conta_atrasada_v1";

interface MappingEntry {
  readonly notificationKey: AllowedNotificationKey;
  readonly metaName: AllowedMetaName;
  readonly language: "pt_BR";
  readonly category: "UTILITY";
  readonly version: 1;
}

const ALLOWLIST: Readonly<Record<AllowedNotificationKey, MappingEntry>> = Object.freeze({
  gi_conta_vencendo_hoje: {
    notificationKey: "gi_conta_vencendo_hoje",
    metaName: "gi_conta_vencendo_hoje_v1",
    language: "pt_BR",
    category: "UTILITY",
    version: 1,
  },
  gi_conta_vencendo_amanha: {
    notificationKey: "gi_conta_vencendo_amanha",
    metaName: "gi_conta_vencendo_amanha_v1",
    language: "pt_BR",
    category: "UTILITY",
    version: 1,
  },
  gi_conta_atrasada: {
    notificationKey: "gi_conta_atrasada",
    metaName: "gi_conta_atrasada_v1",
    language: "pt_BR",
    category: "UTILITY",
    version: 1,
  },
});

export type MappingLookupResult =
  | { ok: true; entry: MappingEntry }
  | { ok: false; reason: "not_allowed" };

export function resolveAllowedMapping(notificationKey: unknown): MappingLookupResult {
  if (typeof notificationKey !== "string") return { ok: false, reason: "not_allowed" };
  const entry = (ALLOWLIST as Record<string, MappingEntry | undefined>)[notificationKey];
  if (!entry) return { ok: false, reason: "not_allowed" };
  return { ok: true, entry };
}

export function isAllowedNotificationKey(k: unknown): k is AllowedNotificationKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(ALLOWLIST, k);
}

export function isAllowedMetaName(n: unknown): n is AllowedMetaName {
  if (typeof n !== "string") return false;
  for (const e of Object.values(ALLOWLIST)) if (e.metaName === n) return true;
  return false;
}

export function listAllowedEntries(): ReadonlyArray<MappingEntry> {
  return Object.freeze(Object.values(ALLOWLIST).slice());
}
