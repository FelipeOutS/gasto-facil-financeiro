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

export type ProductUsageRouteStat = {
  route: string;
  views: number;
  users: number;
  sessions: number;
  lastViewAt: string | null;
};

export type ProductUsageUserRow = {
  userId: string;
  email: string;
  nome: string | null;
  plano: string | null;
  events: number;
  pageViews: number;
  navClicks: number;
  sessions: number;
  activeDays: number;
  firstSeen: string | null;
  lastSeen: string | null;
  platforms: string[];
  routes: Array<{ route: string; views: number; lastViewAt: string | null }>;
};

export type ProductUsageReport = {
  dataStartAt: string | null;
  windowDays: number;
  totals: { events: number; sessions: number; users: number; anonymousEvents: number };
  active: { dau: number; wau: number; mau: number };
  byDay: Array<{ day: string; events: number; users: number }>;
  topRoutes: ProductUsageRouteStat[];
  bySource: Array<{ source: string; clicks: number }>;
  byEvent: Array<{ event: string; count: number }>;
  byPlatform: Array<{ platform: string; events: number }>;
  byUser: ProductUsageUserRow[];
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
    const routes = new Map<
      string,
      { views: number; users: Set<string>; sessions: Set<string>; lastViewAt: string | null }
    >();
    const sources = new Map<string, number>();
    const events = new Map<string, number>();
    const platforms = new Map<string, number>();
    let anonymousEvents = 0;

    type UserAgg = {
      events: number;
      pageViews: number;
      navClicks: number;
      sessions: Set<string>;
      days: Set<string>;
      platforms: Set<string>;
      firstSeen: string | null;
      lastSeen: string | null;
      routes: Map<string, { views: number; lastViewAt: string | null }>;
    };
    const perUser = new Map<string, UserAgg>();

    for (const r of list) {
      if (r.session_id) sessions.add(r.session_id);
      if (r.user_id) users.add(r.user_id);
      else anonymousEvents += 1;

      const day = r.occurred_at.slice(0, 10);
      const bucket = byDay.get(day) ?? { events: 0, users: new Set<string>() };
      bucket.events += 1;
      if (r.user_id) bucket.users.add(r.user_id);
      byDay.set(day, bucket);

      const isPageView = r.event_name === PRODUCT_EVENTS.pageView && Boolean(r.route);
      if (isPageView && r.route) {
        const stat =
          routes.get(r.route) ??
          ({ views: 0, users: new Set<string>(), sessions: new Set<string>(), lastViewAt: null } as {
            views: number;
            users: Set<string>;
            sessions: Set<string>;
            lastViewAt: string | null;
          });
        stat.views += 1;
        if (r.user_id) stat.users.add(r.user_id);
        if (r.session_id) stat.sessions.add(r.session_id);
        if (!stat.lastViewAt || stat.lastViewAt < r.occurred_at) stat.lastViewAt = r.occurred_at;
        routes.set(r.route, stat);
      }
      if (r.event_name === PRODUCT_EVENTS.navClick && r.source) {
        sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
      }
      events.set(r.event_name, (events.get(r.event_name) ?? 0) + 1);
      const platform = r.platform ?? "desconhecido";
      platforms.set(platform, (platforms.get(platform) ?? 0) + 1);

      if (r.user_id) {
        const agg =
          perUser.get(r.user_id) ??
          ({
            events: 0,
            pageViews: 0,
            navClicks: 0,
            sessions: new Set<string>(),
            days: new Set<string>(),
            platforms: new Set<string>(),
            firstSeen: null,
            lastSeen: null,
            routes: new Map(),
          } as UserAgg);
        agg.events += 1;
        if (isPageView) agg.pageViews += 1;
        if (r.event_name === PRODUCT_EVENTS.navClick) agg.navClicks += 1;
        if (r.session_id) agg.sessions.add(r.session_id);
        agg.days.add(day);
        agg.platforms.add(platform);
        if (!agg.firstSeen || agg.firstSeen > r.occurred_at) agg.firstSeen = r.occurred_at;
        if (!agg.lastSeen || agg.lastSeen < r.occurred_at) agg.lastSeen = r.occurred_at;
        if (isPageView && r.route) {
          const ru = agg.routes.get(r.route) ?? { views: 0, lastViewAt: null };
          ru.views += 1;
          if (!ru.lastViewAt || ru.lastViewAt < r.occurred_at) ru.lastViewAt = r.occurred_at;
          agg.routes.set(r.route, ru);
        }
        perUser.set(r.user_id, agg);
      }
    }

    // Identidade dos usuários (e-mail, nome e plano) — sem dados financeiros.
    const userIds = [...perUser.keys()];
    const emailById = new Map<string, string>();
    const nomeById = new Map<string, string | null>();
    const planoById = new Map<string, string | null>();
    if (userIds.length > 0) {
      for (let page = 1; page <= 20; page++) {
        const { data: pageData } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        const authUsers = (pageData?.users ?? []) as Array<{ id: string; email?: string | null }>;
        for (const u of authUsers) emailById.set(u.id, u.email ?? "(sem e-mail)");
        if (authUsers.length < 200) break;
      }
      const [{ data: profiles }, { data: planos }] = await Promise.all([
        admin.from("profiles").select("id, nome").in("id", userIds),
        admin.from("user_plans").select("user_id, plano").in("user_id", userIds),
      ]);
      for (const p of (profiles ?? []) as Array<{ id: string; nome: string | null }>) {
        nomeById.set(p.id, p.nome ?? null);
      }
      for (const p of (planos ?? []) as Array<{ user_id: string; plano: string | null }>) {
        planoById.set(p.user_id, p.plano ?? null);
      }
    }

    const byUser: ProductUsageUserRow[] = userIds
      .map((id) => {
        const agg = perUser.get(id)!;
        return {
          userId: id,
          email: emailById.get(id) ?? "(sem e-mail)",
          nome: nomeById.get(id) ?? null,
          plano: planoById.get(id) ?? null,
          events: agg.events,
          pageViews: agg.pageViews,
          navClicks: agg.navClicks,
          sessions: agg.sessions.size,
          activeDays: agg.days.size,
          firstSeen: agg.firstSeen,
          lastSeen: agg.lastSeen,
          platforms: [...agg.platforms],
          routes: [...agg.routes.entries()]
            .map(([route, v]) => ({ route, views: v.views, lastViewAt: v.lastViewAt }))
            .sort((a, b) => b.views - a.views),
        };
      })
      .sort((a, b) => (a.lastSeen ?? "") < (b.lastSeen ?? "") ? 1 : -1);

    const sortDesc = <T>(entries: Array<[string, number]>, map: (e: [string, number]) => T) =>
      entries.sort((a, b) => b[1] - a[1]).map(map);

    return {
      dataStartAt: (meta?.data_start_at as string | undefined) ?? null,
      windowDays,
      totals: {
        events: list.length,
        sessions: sessions.size,
        users: users.size,
        anonymousEvents,
      },
      active: {
        dau: usersIn(86_400_000),
        wau: usersIn(7 * 86_400_000),
        mau: usersIn(30 * 86_400_000),
      },
      byDay: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, v]) => ({ day, events: v.events, users: v.users.size })),
      topRoutes: [...routes.entries()]
        .map(([route, v]) => ({
          route,
          views: v.views,
          users: v.users.size,
          sessions: v.sessions.size,
          lastViewAt: v.lastViewAt,
        }))
        .sort((a, b) => b.views - a.views),
      bySource: sortDesc([...sources.entries()], ([source, clicks]) => ({ source, clicks })),
      byEvent: sortDesc([...events.entries()], ([event, count]) => ({ event, count })),
      byPlatform: sortDesc([...platforms.entries()], ([platform, evts]) => ({
        platform,
        events: evts,
      })),
      byUser,
    };
  });
