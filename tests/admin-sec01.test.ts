import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const userId = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const adminSource = readFileSync("src/lib/admin.functions.ts", "utf8");
const legacyEmail = adminSource.match(/callerEmail !== "([^"]+)"/)![1];
let owner = true, identity = true, identityError = false, roleError = false, roleThrows = false;
let roleValue = "owner", email = "owner@example.test";
let queries = 0;
let business: string[] = [];
let releaseRole: (() => Promise<void>) | null = null;
const db = {
  auth: { admin: {
    getUserById: async (id: string) => ({
      data: { user: identity ? { id, email } : null },
      error: identityError ? new Error("auth unavailable") : null,
    }),
    listUsers: async () => { business.push("listUsers"); return { data: { users: [] }, error: null }; },
  } },
  from(table: string) {
    let single = false;
    const filters: Record<string, unknown> = {};
    const q: any = {
      select: () => q, eq: (k:string,v:unknown) => { filters[k]=v; return q; },
      range: () => q, order: () => q, gte: () => q, lt: () => q, lte: () => q,
      in: () => q, limit: () => q, is: () => q, not: () => q,
      maybeSingle: () => { single=true; return q; },
      insert: () => q, update: () => q, delete: () => q,
      then: (resolve:any,reject:any) => (async () => {
        if (table === "user_roles" && filters.user_id) {
          queries++;
          if (releaseRole) await releaseRole();
          if (roleThrows) throw new Error("offline");
          return { data: owner ? { role: roleValue } : null, error: roleError ? new Error("denied") : null };
        }
        business.push(table);
        return { data: single ? null : [], error: null, count: 0 };
      })().then(resolve,reject),
    };
    return q;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
// Apenas transporte TanStack simulado; handlers, validators e autorização reais.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (v:any) => v;
    const builder:any = {
      middleware: () => builder,
      inputValidator: (v:any) => { validate=v; return builder; },
      handler: (fn:any) => (args:any) => fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  },
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@/server/logs.server", () => ({
  logAuditEvent: async () => { business.push("audit"); },
}));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active:true, plan:"premium", debug:{} }),
}));
mock.module("@/server/mercadopago.server", () => ({
  reconcilePendingCardPaymentsForUser: async () => {},
}));
mock.module("@/server/mercadopago-diagnostics.server", () => ({
  diagnoseMercadoPagoPayment: async () => { business.push("diagnose"); return {}; },
  reconcileMercadoPagoPaymentById: async () => { business.push("reconcile"); return { ok:true }; },
}));
const auth = await import("../src/server/admin-master.server");
const admin = await import("../src/lib/admin.functions");
const health = await import("../src/lib/system-health.functions");
const activity = await import("../src/lib/user-activity.functions");
const common = await import("../src/lib/subscription.functions");
const endpoints: [string, any, any][] = [
  ["getAdminDashboard", admin.getAdminDashboard, {}],
  ["setUserStatusManually", admin.setUserStatusManually, { targetUserId:target,status:"cancelado" }],
  ["diagnoseMpPayment", admin.diagnoseMpPayment, { paymentId:"fixture" }],
  ["reconcileMpPaymentById", admin.reconcileMpPaymentById, { paymentId:"fixture" }],
  ["listRecentPaymentEvents", admin.listRecentPaymentEvents, {}],
  ["grantPlanManually", admin.grantPlanManually, { targetUserId:target,plano:"pessoal_premium" }],
  ["deleteUserById", admin.deleteUserById, { targetUserId:target }],
  ["getSystemHealthDashboard", health.getSystemHealthDashboard, {}],
  ["getLogRetentionPreview", health.getLogRetentionPreview, {}],
  ["runLogRetentionCleanup", health.runLogRetentionCleanup, {}],
  ["getUserActivityReport", activity.getUserActivityReport, {}],
];
const call = (fn:any,data:any={}, id:string|undefined=userId) => fn({
  context: { userId:id, supabase:{}, claims:{ role:"owner" }, roles:["owner"], isAdmin:true },
  data: { ...data, userId:target, role:"owner", owner:true, email:legacyEmail },
});
beforeEach(() => {
  owner=true; identity=true; identityError=false; roleError=false; roleThrows=false;
  roleValue="owner"; email="owner@example.test"; queries=0; business=[]; releaseRole=null;
});
for (const [name,fn,data] of endpoints) {
  test(name + ": owner legítimo passa pelo gate", async () => {
    if (name === "grantPlanManually") email=legacyEmail;
    if (name === "deleteUserById") {
      await expect(call(fn,data)).rejects.toThrow("indisponível");
      expect(business).toEqual([]);
    } else {
      await call(fn,data);
      expect(business.length).toBeGreaterThan(0);
    }
    expect(queries).toBe(1);
  });
  for (const scenario of ["sem owner","email legado","revogado","erro role","exceção role","sem sessão","identidade ausente","erro identidade"]) {
    test(name + ": " + scenario + " nega antes de dados/efeitos", async () => {
      if (scenario === "revogado") await auth.requireAdminMasterIdentity(userId);
      if (["sem owner","email legado","revogado"].includes(scenario)) owner=false;
      if (scenario === "email legado") email=legacyEmail;
      if (scenario === "erro role") roleError=true;
      if (scenario === "exceção role") roleThrows=true;
      if (scenario === "identidade ausente") identity=false;
      if (scenario === "erro identidade") identityError=true;
      const promise = scenario === "sem sessão"
        ? fn({ context:{}, data }) : call(fn,data);
      await expect(promise).rejects.toThrow("FORBIDDEN");
      expect(business).toEqual([]);
    });
  }
}
test("papel diferente não autoriza mesmo com objeto retornado", async () => {
  roleValue="admin";
  await expect(auth.requireAdminMasterIdentity(userId)).rejects.toThrow("FORBIDDEN");
});
test("restrição adicional de concessão de plano não é ampliada para todo owner", async () => {
  await expect(call(admin.grantPlanManually,{targetUserId:target,plano:"pessoal_premium"})).rejects.toThrow("Apenas");
  expect(business).toEqual([]);
});
test("consultas concorrentes não compartilham cache positivo após revogação", async () => {
  await auth.requireAdminMasterIdentity(userId);
  let release!: () => void;
  const gate = new Promise<void>(r => { release=r; });
  releaseRole=() => gate;
  const first=auth.requireAdminMasterIdentity(userId);
  const second=auth.requireAdminMasterIdentity(userId);
  await new Promise(r => setTimeout(r,0));
  owner=false; release();
  const results=await Promise.allSettled([first,second]);
  expect(results.map(r => r.status)).toEqual(["rejected","rejected"]);
  expect(queries).toBe(3);
  expect(business).toEqual([]);
});
test("consulta pendente não libera diagnóstico antecipadamente", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release=r; });
  releaseRole=() => gate;
  const pending=call(admin.diagnoseMpPayment,{paymentId:"fixture"});
  await new Promise(r => setTimeout(r,0));
  expect(business).toEqual([]);
  release(); await pending;
  expect(business).toEqual(["diagnose"]);
});
test("rota comum de assinatura permanece acessível sem owner", async () => {
  owner=false;
  const result=await call(common.getCurrentUserSubscription);
  expect(result.active).toBe(true);
  expect(queries).toBe(0);
});
test("endpoints mantêm middleware e não leem permissões do input", () => {
  for (const file of ["admin","system-health","user-activity"]) {
    const source=readFileSync("src/lib/"+file+".functions.ts","utf8");
    expect(source).not.toContain("ADMIN_EMAILS");
    expect(source).toContain("requireAdminMasterIdentity");
    expect(source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)?.length)
      .toBe(source.match(/export const \w+ = createServerFn/g)?.length);
  }
  const middleware=readFileSync("src/integrations/supabase/auth-middleware.ts","utf8");
  expect(middleware).toContain("supabase.auth.getClaims(token)");
  expect(middleware).toContain("userId: data.claims.sub");
});

// Gate OCR real, sem importar o pipeline financeiro/OCR nem chamar serviços.
const ocrSource = readFileSync("src/server/whatsapp-comprovantes.server.ts","utf8");
const ocrAst = ts.createSourceFile("ocr.ts",ocrSource,ts.ScriptTarget.Latest,true);
const ocrNode = ocrAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "podeUsarOcrComprovante")!;
const ocrJs = ts.transpile(ocrNode.getText(ocrAst).replace("export async","async"), {
  target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS,
});
let paidPlan=false;
const ocr = new Function("supabaseAdmin","require",ocrJs+";return podeUsarOcrComprovante")(db,(path:string) => {
  if (path.includes("admin-master")) return auth;
  if (path.includes("subscription.server")) return {
    getSubscriptionForUserIdentity:async () => ({active:paidPlan,plan:paidPlan?"pessoal_premium":"free"}),
  };
  if (path.includes("/plans")) return {planAllowsFeature:(plan:string) => plan==="pessoal_premium"};
  throw new Error("Unexpected import");
});
test("OCR: e-mail legado sem owner/plano não concede bypass",async () => {
  owner=false; email=legacyEmail; paidPlan=false;
  expect(await ocr(userId)).toBe(false);
});
test("OCR: owner válido conserva acesso, revogação remove bypass",async () => {
  paidPlan=false;
  expect(await ocr(userId)).toBe(true);
  owner=false;
  expect(await ocr(userId)).toBe(false);
});
test("OCR: usuário comum pago mantém regra de plano, sem privilégio admin",async () => {
  owner=false; paidPlan=true;
  expect(await ocr(userId)).toBe(true);
});
test("OCR: identidade ausente/erro nega mesmo com owner",async () => {
  paidPlan=false; identity=false;
  expect(await ocr(userId)).toBe(false);
  identity=true; identityError=true;
  expect(await ocr(userId)).toBe(false);
});
