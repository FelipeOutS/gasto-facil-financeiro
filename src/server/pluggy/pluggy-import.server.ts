/**
 * Fase 3 — Executor da importação Pluggy → Gastos/Receitas (dependências injetadas).
 *
 * TRAVADO: `PLUGGY_IMPORT_RELEASE_AUTHORIZED = false`. Enquanto falso, apenas a
 * PRÉVIA (dry-run) roda; nenhuma gravação nas tabelas financeiras é tentada.
 * A gravação só acontece pela RPC transacional `pluggy_import_apply` (candidata,
 * ainda não aplicada) — nunca por INSERT/UPDATE em loop no cliente.
 */
import { isPluggyAllowed } from "@/lib/pluggy/rules";
import { planImport, summarizePlan, type CardLink, type ExistingEntry, type ImportedEntry, type PlanAction, type PlanTx, type UserCategoria } from "@/lib/pluggy/import-plan";

export const PLUGGY_IMPORT_RELEASE_AUTHORIZED = false as const;

export type ImportDeps = {
  roles(userId: string): Promise<string[]>;
  settings(userId: string): Promise<{ auto_import: boolean } | null>;
  txs(userId: string): Promise<PlanTx[]>;
  cardLinks(userId: string): Promise<CardLink[]>;
  categorias(userId: string): Promise<UserCategoria[]>;
  imported(userId: string): Promise<ImportedEntry[]>;
  existing(userId: string, from: string, to: string): Promise<ExistingEntry[]>;
  apply(userId: string, batchId: string, actions: PlanAction[]): Promise<Record<string, unknown>>;
  revert(userId: string, batchId: string): Promise<Record<string, unknown>>;
};

export type ImportMode = "previa" | "historico_inicial" | "incremental";

export async function runPluggyImport(
  deps: ImportDeps,
  input: { userId: string; batchId: string; mode: ImportMode; confirmed?: boolean; releaseAuthorized?: boolean },
) {
  const roles = await deps.roles(input.userId);
  if (!isPluggyAllowed(input.userId, roles)) return { ok: false as const, error: "pluggy_nao_autorizado" };
  const txs = await deps.txs(input.userId);
  const dates = txs.map((t) => t.date).sort();
  const [cardLinks, categorias, imported, existing] = await Promise.all([
    deps.cardLinks(input.userId),
    deps.categorias(input.userId),
    deps.imported(input.userId),
    dates.length ? deps.existing(input.userId, dates[0], dates[dates.length - 1]) : Promise.resolve([]),
  ]);
  const actions = planImport({ userId: input.userId, txs, cardLinks, categorias, imported, existing });
  const resumo = summarizePlan(actions);
  if (input.mode === "previa") return { ok: true as const, previa: true, resumo, actions };

  const released = input.releaseAuthorized ?? PLUGGY_IMPORT_RELEASE_AUTHORIZED;
  if (!released) return { ok: false as const, error: "importacao_bloqueada", resumo };
  if (input.mode === "historico_inicial" && !input.confirmed) return { ok: false as const, error: "confirmacao_obrigatoria", resumo };
  if (input.mode === "incremental") {
    const s = await deps.settings(input.userId);
    if (!s?.auto_import) return { ok: false as const, error: "importacao_automatica_desativada", resumo };
  }
  const writes = actions.filter((a) => a.op === "insert" || a.op === "update" || a.op === "remove");
  if (!writes.length) return { ok: true as const, previa: false, resumo, resultado: { gastos: 0, receitas: 0 } };
  const resultado = await deps.apply(input.userId, input.batchId, writes);
  return { ok: true as const, previa: false, resumo, resultado };
}

export async function revertPluggyImport(deps: ImportDeps, input: { userId: string; batchId: string; releaseAuthorized?: boolean }) {
  const roles = await deps.roles(input.userId);
  if (!isPluggyAllowed(input.userId, roles)) return { ok: false as const, error: "pluggy_nao_autorizado" };
  if (!(input.releaseAuthorized ?? PLUGGY_IMPORT_RELEASE_AUTHORIZED)) return { ok: false as const, error: "importacao_bloqueada" };
  return { ok: true as const, resultado: await deps.revert(input.userId, input.batchId) };
}

/** Invoked after staging sync/deletions. In this phase returns before any financial read or RPC. */
export async function runIncrementalAfterSync(userId: string) {
  if (!PLUGGY_IMPORT_RELEASE_AUTHORIZED) return { ok: true as const, blocked: true };
  const { assertPluggyAccess } = await import("./pluggy-access.server");
  await assertPluggyAccess(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createImportDeps } = await import("./pluggy-import-store.server");
  const deps = createImportDeps(supabaseAdmin);
  if (!(await deps.settings(userId))?.auto_import) return { ok: true as const, disabled: true };
  const result = await runPluggyImport(deps, { userId, batchId: crypto.randomUUID(), mode: "incremental" });
  if (!result.ok) throw new Error(result.error);
  return result;
}
