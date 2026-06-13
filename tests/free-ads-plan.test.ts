/**
 * Fase 1E-B2F — Testes de regressão do plano `free_ads`.
 *
 * Roda via: bun tests/free-ads-plan.test.ts
 *
 * Cobre helpers puros (sem DB, sem browser) que decidem o que `free_ads`
 * libera e o que continua bloqueado. Bate diretamente nos gates usados
 * por `useSubscriptionGuard`, `usePlan`, rotas e server functions.
 *
 * Escopo intencional: NÃO cria usuário real, NÃO toca em Supabase,
 * NÃO mexe em checkout/Mercado Pago, NÃO ativa "Começar grátis".
 */
import {
  getEffectiveUserPlan,
  planAllowsFeature,
  isAdminMasterEmail,
  PLAN_LABEL,
  type FeatureKey,
  type PlanTier,
} from "../src/lib/plans";
import {
  canUseAdsense,
  DIRECT_ADS,
  getEnabledDirectAd,
  resolveAdsConfig,
} from "../src/lib/ads-config";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

function eq<T>(name: string, got: T, expected: T) {
  ok(name, got === expected, `esperado ${String(expected)}, recebeu ${String(got)}`);
}

console.log("\n▶ free_ads — getEffectiveUserPlan");
eq(
  "free_ads armazenado é reconhecido",
  getEffectiveUserPlan({ email: "x@y.com" }, "free_ads"),
  "free_ads" as PlanTier,
);
eq(
  "sem_assinatura permanece sem_assinatura",
  getEffectiveUserPlan({ email: "x@y.com" }, null),
  "sem_assinatura" as PlanTier,
);
eq(
  "plano pago pessoal_manual preservado",
  getEffectiveUserPlan({ email: "x@y.com" }, "pessoal_manual"),
  "pessoal_manual" as PlanTier,
);
eq(
  "admin master sobrepõe stored plan",
  isAdminMasterEmail("contato@gastointeligente.com.br")
    ? getEffectiveUserPlan({ email: "contato@gastointeligente.com.br" }, "free_ads")
    : "admin_master",
  "admin_master" as PlanTier,
);
ok(
  "label PT do free_ads = 'Gratuito com anúncios'",
  PLAN_LABEL.free_ads === "Gratuito com anúncios",
);

console.log("\n▶ free_ads — features BÁSICAS liberadas");
const basicAllowed: FeatureKey[] = [
  "gastos_basico",
  "receitas_basico",
  "mercado_basico",
  "metas_basico",
  "orcamento_basico",
  "cartoes_basico",
];
for (const f of basicAllowed) {
  ok(`planAllowsFeature(free_ads, ${f}) === true`, planAllowsFeature("free_ads", f) === true);
}

console.log("\n▶ free_ads — features PAGAS continuam bloqueadas");
const paidBlocked: FeatureKey[] = [
  "cartoes",
  "investimentos",
  "relatorios_avancados",
  "whatsapp",
  "cofre",
  "empresa_inteligente",
  "mercado_avancado",
  "gasto_ai",
  "orcamento",
  "importar_fatura",
];
for (const f of paidBlocked) {
  ok(`planAllowsFeature(free_ads, ${f}) === false`, planAllowsFeature("free_ads", f) === false);
}

console.log("\n▶ Fase 1E-B2J-B — cartoes_basico liberado, fatura/parcelamento continuam premium");
ok(
  "planAllowsFeature(free_ads, 'cartoes_basico') === true",
  planAllowsFeature("free_ads", "cartoes_basico") === true,
);
ok(
  "feature paga 'cartoes' segue bloqueada para free_ads (faturas/importar continuam premium)",
  planAllowsFeature("free_ads", "cartoes") === false,
);

console.log("\n▶ sem_assinatura — tudo paga e básico permanece bloqueado");
for (const f of [...basicAllowed, ...paidBlocked]) {
  ok(
    `planAllowsFeature(sem_assinatura, ${f}) === false`,
    planAllowsFeature("sem_assinatura", f) === false,
  );
}

console.log("\n▶ Plano pago — features básicas e pagas liberadas");
for (const f of [...basicAllowed, "cartoes", "orcamento"] as FeatureKey[]) {
  ok(
    `planAllowsFeature(pessoal_premium, ${f}) === true`,
    planAllowsFeature("pessoal_premium", f) === true,
  );
}

console.log("\n▶ Admin master — passa em qualquer feature");
for (const f of [...basicAllowed, ...paidBlocked]) {
  ok(`planAllowsFeature(admin_master, ${f}) === true`, planAllowsFeature("admin_master", f) === true);
}

console.log("\n▶ Fase 1E-B2Q — arquitetura híbrida de anúncios");
const placeholderConfig = resolveAdsConfig({ enableRealAds: "false", provider: "placeholder" });
eq("anúncios reais desligados por padrão", placeholderConfig.enableRealAds, false);
eq("provider placeholder é reconhecido", placeholderConfig.provider, "placeholder");
eq("provider inválido faz fallback seguro", resolveAdsConfig({ provider: "unknown" }).provider, "placeholder");
eq("consentimento é exigido por padrão", resolveAdsConfig({}).requireConsent, true);
eq("modo de teste AdSense é ligado por padrão", resolveAdsConfig({}).adsenseTestMode, true);
ok(
  "AdSense sem client ID nunca é permitido",
  canUseAdsense(resolveAdsConfig({ enableRealAds: "true", provider: "adsense" }), true) === false,
);
ok(
  "AdSense sem consentimento nunca é permitido quando exigido",
  canUseAdsense(
    resolveAdsConfig({
      enableRealAds: "true",
      provider: "adsense",
      adsenseClient: "ca-pub-test",
      requireConsent: "true",
    }),
    false,
  ) === false,
);
ok(
  "AdSense só é permitido com flag, provider, client e consentimento",
  canUseAdsense(
    resolveAdsConfig({
      enableRealAds: "true",
      provider: "adsense",
      adsenseClient: "ca-pub-test",
      requireConsent: "true",
    }),
    true,
  ) === true,
);
eq("somente dashboard-middle possui anúncio direto", Object.keys(DIRECT_ADS).join(","), "dashboard-middle");
ok("dashboard-middle possui campanha direct habilitada", getEnabledDirectAd("dashboard-middle") !== null);
for (const slotId of ["gastos-bottom", "renda-bottom", "mercado-bottom"]) {
  eq(`${slotId} não possui campanha direct e cai em placeholder`, getEnabledDirectAd(slotId), null);
}
const dashboardAd = DIRECT_ADS["dashboard-middle"];
ok(
  "house ad do dashboard usa navegação interna para a seção de planos",
  dashboardAd.kind === "internal" &&
    dashboardAd.to === "/meu-plano" &&
    dashboardAd.hash === "planos-disponiveis",
);
const dashboardDestination =
  dashboardAd.kind === "internal" ? `${dashboardAd.to}#${dashboardAd.hash ?? ""}` : dashboardAd.href;
ok(
  "destino interno não contém tracking nem identificadores pessoais",
  !dashboardDestination.startsWith("http") &&
    !dashboardDestination.includes("utm_") &&
    !dashboardDestination.includes("user_id") &&
    !dashboardDestination.includes("email") &&
    !dashboardDestination.includes("felipeaitek"),
);

console.log(`\nResultado: ${pass} passou, ${fail} falhou`);
if (fail > 0) {
  console.log("Falhas:");
  for (const f of failures) console.log("  • " + f);
  process.exit(1);
}
