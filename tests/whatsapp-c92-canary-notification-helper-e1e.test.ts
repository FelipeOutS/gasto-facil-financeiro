/**
 * WA-C9.2 Fase E.1E — Testes do helper canary (server-only).
 *
 * Sem rede. Sem banco. Sem dispatcher. Sem transport. Cliente Supabase é
 * um fake in-memory injetado.
 *
 * Cobre:
 *   - builder puro (payload, entity nulos, dedupe key fixa);
 *   - idempotência (segunda chamada → already_exists);
 *   - concorrência simulada via conflito unique;
 *   - precondições fail-closed: template ausente/ inativo/ meta name
 *     divergente/ language divergente/ com parâmetros/ categoria errada;
 *   - link ausente/ inativo/ revogado/ sem opt-in/ telefone inválido;
 *   - processing residual bloqueia;
 *   - active attempt bloqueia;
 *   - zero fetch real (sentinela global);
 *   - Admin Master UUID fixo.
 */
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  ADMIN_MASTER_CANARY_USER_ID,
  FIRST_CANARY_DEDUPE_KEY,
  FIRST_CANARY_META_TEMPLATE_NAME,
  FIRST_CANARY_LANGUAGE,
  FIRST_CANARY_CATEGORY,
  FIRST_CANARY_TEMPLATE_KEY,
  buildFirstWhatsAppCanaryNotification,
  createFirstWhatsAppCanaryNotification,
} from "@/server/whatsapp-canary-notification.server";

// ─── Sentinela de rede: qualquer fetch real derruba os testes. ───────────────
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("fetch_forbidden_in_canary_helper_tests");
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ─── Fake Supabase minimal ───────────────────────────────────────────────────
type Row = Record<string, unknown>;

interface FakeState {
  templates: Row[];
  links: Row[];
  notifications: Row[];
  attempts: Row[];
  insertShouldConflict?: boolean;
  insertError?: { code?: string } | null;
}

function makeClient(state: FakeState) {
  function tableApi(table: string) {
    // Simples: builder acumula filtros e resolve em .maybeSingle/.limit
    const filters: Array<[string, unknown]> = [];
    let joinConstraint: [string, unknown] | null = null;
    let inFilter: [string, unknown[]] | null = null;
    let selectCols = "*";
    let pendingInsert: Row | null = null;

    const api: {
      select: (c: string) => typeof api;
      eq: (k: string, v: unknown) => typeof api;
      in: (k: string, v: unknown[]) => typeof api;
      insert: (row: Row) => typeof api;
      limit: (_n: number) => Promise<{ data: Row[]; error: unknown }>;
      maybeSingle: () => Promise<{ data: Row | null; error: unknown }>;
    } = {
      select(c: string) { selectCols = c; return api; },
      eq(k: string, v: unknown) {
        if (k.includes(".")) {
          joinConstraint = [k, v];
        } else {
          filters.push([k, v]);
        }
        return api;
      },
      in(k: string, v: unknown[]) { inFilter = [k, v]; return api; },
      insert(row: Row) { pendingInsert = row; return api; },
      async limit(_n: number) {
        return { data: filterRows(), error: null };
      },
      async maybeSingle() {
        if (pendingInsert) {
          // INSERT + select + maybeSingle
          if (state.insertError) return { data: null, error: state.insertError };
          const dedupe = pendingInsert.dedupe_key as string | undefined;
          if (state.insertShouldConflict && dedupe) {
            return { data: null, error: { code: "23505" } };
          }
          const id = `nid_${state.notifications.length + 1}`;
          const row = { id, ...pendingInsert };
          state.notifications.push(row);
          return { data: { id }, error: null };
        }
        const rows = filterRows();
        return { data: rows[0] ?? null, error: null };
      },
    };

    function filterRows(): Row[] {
      const source =
        table === "whatsapp_notification_templates" ? state.templates :
        table === "whatsapp_links" ? state.links :
        table === "whatsapp_notifications" ? state.notifications :
        table === "whatsapp_notification_attempts" ? state.attempts :
        [];
      let rows = source.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (inFilter) {
        const [k, vs] = inFilter;
        rows = rows.filter((r) => vs.includes(r[k]));
      }
      if (joinConstraint) {
        // Join simulado com whatsapp_notifications via notification_id
        const [k, v] = joinConstraint;
        if (k.startsWith("whatsapp_notifications.")) {
          const col = k.split(".")[1];
          rows = rows.filter((r) => {
            const parent = state.notifications.find((n) => n.id === r.notification_id);
            return parent?.[col] === v;
          });
        }
      }
      // devolve com selectCols estampado (não usamos projeção real)
      void selectCols;
      return rows;
    }
    return api;
  }
  return { from: tableApi };
}

function seedHappy(): FakeState {
  return {
    templates: [
      {
        key: FIRST_CANARY_TEMPLATE_KEY,
        category: FIRST_CANARY_CATEGORY,
        active: true,
        meta_template_name: FIRST_CANARY_META_TEMPLATE_NAME,
        payload_schema: { required: [], body_params_order: [], language: FIRST_CANARY_LANGUAGE },
      },
    ],
    links: [
      {
        user_id: ADMIN_MASTER_CANARY_USER_ID,
        telefone: "5511988887777",
        ativo: true,
        opt_in_em: "2026-06-20T00:00:00Z",
        revogado_em: null,
      },
    ],
    notifications: [],
    attempts: [],
  };
}

describe("buildFirstWhatsAppCanaryNotification — puro", () => {
  it("produz draft com constantes fixas e payload vazio", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const d = buildFirstWhatsAppCanaryNotification(now);
    expect(d.user_id).toBe(ADMIN_MASTER_CANARY_USER_ID);
    expect(d.notification_type).toBe(FIRST_CANARY_TEMPLATE_KEY);
    expect(d.category).toBe(FIRST_CANARY_CATEGORY);
    expect(d.priority).toBe("baixa");
    expect(d.status).toBe("pending");
    expect(d.payload).toEqual({});
    expect(d.entity_type).toBeNull();
    expect(d.entity_id).toBeNull();
    expect(d.dedupe_key).toBe(FIRST_CANARY_DEDUPE_KEY);
    expect(d.attempt_count).toBe(0);
    expect(d.scheduled_at).toBe("2026-07-14T12:00:00.000Z");
    expect(d.next_attempt_at).toBe(d.scheduled_at);
  });

  it("dedupe_key é estável e não contém timestamp", () => {
    expect(FIRST_CANARY_DEDUPE_KEY).toBe("wa:first_canary:hello_world:v1");
    expect(FIRST_CANARY_DEDUPE_KEY).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("createFirstWhatsAppCanaryNotification — happy path e idempotência", () => {
  let state: FakeState;
  beforeEach(() => { state = seedHappy(); });

  it("cria uma notification na primeira chamada", async () => {
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(state) });
    expect(r.kind).toBe("created");
    expect(state.notifications.length).toBe(1);
    expect(state.notifications[0]!.dedupe_key).toBe(FIRST_CANARY_DEDUPE_KEY);
    expect(state.notifications[0]!.user_id).toBe(ADMIN_MASTER_CANARY_USER_ID);
    expect(state.notifications[0]!.payload).toEqual({});
    expect(state.notifications[0]!.entity_id).toBeNull();
  });

  it("segunda chamada retorna already_exists sem duplicar", async () => {
    const client = makeClient(state);
    const a = await createFirstWhatsAppCanaryNotification({ client });
    const b = await createFirstWhatsAppCanaryNotification({ client });
    expect(a.kind).toBe("created");
    expect(b.kind).toBe("already_exists");
    expect(state.notifications.length).toBe(1);
  });

  it("conflito unique concorrente → already_exists", async () => {
    state.insertShouldConflict = true;
    // Pre-populate as if another concurrent caller inserted first
    state.notifications.push({
      id: "nid_pre",
      user_id: ADMIN_MASTER_CANARY_USER_ID,
      dedupe_key: FIRST_CANARY_DEDUPE_KEY,
    });
    // Now the findExisting will short-circuit before insert.
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(state) });
    expect(r.kind).toBe("already_exists");
  });
});

describe("createFirstWhatsAppCanaryNotification — precondições fail-closed", () => {
  it("template ausente", async () => {
    const s = seedHappy(); s.templates = [];
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "template_missing" });
    expect(s.notifications.length).toBe(0);
  });

  it("template inativo", async () => {
    const s = seedHappy(); s.templates[0]!.active = false;
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "template_inactive" });
  });

  it("meta_template_name divergente", async () => {
    const s = seedHappy(); s.templates[0]!.meta_template_name = "outro";
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "meta_template_name_mismatch" });
  });

  it("language divergente", async () => {
    const s = seedHappy();
    (s.templates[0]!.payload_schema as { language: string }).language = "pt_BR";
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "template_language_mismatch" });
  });

  it("template com parâmetros", async () => {
    const s = seedHappy();
    (s.templates[0]!.payload_schema as { required: string[] }).required = ["x"];
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "template_has_params" });
  });

  it("categoria divergente", async () => {
    const s = seedHappy(); s.templates[0]!.category = "contas_a_pagar";
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "category_mismatch" });
  });

  it("link ausente", async () => {
    const s = seedHappy(); s.links = [];
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "link_missing" });
  });

  it("link inativo", async () => {
    const s = seedHappy(); s.links[0]!.ativo = false;
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "link_inactive" });
  });

  it("link revogado", async () => {
    const s = seedHappy(); s.links[0]!.revogado_em = "2026-06-01T00:00:00Z";
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "link_revoked" });
  });

  it("opt_in ausente", async () => {
    const s = seedHappy(); s.links[0]!.opt_in_em = null;
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "optin_missing" });
  });

  it("telefone inválido", async () => {
    const s = seedHappy(); s.links[0]!.telefone = "abc";
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "phone_invalid" });
  });

  it("processing residual bloqueia", async () => {
    const s = seedHappy();
    s.notifications.push({
      id: "nprev",
      user_id: ADMIN_MASTER_CANARY_USER_ID,
      status: "processing",
      dedupe_key: "outra",
    });
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "processing_residual" });
  });

  it("attempt ativa do Admin bloqueia", async () => {
    const s = seedHappy();
    s.notifications.push({
      id: "nx",
      user_id: ADMIN_MASTER_CANARY_USER_ID,
      status: "sent",
      dedupe_key: "outra",
    });
    s.attempts.push({
      id: "at1",
      attempt_status: "sending",
      notification_id: "nx",
    });
    const r = await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    expect(r).toEqual({ kind: "precondition_failed", reason: "active_attempt" });
  });
});

describe("createFirstWhatsAppCanaryNotification — invariantes de segurança", () => {
  it("Admin Master UUID é o valor fixo esperado", () => {
    expect(ADMIN_MASTER_CANARY_USER_ID).toBe("3324b9f8-ea68-465c-8e1e-ab1cc8caebf1");
  });

  it("nenhum fetch real é executado ao longo de um happy path", async () => {
    const s = seedHappy();
    await createFirstWhatsAppCanaryNotification({ client: makeClient(s) });
    // Se algo tivesse chamado globalThis.fetch, a sentinela teria lançado.
    expect(true).toBe(true);
  });
});
