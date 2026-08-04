/**
 * WA-M1 — Memória de categoria por estabelecimento (WhatsApp).
 *
 * Aprende, de forma estritamente server-side e isolada por user_id,
 * qual categoria o usuário tende a usar para um determinado
 * "estabelecimento" (descrição normalizada). Sugere essa categoria
 * em lançamentos futuros do mesmo estabelecimento — somente quando a
 * categoria atual seria "Outros" ou de baixa confiança.
 *
 * Regras-chave:
 *   - NUNCA sobrescreve escolha manual do usuário.
 *   - NUNCA sobrescreve categoria forte por regra determinística.
 *   - NUNCA cria/consulta memória para descrições genéricas.
 *   - NUNCA registra descrição, merchant_key, categoria, valor, telefone,
 *     OCR ou transcrição nos logs.
 *   - Gravação só após gasto efetivamente salvo (`gastoId` válido).
 */

import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

export type MerchantMemorySource = "text" | "audio" | "receipt";
export type MerchantMemoryEvidence = "manual" | "confirmed";

export type MerchantMemoryDecisionReason =
  | "no_eligible_memory"
  | "manual_category_wins"
  | "high_confidence_category_wins"
  | "memory_applied"
  | "ambiguous_history"
  | "generic_description";

export type MerchantMemoryLookup = {
  categoryId: string;
  evidence: MerchantMemoryEvidence;
  manualCount: number;
  confirmedCount: number;
};

// ----- normalização --------------------------------------------------------

/** Termos genéricos: não criam nem consultam memória. */
const GENERIC_MERCHANT_TERMS: ReadonlySet<string> = new Set([
  "gasto",
  "gastos",
  "despesa",
  "despesas",
  "compra",
  "compras",
  "pagamento",
  "pagamentos",
  "pix",
  "cartao",
  "cartoes",
  "debito",
  "credito",
  "outros",
  "outro",
  "almoco",
  "jantar",
  "cafe",
  "lanche",
  "refeicao",
  "mercado",
  "supermercado",
  "uber",
  "taxi",
  "transporte", // muito amplos sozinhos
  "farmacia",
  "drogaria",
  "padaria",
  "padoca",
  "restaurante",
  "bar",
  "comida",
  "agua",
  "internet",
  "luz",
  "telefone",
]);

const MIN_KEY_LENGTH = 4;

/**
 * Gera a chave normalizada do estabelecimento a partir da descrição.
 * Retorna `null` quando a descrição é genérica/fraca demais para virar
 * memória (nesse caso o caller NÃO deve consultar nem gravar).
 */
export function merchantKeyFor(rawDescription: string | null | undefined): string | null {
  if (!rawDescription) return null;
  const cleaned = String(rawDescription)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s*]+/gu, " ") // mantém letras/números/espaço/'*'
    .replace(/\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < MIN_KEY_LENGTH) return null;

  // Rejeita se for puramente numérico, telefone-like, ou cartão-like.
  if (/^\d+$/.test(cleaned)) return null;

  // Remove tokens que parecem identificadores numéricos longos.
  const tokens = cleaned.split(" ").filter((t) => {
    if (!t) return false;
    if (/^\d{4,}$/.test(t)) return false; // números longos (cartão/identificador)
    return true;
  });
  if (tokens.length === 0) return null;

  const key = tokens.join(" ").slice(0, 200);
  if (key.length < MIN_KEY_LENGTH) return null;

  // Bloqueia se TODA a chave for um único termo genérico.
  if (tokens.length === 1 && GENERIC_MERCHANT_TERMS.has(tokens[0])) return null;

  // Bloqueia se for uma combinação curta apenas de termos genéricos.
  if (tokens.every((t) => GENERIC_MERCHANT_TERMS.has(t))) return null;

  return key;
}

// ----- log seguro ----------------------------------------------------------

export function logMerchantMemoryDecision(args: {
  source: MerchantMemorySource;
  memoryFound: boolean;
  memoryApplied: boolean;
  reason: MerchantMemoryDecisionReason;
}): void {
  // Sem PII: nada de userId real, merchant_key, descrição, categoria, valor,
  // telefone, OCR, transcript ou URLs. Apenas a decisão.
  try {
    console.log(
      JSON.stringify({
        event: "wa_merchant_memory_decision",
        source: args.source,
        memoryFound: args.memoryFound,
        memoryApplied: args.memoryApplied,
        reason: args.reason,
      }),
    );
  } catch {
    // ignore
  }
}

// ----- lookup -------------------------------------------------------------

/**
 * Busca a memória para `(userId, merchant_key)`. Retorna:
 *  - `null` quando não há memória elegível;
 *  - `{ reason: "ambiguous_history" }` quando há mais de uma categoria
 *    com força equivalente (conflito);
 *  - `{ lookup }` quando há uma única categoria elegível.
 */
export async function lookupMerchantMemory(args: {
  userId: string;
  merchantKey: string;
  activeCategoryIds: ReadonlySet<string>;
}): Promise<
  { kind: "none" } | { kind: "ambiguous" } | { kind: "eligible"; lookup: MerchantMemoryLookup }
> {
  if (!args.userId || !args.merchantKey) return { kind: "none" };

  const { data, error } = await supabaseAdmin
    .from("whatsapp_merchant_category_memories")
    .select("category_id, confirmed_count, manual_confirmed_count")
    .eq("user_id", args.userId)
    .eq("merchant_key", args.merchantKey);

  if (error || !data || data.length === 0) return { kind: "none" };

  // Filtra apenas categorias ativas do usuário (categoria inativa/inexistente é ignorada).
  type Row = { category_id: string; confirmed_count: number; manual_confirmed_count: number };
  const rows: Row[] = (data as Row[]).filter((r) => args.activeCategoryIds.has(r.category_id));
  if (rows.length === 0) return { kind: "none" };

  // Classifica elegibilidade: 1 manual OU 2 confirmed.
  const eligible = rows
    .map((r) => ({
      row: r,
      eligible: r.manual_confirmed_count >= 1 || r.confirmed_count >= 2,
    }))
    .filter((x) => x.eligible)
    .map((x) => x.row);

  if (eligible.length === 0) return { kind: "none" };
  if (eligible.length > 1) return { kind: "ambiguous" };

  const r = eligible[0];
  const evidence: MerchantMemoryEvidence = r.manual_confirmed_count >= 1 ? "manual" : "confirmed";

  return {
    kind: "eligible",
    lookup: {
      categoryId: r.category_id,
      evidence,
      manualCount: r.manual_confirmed_count,
      confirmedCount: r.confirmed_count,
    },
  };
}

// ----- write -------------------------------------------------------------

/**
 * Registra (upsert) uma memória após o gasto ter sido salvo com sucesso.
 * Idempotente por `(user_id, merchant_key, category_id)`.
 *
 * - `evidence="manual"`: usuário escolheu/alterou a categoria explicitamente.
 * - `evidence="confirmed"`: usuário apenas confirmou a sugestão do sistema.
 *
 * NÃO grava se faltar qualquer chave obrigatória (gasto sem categoria etc.).
 */
export async function recordMerchantMemory(args: {
  userId: string;
  merchantKey: string;
  categoryId: string;
  evidence: MerchantMemoryEvidence;
}): Promise<{ ok: boolean }> {
  if (!args.userId || !args.merchantKey || !args.categoryId) return { ok: false };

  // Lê existente para incrementar contadores manualmente (upsert nativo
  // não permite expressão para colunas). Conflitos de chave única são
  // tratados via select-then-(insert ou update).
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_merchant_category_memories")
    .select("id, confirmed_count, manual_confirmed_count")
    .eq("user_id", args.userId)
    .eq("merchant_key", args.merchantKey)
    .eq("category_id", args.categoryId)
    .maybeSingle();

  const incManual = args.evidence === "manual" ? 1 : 0;
  const incConfirmed = 1;

  if (existing && (existing as { id?: string }).id) {
    const row = existing as { id: string; confirmed_count: number; manual_confirmed_count: number };
    const { error } = await supabaseAdmin
      .from("whatsapp_merchant_category_memories")
      .update({
        confirmed_count: (row.confirmed_count ?? 0) + incConfirmed,
        manual_confirmed_count: (row.manual_confirmed_count ?? 0) + incManual,
        last_confirmed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: !error };
  }

  const { error } = await supabaseAdmin.from("whatsapp_merchant_category_memories").insert({
    user_id: args.userId,
    merchant_key: args.merchantKey,
    category_id: args.categoryId,
    confirmed_count: incConfirmed,
    manual_confirmed_count: incManual,
    last_confirmed_at: new Date().toISOString(),
  });
  return { ok: !error };
}

// ----- frase exibida na prévia --------------------------------------------

export const MERCHANT_MEMORY_HINT_LINE =
  "Sugestão baseada em lançamentos confirmados anteriormente.";
