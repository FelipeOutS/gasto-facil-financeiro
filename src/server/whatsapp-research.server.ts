/** Optional no-paid-API WhatsApp research. Financial tables are only read for budget simulation. */
import { createHash } from "node:crypto";
import { supabaseAdmin as _admin } from "@/integrations/supabase/client.server";
import { getWhatsAppEntitlement } from "./whatsapp-entitlement.server";
import { checkRateLimit } from "./rate-limit.server";
import { budgetComparison, detectResearchIntent, type ResearchContext, type ResearchProduct } from "./whatsapp-research-core";
import { runResearchMvp } from "./whatsapp-research-mvp";
import { wikimediaSource, type WikimediaSource } from "./whatsapp-wikimedia.server";

// Migration is local and its types have not yet been generated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _admin as any;
const UNAVAILABLE = "Não consegui fazer essa pesquisa agora. Tente novamente em alguns minutos.";
const CONTEXT_MINUTES = 20;
const MAX_REPLY = 3000;
type Claim = { claim_state: "claimed" | "completed" | "pending" | "failed" | "quota" | "global_quota"; request_id: string | null; previous_response: string | null };

function quota(raw: string | undefined, fallback: number, maximum: number): number | null {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : null;
}

async function latestContext(userId: string, phoneHash: string): Promise<ResearchContext | null> {
  const { data, error } = await db.from("whatsapp_research_requests")
    .select("context, context_expires_at").eq("user_id", userId).eq("phone_hash", phoneHash)
    .eq("state", "completed").gt("context_expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("research_context_unavailable");
  const raw = data?.context;
  if (!raw || !Array.isArray(raw.products) || typeof raw.researchedAt !== "string") return null;
  const products: ResearchProduct[] = raw.products.slice(0, 3).filter((p: unknown): p is Record<string, unknown> =>
    !!p && typeof p === "object" && typeof (p as Record<string, unknown>).name === "string" &&
    ((p as Record<string, unknown>).name as string).length <= 100).map((p: Record<string, unknown>) => {
    const hasUserPrice = p.priceOrigin === "USER_PROVIDED" && Number.isSafeInteger(p.priceCents) && Number(p.priceCents) > 0;
    return {
      name: p.name as string, priceCents: hasUserPrice ? p.priceCents as number : null,
      priceOrigin: hasUserPrice ? "USER_PROVIDED" : null,
      sourceUrl: typeof p.sourceUrl === "string" && p.sourceUrl.startsWith("https://pt.wikipedia.org/wiki/") ? p.sourceUrl : null,
      summary: typeof p.summary === "string" ? p.summary.slice(0, 560) : null,
    };
  });
  return products.length ? { products, researchedAt: raw.researchedAt } : null;
}

async function budgetReadOnly(userId: string, priceCents: number): Promise<string> {
  const now = new Date();
  const [month, year] = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "numeric", year: "numeric" }).format(now).split("/").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const { data: limits, error: limitError } = await db.from("limites").select("tipo, valor")
    .eq("user_id", userId).eq("mes", month).eq("ano", year);
  if (limitError) throw new Error("budget_unavailable");
  const totals = Array.isArray(limits) ? limits.filter(row => String(row.tipo ?? "").trim().toLowerCase() === "total") : [];
  if (totals.length !== 1 || !(Number(totals[0].valor) > 0))
    return "Não há um orçamento total configurado para este mês. Não consigo avaliar essa compra pelos dados registrados.";
  let spentCents = 0;
  for (let start = 0; start < 10000; start += 500) {
    const { data, error } = await db.from("gastos").select("valor").eq("user_id", userId)
      .gte("data", from).lt("data", to).range(start, start + 499);
    if (error || !Array.isArray(data)) throw new Error("budget_unavailable");
    for (const row of data) spentCents += Math.round(Number(row.valor ?? 0) * 100);
    if (data.length < 500) break;
    if (start === 9500) throw new Error("budget_too_many_rows");
  }
  return budgetComparison(Math.round(Number(totals[0].valor) * 100), spentCents, priceCents);
}

export async function handleWhatsAppResearch(input: {
  userId: string; phone: string; externalId: string | null; text: string; wikimedia?: WikimediaSource;
}): Promise<{ resposta: string; graphInteractive?: Record<string, unknown> } | null> {
  const { userId, externalId, text } = input;
  const directIntent = detectResearchIntent(text, false);
  const possibleFollowup = detectResearchIntent(text, true) === "followup";
  if (!directIntent && !possibleFollowup) return null;
  // The switch stays off until full homologation. A paid API key cannot activate this flow.
  if (process.env.WHATSAPP_RESEARCH_ENABLED !== "true")
    return directIntent ? { resposta: "A pesquisa inteligente está em preparação. Os comandos financeiros continuam disponíveis." } : null;
  if (!externalId) return { resposta: UNAVAILABLE };
  const phoneHash = createHash("sha256").update(input.phone.replace(/\D/g, "")).digest("hex");
  let context: ResearchContext | null;
  try { context = await latestContext(userId, phoneHash); }
  catch { return directIntent ? { resposta: UNAVAILABLE } : null; }
  const intent = detectResearchIntent(text, !!context);
  if (!intent) return null;
  const entitlement = await getWhatsAppEntitlement(userId);
  if (!entitlement.allowed) return { resposta: "A pesquisa inteligente não está disponível para sua conta. Os comandos financeiros continuam disponíveis." };
  const monthly = quota(process.env.WHATSAPP_RESEARCH_MONTHLY_LIMIT, 300, 1000);
  const global = quota(process.env.WHATSAPP_RESEARCH_GLOBAL_MONTHLY_LIMIT, 20_000, 1_000_000);
  if (!monthly || !global) return { resposta: UNAVAILABLE };
  const { data: claimData, error: claimError } = await db.rpc("whatsapp_claim_research", {
    p_user_id: userId, p_phone_hash: phoneHash, p_external_id: externalId, p_intent: intent,
    p_monthly_limit: monthly, p_global_monthly_limit: global,
  });
  if (claimError) return { resposta: UNAVAILABLE };
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as Claim | null;
  if (!claim) return { resposta: UNAVAILABLE };
  if (claim.claim_state === "quota") return { resposta: "Você chegou ao limite de pesquisas deste mês. Os comandos financeiros continuam disponíveis." };
  if (claim.claim_state === "global_quota") return { resposta: "A pesquisa está pausada por enquanto. Os comandos financeiros continuam disponíveis." };
  if (claim.claim_state !== "claimed") return { resposta: claim.previous_response || "Essa pesquisa já foi recebida. Envie uma nova mensagem se quiser tentar outra vez." };

  const started = Date.now();
  let response = UNAVAILABLE;
  let successful = false;
  let nextContext: ResearchContext | null = null;
  let lookups = 0;
  try {
    const rate = await checkRateLimit({ key: `whatsapp_research_free:${userId}`, route: "whatsapp_research_free",
      user_id: userId, method: "POST", limit: 20, windowSeconds: 3600 });
    if (rate.blocked || rate.dbError) { response = "Muitas pesquisas em pouco tempo. Tente novamente mais tarde."; successful = true; }
    else {
      const result = await runResearchMvp({ text, context, source: input.wikimedia ?? wikimediaSource,
        budget: cents => budgetReadOnly(userId, cents), signal: AbortSignal.timeout(8000) });
      if (result) {
        response = result.reply.slice(0, MAX_REPLY);
        // Um follow-up pode responder sem alterar o preço; ainda assim precisa
        // manter o produto para a próxima mensagem dentro do TTL.
        nextContext = result.context;
        lookups = result.lookups;
        successful = true;
      }
    }
  } catch { response = UNAVAILABLE; }
  const { error: saveError } = await db.from("whatsapp_research_requests").update({
    state: successful ? "completed" : "failed", response_text: response,
    context: successful ? nextContext : null,
    context_expires_at: successful && nextContext ? new Date(Date.now() + CONTEXT_MINUTES * 60_000).toISOString() : null,
    provider_request_id: null, search_calls: lookups, input_tokens: 0, output_tokens: 0,
    latency_ms: Date.now() - started, completed_at: new Date().toISOString(),
  }).eq("id", claim.request_id).eq("user_id", userId).eq("state", "pending");
  return saveError ? { resposta: UNAVAILABLE } : { resposta: response };
}
