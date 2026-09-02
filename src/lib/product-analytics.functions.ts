/**
 * Fase 2 — ingestão e agregação dos eventos de produto.
 *
 * - Ingestão: valida estritamente o payload, descarta chaves sensíveis e grava
 *   com o cliente privilegiado (a tabela é fechada para usuários do app).
 * - Agregação: somente Admin Master; devolve apenas números agregados.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PRODUCT_EVENTS, isDeniedKey } from "./product-analytics";

const EVENT_NAMES = Object.values(PRODUCT_EVENTS) as [string, ...string[]];

const safeScalar = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

const eventSchema = z.object({
  event_name: z.enum(EVENT_NAMES),
  route: z.string().max(200),
  prev_route: z.string().max(200).nullable().optional(),
  source: z.string().max(32).nullable().optional(),
  target: z.string().max(64).nullable().optional(),
  session_id: z.string().max(64),
  platform: z.string().max(24),
  build_id: z.string().max(64),
  props: z.record(z.string(), safeScalar).optional(),
});

const ingestSchema = z.object({ events: z.array(eventSchema).min(1).max(25) });

function stripDeniedKeys(
  props: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (isDeniedKey(key)) continue;
    out[key] = value;
  }
  return out;
}

async function resolveOptionalUserId(): Promise<string | null> {
  try {
    const header = getRequestHeader("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length);
    if (!token) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await client.auth.getClaims(token);
    const sub = data?.claims?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

export const ingestProductEvents = createServerFn({ method: "POST" })
  .inputValidator((input) => ingestSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } = await import(
      "@/server/rate-limit.server"
    );
    const { getRequest } = await import("@tanstack/react-start/server");

    const userId = await resolveOptionalUserId();
    let ip: string | null = null;
    try {
      const request = getRequest();
      ip = request ? getClientIp(request) : null;
    } catch {
      ip = null;
    }

    const limit = await checkRateLimit({
      key: `product_analytics:${userId ?? ip ?? "anon"}`,
      route: "product-analytics/ingest",
      user_id: userId,
      ip_address: ip,
      limit: 240,
      windowSeconds: RATE_LIMIT_PRESETS.publicApi.windowSeconds,
    });
    if (limit.blocked) return { ok: false, inserted: 0 };

    const rows = data.events.map((e) => ({
      event_name: e.event_name,
      route: e.route,
      prev_route: e.prev_route ?? null,
      source: e.source ?? null,
      target: e.target ?? null,
      user_id: userId,
      session_id: e.session_id,
      platform: e.platform,
      build_id: e.build_id,
      props: stripDeniedKeys(e.props),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any).from("product_analytics_events").insert(rows);
    if (error) {
      console.error("[product_analytics_ingest]", error.message);
      return { ok: false, inserted: 0 };
    }
    return { ok: true, inserted: rows.length };
  });

/* ------------------------------------------------------------ agregação */

export type ProductUsageReport = {
  dataStartAt: string | null;
  windowDays: number;
  totals: { events: number; sessions: number; users: number };
  active: { dau: number; wau: number; mau: number };
  byDay: Array<{ day: string; events: number; users: number }>;
  topRoutes: Array<{ route: string; views: number }>;
  bySource: Array<{ source: string; clicks: number }>;
  byEvent: Array<{ event: string; count: number }>;
  byPlatform: Array<{ platform: string; events: number }>;
};

type RawRow = {
  occurred_at: string;
  event_name: string;
  route: string | null;
  source: string | null;
  user_id: string | null;
  session_id: string | null;
  platform: string | null;
};

export const getProductUsageReport = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({ days: z.number().int().min(1).max(90).optional() })
      .optional()
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ProductUsageReport> => {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    const allowed = await hasAdminMasterRole(context.userId);
    if (!allowed) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const windowDays = data?.days ?? 30;
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;

    const [{ data: meta }, { data: rows }] = await Promise.all([
      admin.from("product_analytics_meta").select("data_start_at").eq("id", 1).maybeSingle(),
      admin
        .from("product_analytics_events")
        .select("occurred_at,event_name,route,source,user_id,session_id,platform")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(50_000),
    ]);

    const list: RawRow[] = (rows ?? []) as RawRow[];
    const now = Date.now();
    const usersIn = (windowMs: number) => {
      const set = new Set<string>();
      for (const r of list) {
        if (!r.user_id) continue;
        if (now - new Date(r.occurred_at).getTime() <= windowMs) set.add(r.user_id);
      }
      return set.size;
    };

    const sessions = new Set<string>();
    const users = new Set<string>();
    const byDay = new Map<string, { events: number; users: Set<string> }>();
    const routes = new Map<string, number>();
    const sources = new Map<string, number>();
    const events = new Map<string, number>();
    const platforms = new Map<string, number>();

    for (const r of list) {
      if (r.session_id) sessions.add(r.session_id);
      if (r.user_id) users.add(r.user_id);

      const day = r.occurred_at.slice(0, 10);
      const bucket = byDay.get(day) ?? { events: 0, users: new Set<string>() };
      bucket.events += 1;
      if (r.user_id) bucket.users.add(r.user_id);
      byDay.set(day, bucket);

      if (r.event_name === PRODUCT_EVENTS.pageView && r.route) {
        routes.set(r.route, (routes.get(r.route) ?? 0) + 1);
      }
      if (r.event_name === PRODUCT_EVENTS.navClick && r.source) {
        sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
      }
      events.set(r.event_name, (events.get(r.event_name) ?? 0) + 1);
      const platform = r.platform ?? "desconhecido";
      platforms.set(platform, (platforms.get(platform) ?? 0) + 1);
    }

    const sortDesc = <T>(entries: Array<[string, number]>, map: (e: [string, number]) => T) =>
      entries.sort((a, b) => b[1] - a[1]).map(map);

    return {
      dataStartAt: (meta?.data_start_at as string | undefined) ?? null,
      windowDays,
      totals: { events: list.length, sessions: sessions.size, users: users.size },
      active: {
        dau: usersIn(86_400_000),
        wau: usersIn(7 * 86_400_000),
        mau: usersIn(30 * 86_400_000),
      },
      byDay: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, v]) => ({ day, events: v.events, users: v.users.size })),
      topRoutes: sortDesc([...routes.entries()], ([route, views]) => ({ route, views })).slice(0, 20),
      bySource: sortDesc([...sources.entries()], ([source, clicks]) => ({ source, clicks })),
      byEvent: sortDesc([...events.entries()], ([event, count]) => ({ event, count })),
      byPlatform: sortDesc([...platforms.entries()], ([platform, evts]) => ({
        platform,
        events: evts,
      })),
    };
  });
