import { useEffect, useState } from "react";
import { CookiePreferencesLink } from "@/components/CookieConsentBanner";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Wallet,
  CreditCard,
  Target,
  TrendingUp,
  PiggyBank,
  Bell,
  LayoutDashboard,
  Receipt,
  ArrowRight,
  Check,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  Zap,
  Eye,
  Calendar,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Star,
  UserPlus,
  Pencil,
  LineChart,
  Quote,
  Crown,
  ChevronLeft,
  ChevronRight,
  Plus,
  SlidersHorizontal,
  Gauge,
  LayoutGrid,
  Bot,
  MessageCircle,
  Send,
  Calculator,
  CalendarClock,
  Building2,
  Users,
  ClipboardList,
  Activity,
  Cloud,
  Landmark,
  TrendingDown,
  Lightbulb,
  Smartphone,
  Lock,
  Repeat,
  ShoppingCart,
  FileText,
  Upload,
  ScanLine,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BrandLogo } from "@/components/BrandLogo";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import empresaEntrepreneur from "@/assets/empresa-entrepreneur.jpg";
import mobileGastoInteligente from "@/assets/mobile-gasto-inteligente.png";
import landingDevicesMockup from "@/assets/landing-devices-mockup.png";
import { COMMERCIAL_PLANS, type PlanTier } from "@/lib/plans";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { chooseFreeAdsPlan } from "@/lib/subscription.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ──────────────────────────────────────────────────────────────
   Public landing — always light theme, white-first, premium feel.
   Scoped under .gi-landing so dark theme classes don't leak in.
   ────────────────────────────────────────────────────────────── */

type NavKey = "home" | "features" | "how" | "plans" | "faq";
const NAV: { key: NavKey; href: string; sectionId: string }[] = [
  { key: "home", href: "#inicio", sectionId: "inicio" },
  { key: "features", href: "#recursos", sectionId: "recursos" },
  { key: "how", href: "#como-funciona", sectionId: "como-funciona" },
  { key: "plans", href: "#planos", sectionId: "planos" },
  { key: "faq", href: "#duvidas", sectionId: "duvidas" },
];

const SCROLL_DURATION = 800;
const HEADER_GAP = 20;
let activeScrollFrame: number | null = null;

function getHeaderOffset() {
  const header = document.querySelector<HTMLElement>("[data-landing-header]");
  return (header?.offsetHeight ?? 70) + HEADER_GAP;
}

function smoothScrollToSection(sectionId: string) {
  if (typeof window === "undefined") return;

  // "inicio" representa o topo da landing — mantemos a URL limpa em "/"
  // (sem hash) ao invés de "/#inicio".
  const isTop = sectionId === "inicio";
  const element = isTop ? null : document.getElementById(sectionId);
  if (!isTop && !element) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const targetPosition = isTop
    ? 0
    : Math.max(0, element!.getBoundingClientRect().top + window.scrollY - getHeaderOffset());

  const updateHash = () => {
    if (!history.replaceState) return;
    if (isTop) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      history.replaceState(null, "", `#${sectionId}`);
    }
  };

  if (activeScrollFrame !== null) {
    window.cancelAnimationFrame(activeScrollFrame);
    activeScrollFrame = null;
  }

  if (reduce) {
    window.scrollTo(0, targetPosition);
    updateHash();
    return;
  }

  const startPosition = window.scrollY;
  const distance = targetPosition - startPosition;
  let startTime: number | null = null;

  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const animation = (currentTime: number) => {
    if (startTime === null) startTime = currentTime;
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / SCROLL_DURATION, 1);

    window.scrollTo(0, startPosition + distance * easeInOutCubic(progress));

    if (progress < 1) {
      activeScrollFrame = window.requestAnimationFrame(animation);
    } else {
      activeScrollFrame = null;
      updateHash();
    }
  };

  activeScrollFrame = window.requestAnimationFrame(animation);
}

function handleAnchorClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  onBeforeScroll?: () => void,
) {
  if (!href.startsWith("#")) return;
  e.preventDefault();
  const sectionId = href.replace(/^#/, "");
  onBeforeScroll?.();
  window.requestAnimationFrame(() => smoothScrollToSection(sectionId));
}

/**
 * Link inteligente para âncoras da landing.
 * - Se o usuário já está na landing ("/" ou "/landing"), faz smooth scroll.
 * - Se está em outra rota pública (ex.: /termos), navega para "/#sectionId"
 *   sem passar por login. O efeito de hash em PublicLanding rola até a seção.
 */
export function LandingAnchorLink({
  section,
  className,
  children,
  onClick,
}: {
  section: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onLanding = pathname === "/";

  if (onLanding) {
    return (
      <a
        href={`#${section}`}
        onClick={(e) => handleAnchorClick(e, `#${section}`, onClick)}
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to="/" hash={section} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}

export function PublicLanding() {
  const { t } = useTranslation("landing");
  // Quando aterrissamos na landing com um hash (ex.: vindo de /termos via
  // /#planos), rolamos suavemente até a seção correspondente.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    // Espera o layout da landing montar antes de rolar.
    const t = window.setTimeout(() => smoothScrollToSection(hash), 80);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="gi-landing min-h-screen bg-white text-slate-900 antialiased"
      style={{ colorScheme: "light" }}
    >
      <Header />
      <main>
        <Hero />
        <BanksStrip />
        <TrustStrip />
        <WhyUs />
        <HowItWorks />
        <ScreensTabs />
        <DashboardShowcase />
        <PlanejamentoSection />
        <ContasSection />
        <MercadoInteligenteSection />
        <IntelligenceSection />
        <GastoAISection />
        <FeatureSplit
          eyebrow={t("gastosSplit.eyebrow")}
          title={t("gastosSplit.title")}
          text={t("gastosSplit.text")}
          bullets={t("gastosSplit.bullets", { returnObjects: true }) as string[]}
          visual={<GastosMock />}
          reverse
        />
        <FeatureSplit
          eyebrow={t("cartoesSplit.eyebrow")}
          title={t("cartoesSplit.title")}
          text={t("cartoesSplit.text")}
          bullets={t("cartoesSplit.bullets", { returnObjects: true }) as string[]}
          visual={<CartaoMock />}
        />
        <FeatureSplit
          eyebrow={t("contasSplit.eyebrow")}
          title={t("contasSplit.title")}
          text={t("contasSplit.text")}
          bullets={t("contasSplit.bullets", { returnObjects: true }) as string[]}
          visual={<ContasMock />}
          reverse
        />
        <EmpresaInteligenteSection />
        <MoreFeatures />
        <ImportacaoInteligenteSection />
        <AppExperienceSection />
        <MultiDeviceShowcase />
        <ForWho />
        <TrustPoints />
        <Plans />
        <Testimonials />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
      <LandingStyles />
    </div>
  );
}

/* ============================== HEADER ============================== */

function Header() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-landing-header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "bg-white/85 backdrop-blur-xl border-b border-slate-200/70 shadow-[0_6px_24px_-18px_rgba(15,23,42,0.18)]"
          : "bg-white/0 border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between px-4 sm:h-14 sm:px-6 md:h-16 lg:px-8">
        <a
          href="#inicio"
          onClick={(e) => handleAnchorClick(e, "#inicio")}
          className="flex items-center gap-2"
        >
          <img
            src="/logos/brand/icone-gasto-inteligente-light.svg"
            alt="Gasto Inteligente"
            width={36}
            height={36}
            fetchPriority="high"
            className="h-8 w-auto object-contain sm:hidden"
            draggable={false}
          />
          <img
            src="/logos/brand/logo-gasto-inteligente-sidebar-light.svg"
            alt="Gasto Inteligente"
            width={180}
            height={40}
            fetchPriority="high"
            className="hidden w-auto object-contain sm:block sm:h-9 md:h-10"
            draggable={false}
          />
        </a>
        <nav className="hidden items-center gap-5 lg:flex lg:gap-8">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={(e) => handleAnchorClick(e, n.href)}
              className="whitespace-nowrap text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              {t(`nav.${n.key}`)}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitcher variant="ghost-light" />
          <Link
            to="/login"
            className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 lg:px-4"
          >
            {t("actions.signIn")}
          </Link>
          <Link
            to="/cadastro"
            className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(15,23,42,0.45)] transition-all hover:bg-slate-800 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.55)] lg:px-5"
          >
            {t("actions.signUp")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <LanguageSwitcher variant="ghost-light" />
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
            aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <div className="flex flex-col px-4 py-3">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={(e) => handleAnchorClick(e, n.href, () => setOpen(false))}
                className="rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {t(`nav.${n.key}`)}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
              <Link
                to="/login"
                className="rounded-full border border-slate-200 px-4 py-2.5 text-center text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                {t("actions.signIn")}
              </Link>
              <Link
                to="/cadastro"
                className="rounded-full bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                {t("actions.signUp")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

/* ============================== HERO ============================== */

function Hero() {
  const { t } = useTranslation("landing");
  const reduce = useReducedMotion();
  return (
    <section id="inicio" className="relative overflow-hidden">
      {/* Decorative background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 80% -10%, rgba(34,197,94,0.12) 0%, transparent 60%), radial-gradient(50% 40% at 10% 0%, rgba(59,130,246,0.14) 0%, transparent 65%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.045) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse at top, rgba(0,0,0,0.7) 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at top, rgba(0,0,0,0.7) 0%, transparent 70%)",
        }}
      />
      <div className="mx-auto -mt-1 grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-0 pb-16 sm:mt-0 sm:px-6 sm:pt-2 md:pt-8 md:pb-24 lg:grid-cols-12 lg:gap-12 lg:px-8">
        <div className="lg:col-span-6">
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Sua vida financeira mais leve
          </motion.span>
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0 }}
            className="mt-5 font-display text-[2rem] font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.6rem]"
          >
            {t("hero.titleStart")}{" "}
            <span className="bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 bg-clip-text text-transparent">
              {t("hero.titleHighlight")}
            </span>{" "}
            {t("hero.titleEnd")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg"
          >
            {t("hero.subtitle")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-7 flex flex-col gap-3 sm:flex-row"
          >
            <Link
              to="/cadastro"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_30px_-12px_rgba(15,23,42,0.45)] transition-all hover:bg-slate-800 hover:-translate-y-0.5"
            >
              {t("hero.ctaPrimary")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {t("hero.ctaSecondary")}
            </Link>
          </motion.div>
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mt-8 flex flex-wrap gap-2"
          >
            {(["personal", "cards", "goals", "monthly", "visual"] as const).map((k) => (
              <li
                key={k}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                {t(`hero.chips.${k}`)}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Visual mockup */}
        <div className="relative lg:col-span-6">
          {/* decorative blob behind mockup */}
          <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 hidden md:block">
            <svg viewBox="0 0 600 600" className="h-full w-full">
              <defs>
                <linearGradient id="hero-blob" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.18" />
                </linearGradient>
              </defs>
              <path
                fill="url(#hero-blob)"
                d="M431.5,329.5Q403,409,323,440Q243,471,167,427.5Q91,384,84.5,294Q78,204,150.5,148Q223,92,313.5,98Q404,104,438,202Q472,300,431.5,329.5Z"
              />
            </svg>
          </div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative mx-auto w-full max-w-[560px]"
          >
            <HeroDashboardMock />
            {/* floating cards */}
            <motion.div
              animate={reduce ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -left-6 top-10 hidden w-44 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] sm:block"
            >
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                  <ArrowUpRight className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {t("mockup.float.income")}
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900">R$ 6.420</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={reduce ? undefined : { y: [0, -6, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
              className="absolute -left-8 bottom-24 hidden w-44 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] lg:block"
            >
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-700">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {t("mockup.float.alert")}
                  </p>
                  <p className="text-xs font-bold leading-tight text-slate-900">
                    {t("mockup.float.alertText")}
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={reduce ? undefined : { y: [0, 8, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              className="absolute -right-4 bottom-16 hidden w-48 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] sm:block"
            >
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-100 text-blue-700">
                  <Target className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {t("mockup.float.goalTrip")}
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900">
                    {t("mockup.float.goalDone", { pct: 68 })}
                  </p>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" />
              </div>
            </motion.div>

            <motion.div
              animate={reduce ? undefined : { y: [0, 7, 0] }}
              transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
              className="absolute -right-6 top-20 hidden w-44 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] lg:block"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-700">
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      {t("mockup.float.invoice")}
                    </p>
                    <p className="text-xs font-bold text-slate-900">
                      {t("mockup.float.invoiceOpen")}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-1.5 text-sm font-extrabold tabular-nums text-slate-900">R$ 1.180</p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ============================== MULTI-DEVICE SHOWCASE ============================== */

function MultiDeviceShowcase() {
  const { t } = useTranslation("landing");
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/70 to-white py-14 sm:py-20">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(59,130,246,0.10) 0%, transparent 60%), radial-gradient(40% 35% at 90% 80%, rgba(16,185,129,0.10) 0%, transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            {t("multiDevice.tag")}
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
            {t("multiDevice.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">
            {t("multiDevice.subtitle")}
          </p>
        </div>

        <div className="relative mx-auto mt-10 max-w-3xl sm:mt-12 lg:max-w-5xl">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[72%] z-0 h-28 w-[78%] -translate-x-1/2 rounded-full opacity-80 blur-3xl md:top-[76%] md:w-[88%]"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(15,23,42,0.16) 0%, rgba(15,23,42,0.08) 38%, rgba(15,23,42,0.00) 74%)",
            }}
          />
          <img
            src={landingDevicesMockup}
            alt={t("multiDevice.title")}
            draggable={false}
            className="relative z-10 mx-auto w-full select-none object-contain"
          />
        </div>
      </div>
    </section>
  );
}

function NotebookFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-2xl lg:max-w-3xl">
      {/* lid */}
      <div className="relative z-10 rounded-[20px] border border-slate-300/80 bg-gradient-to-b from-slate-100 to-slate-200 p-1.5 shadow-[0_60px_120px_-50px_rgba(15,23,42,0.45)]">
        <div className="rounded-[14px] bg-slate-900 p-1.5">
          {/* camera */}
          <div className="mx-auto mb-1 h-1 w-12 rounded-full bg-slate-700/70 flex items-center justify-center">
            <span className="h-1 w-1 rounded-full bg-slate-500" />
          </div>
          <div className="overflow-hidden rounded-[9px] bg-white aspect-[16/10]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function TabletFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-[115px] sm:w-[180px] md:w-[230px] lg:w-[260px] rounded-[24px] border border-slate-300/80 bg-gradient-to-b from-slate-100 to-slate-200 p-1.5 sm:p-2 shadow-[0_45px_80px_-30px_rgba(15,23,42,0.45)]">
      <div className="relative overflow-hidden rounded-[18px] bg-slate-900 p-1.5">
        {/* front camera */}
        <div className="absolute left-1/2 top-1 z-10 h-1 w-1 -translate-x-1/2 rounded-full bg-slate-700" />
        <div className="overflow-hidden rounded-[12px] bg-white aspect-[3/4] [zoom:0.8] sm:[zoom:1]">
          {children}
        </div>
      </div>
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-[76px] sm:w-[90px] md:w-[105px] lg:w-[125px] rounded-[24px] border border-slate-300/80 bg-gradient-to-b from-slate-100 to-slate-200 p-1 shadow-[0_35px_60px_-20px_rgba(15,23,42,0.45)]">
      <div className="relative overflow-hidden rounded-[20px] bg-slate-900 p-0.5">
        {/* notch */}
        <div className="absolute left-1/2 top-1 z-10 h-2.5 w-10 -translate-x-1/2 rounded-full bg-slate-900" />
        <div className="overflow-hidden rounded-[16px] bg-white aspect-[9/19] [zoom:0.7] sm:[zoom:1]">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---- Shared KPI data for the radar block (matches reference screenshots) ---- */
function useRadarKpis() {
  const { t } = useTranslation("landing");
  return [
    {
      l: t("mockup.radar.balance"),
      v: "R$ 4.852,30",
      s: t("mockup.radar.balanceHint"),
      icon: <Wallet className="h-2.5 w-2.5 text-slate-500" />,
      bg: "bg-slate-100",
    },
    {
      l: t("mockup.radar.income"),
      v: "R$ 5.420,00",
      s: t("mockup.radar.incomeHint"),
      icon: <ArrowUpRight className="h-2.5 w-2.5 text-emerald-600" />,
      bg: "bg-emerald-50",
    },
    {
      l: t("mockup.radar.expenses"),
      v: "R$ 1.248,90",
      s: t("mockup.radar.expensesHint"),
      icon: <ArrowDownRight className="h-2.5 w-2.5 text-rose-600" />,
      bg: "bg-rose-50",
    },
    {
      l: t("mockup.radar.toPay"),
      v: "R$ 320,00",
      s: t("mockup.radar.toPayHint"),
      icon: <Calendar className="h-2.5 w-2.5 text-amber-600" />,
      bg: "bg-amber-50",
    },
  ];
}

function DesktopDashboardMock() {
  const { t } = useTranslation("landing");
  const radarKpis = useRadarKpis();
  const navItems = [
    { i: LayoutDashboard, l: t("mockup.nav.dashboard"), active: true },
    { i: Receipt, l: t("mockup.nav.expenses") },
    { i: Bell, l: t("mockup.nav.alerts") },
    { i: CreditCard, l: t("mockup.nav.cards") },
    { i: Sparkles, l: t("mockup.nav.subscriptions") },
    { i: TrendingUp, l: t("mockup.nav.investments") },
    { i: ArrowUpRight, l: t("mockup.nav.income") },
    { i: Wallet, l: t("mockup.nav.billsToPay") },
    { i: ArrowDownRight, l: t("mockup.nav.billsToReceive") },
    { i: LineChart, l: t("mockup.nav.budget") },
    { i: LineChart, l: t("mockup.nav.reports") },
    { i: PiggyBank, l: t("mockup.nav.savings") },
    { i: Target, l: t("mockup.nav.goals") },
  ];
  return (
    <div className="flex h-full w-full bg-slate-50/60 text-slate-900">
      {/* Sidebar */}
      <div className="flex w-[22%] flex-col border-r border-slate-200 bg-white p-2">
        <div className="flex items-center px-1 pb-1">
          <img
            src="/logos/brand/logo-gasto-inteligente-completo-light.svg"
            alt="Gasto Inteligente"
            draggable={false}
            className="h-4 w-auto object-contain"
          />
        </div>
        <p className="px-1 text-[6px] text-slate-400">{t("mockup.sidebar.tagline")}</p>
        <div className="mt-2 flex items-center justify-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[7.5px] font-semibold text-white">
          <Plus className="h-2 w-2" /> {t("mockup.sidebar.addExpense")}
        </div>
        <div className="mt-2 flex flex-col gap-0.5 overflow-hidden">
          {navItems.map(({ i: Icon, l, active }) => (
            <div
              key={l}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[7px] font-medium",
                active ? "bg-slate-900 text-white" : "text-slate-500",
              )}
            >
              <Icon className="h-2 w-2" strokeWidth={active ? 2.4 : 1.8} />
              <span className="truncate">{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-hidden p-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[7px] font-semibold uppercase tracking-widest text-slate-400">
              {t("mockup.sidebar.monthSummary")}
            </p>
            <p className="text-[15px] font-bold leading-tight text-slate-900">
              {t("mockup.sidebar.exampleMonth")}
            </p>
            <p className="text-[7.5px] text-slate-500">{t("mockup.sidebar.exampleSubtitle")}</p>
          </div>
          <span className="grid h-5 w-5 place-items-center rounded-full border border-slate-200 bg-white">
            <Bell className="h-2.5 w-2.5 text-slate-500" />
          </span>
        </div>

        {/* Alertas */}
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <Bell className="h-3 w-3 text-slate-700" />
            <div>
              <p className="text-[8px] font-bold text-slate-900">{t("mockup.alerts.title")}</p>
              <p className="text-[6.5px] text-slate-500">{t("mockup.alerts.allClear")}</p>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[6.5px] font-medium text-emerald-700">
            <Sparkles className="h-2 w-2" /> {t("mockup.alerts.nothingUrgent")}
          </div>
        </div>

        {/* TÁ TUDO NO RADAR */}
        <p className="mt-2 text-[6.5px] font-semibold uppercase tracking-widest text-slate-400">
          {t("mockup.radar.title")}
        </p>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          {radarKpis.map((k) => (
            <div key={k.l} className="rounded-lg border border-slate-200 bg-white p-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[6px] font-semibold tracking-wider text-slate-500">{k.l}</p>
                <span className={cn("grid h-3 w-3 place-items-center rounded-full", k.bg)}>
                  {k.icon}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] font-bold tabular-nums text-slate-900">{k.v}</p>
              <p className="text-[6px] text-slate-400">{k.s}</p>
            </div>
          ))}
        </div>

        {/* Limite Inteligente */}
        <div className="mt-2 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-amber-50/70 to-white p-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="grid h-3 w-3 place-items-center rounded-full bg-amber-100">
                <Sparkles className="h-1.5 w-1.5 text-amber-600" />
              </span>
              <p className="text-[6.5px] font-bold uppercase tracking-wider text-amber-700">
                {t("mockup.smartLimit.title")}
              </p>
            </div>
            <span className="flex items-center gap-0.5 rounded-full border border-amber-300 bg-white px-1 py-0.5 text-[5.5px] font-semibold text-amber-700">
              <Gauge className="h-1.5 w-1.5" /> {t("mockup.smartLimit.watchPace")}
            </span>
          </div>

          <div className="mt-1 flex items-end justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-1">
                <p className="text-[14px] font-bold leading-none tabular-nums text-amber-700">
                  R$ 13,73
                </p>
                <span className="text-[7px] font-semibold text-amber-600">
                  {t("mockup.smartLimit.perDay")}
                </span>
              </div>
              <p className="mt-0.5 text-[5.5px] leading-snug text-amber-800/80">
                {t("mockup.smartLimit.keepBelow", { value: "R$ 13,73" })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[5.5px] font-semibold uppercase tracking-wider text-slate-500">
                {t("mockup.smartLimit.goalLabel")}
              </p>
              <p className="text-[8px] font-bold tabular-nums text-slate-900">R$ 350,00</p>
            </div>
          </div>

          <div className="mt-1">
            <div className="flex items-center justify-between text-[5.5px] font-semibold uppercase tracking-wider text-amber-700">
              <span>{t("mockup.smartLimit.goalUsed")}</span>
              <span>14%</span>
            </div>
            <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-amber-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                style={{ width: "14%" }}
              />
            </div>
          </div>

          <div className="mt-1 grid grid-cols-3 gap-1">
            {[
              { l: t("mockup.smartLimit.variable"), v: "R$ 48,00", i: Wallet, t: "text-blue-600" },
              {
                l: t("mockup.smartLimit.remaining"),
                v: "R$ 302,00",
                i: ArrowUpRight,
                t: "text-emerald-600",
              },
              { l: t("mockup.smartLimit.daysLeft"), v: "22", i: Gauge, t: "text-amber-600" },
            ].map((s) => (
              <div key={s.l} className="rounded-md border border-amber-200 bg-white px-1 py-0.5">
                <div className="flex items-center gap-1">
                  <s.i className={cn("h-1.5 w-1.5", s.t)} />
                  <p className="text-[5px] font-semibold uppercase tracking-wider text-slate-500 truncate">
                    {s.l}
                  </p>
                </div>
                <p className="text-[7px] font-bold tabular-nums text-slate-900">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabletDashboardMock() {
  const { t } = useTranslation("landing");
  const radarKpis = useRadarKpis();
  return (
    <div className="relative flex h-full w-full flex-col bg-slate-50/60 text-slate-900">
      <div className="flex-1 overflow-hidden px-3 pt-3 pb-7">
        {/* logo */}
        <div className="flex items-center justify-between">
          <img
            src="/logos/brand/logo-gasto-inteligente-completo-light.svg"
            alt="Gasto Inteligente"
            draggable={false}
            className="h-3 w-auto object-contain"
          />
          <div className="flex items-center gap-1">
            <span className="flex items-center rounded-full border border-slate-200 bg-white px-1 py-0.5">
              <ChevronLeft className="h-2 w-2 text-slate-500" />
              <ChevronRight className="h-2 w-2 text-slate-500" />
            </span>
            <span className="grid h-4 w-4 place-items-center rounded-full border border-slate-200 bg-white">
              <Bell className="h-2 w-2 text-slate-500" />
            </span>
          </div>
        </div>

        {/* header */}
        <div className="mt-2">
          <p className="text-[6.5px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.sidebar.monthSummary")}
          </p>
          <p className="text-[14px] font-bold leading-tight text-slate-900">
            {t("mockup.sidebar.exampleMonth")}
          </p>
          <p className="text-[6.5px] text-slate-500">{t("mockup.sidebar.exampleSubtitle")}</p>
        </div>

        {/* Alertas */}
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Bell className="h-2.5 w-2.5 text-slate-700" />
            <div>
              <p className="text-[7px] font-bold text-slate-900">{t("mockup.alerts.title")}</p>
              <p className="text-[5.5px] text-slate-500">{t("mockup.alerts.allClear")}</p>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[5.5px] font-medium text-emerald-700">
            <Sparkles className="h-1.5 w-1.5" /> {t("mockup.alerts.nothingUrgent")}
          </div>
        </div>

        {/* radar */}
        <p className="mt-2 text-[5.5px] font-semibold uppercase tracking-widest text-slate-400">
          {t("mockup.radar.title")}
        </p>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {radarKpis.map((k) => (
            <div key={k.l} className="rounded-lg border border-slate-200 bg-white p-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[5.5px] font-semibold tracking-wider text-slate-500">{k.l}</p>
                <span className={cn("grid h-3 w-3 place-items-center rounded-full", k.bg)}>
                  {k.icon}
                </span>
              </div>
              <p className="mt-0.5 text-[9px] font-bold tabular-nums text-slate-900">{k.v}</p>
              <p className="text-[5.5px] text-slate-400">{k.s}</p>
            </div>
          ))}
        </div>

        {/* Limite */}
        <div className="mt-2 rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 via-amber-50/70 to-white p-2">
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-1">
              <span className="grid h-3 w-3 place-items-center rounded-full bg-amber-100">
                <Sparkles className="h-1.5 w-1.5 text-amber-600" />
              </span>
              <p className="text-[6px] font-bold uppercase tracking-wider text-amber-700">
                {t("mockup.smartLimit.title")}
              </p>
            </div>
            <span className="flex items-center gap-0.5 rounded-full border border-amber-300 bg-white px-1 py-0.5 text-[5.5px] font-semibold text-amber-700">
              <Gauge className="h-1.5 w-1.5" /> {t("mockup.smartLimit.watchPace")}
            </span>
          </div>
          <p className="mt-1 text-[6px] font-semibold text-amber-800">
            {t("mockup.smartLimit.ignoresFixed")}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-1.5 py-0.5 text-[5.5px] font-semibold text-amber-700">
            <SlidersHorizontal className="h-1.5 w-1.5" /> {t("mockup.smartLimit.onlyVariable")}
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <p className="text-[16px] font-bold leading-none tabular-nums text-amber-700">
              R$ 13,73
            </p>
            <span className="text-[7px] font-semibold text-amber-600">
              {t("mockup.smartLimit.perDay")}
            </span>
          </div>
          <p className="mt-0.5 text-[5.5px] leading-snug text-amber-800/80">
            {t("mockup.smartLimit.keepBelow", { value: "R$ 13,73" })}
          </p>
        </div>
      </div>

      {/* bottom nav */}
      <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white px-2 pt-1 pb-1.5">
        <div className="flex items-center justify-around">
          {[
            { i: LayoutDashboard, l: t("mockup.nav.dashboard"), active: true },
            { i: Receipt, l: t("mockup.nav.expenses") },
            { i: CreditCard, l: t("mockup.nav.cards") },
            { i: Target, l: t("mockup.nav.goals") },
            { i: LayoutGrid, l: t("mockup.nav.more") },
          ].map(({ i: Icon, l, active }) => (
            <div key={l} className="flex flex-col items-center gap-0.5">
              <Icon
                className={cn("h-2.5 w-2.5", active ? "text-slate-900" : "text-slate-400")}
                strokeWidth={active ? 2.4 : 1.8}
              />
              <span
                className={cn(
                  "text-[5px] font-semibold",
                  active ? "text-slate-900" : "text-slate-400",
                )}
              >
                {l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FluxoLineChart({ className, compact = false }: { className?: string; compact?: boolean }) {
  // Two series over the month: receitas (verde) e despesas (azul)
  const receitas = [20, 28, 24, 36, 42, 38, 50, 58, 54, 66, 72, 70];
  const despesas = [14, 22, 20, 30, 26, 38, 34, 44, 40, 52, 48, 58];
  const w = 200;
  const h = 80;
  const pad = { l: 4, r: 4, t: 6, b: 6 };
  const max = 80;
  const xStep = (w - pad.l - pad.r) / (receitas.length - 1);
  const toPath = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = pad.l + i * xStep;
        const y = h - pad.b - (v / max) * (h - pad.t - pad.b);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const areaPath = (arr: number[]) => {
    const line = toPath(arr);
    const lastX = pad.l + (arr.length - 1) * xStep;
    return `${line} L${lastX.toFixed(1)},${(h - pad.b).toFixed(1)} L${pad.l.toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  };
  const gridLines = compact ? 2 : 3;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("block", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="fluxoReceitas" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fluxoDespesas" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: gridLines }).map((_, i) => {
        const y = pad.t + ((h - pad.t - pad.b) / gridLines) * (i + 1);
        return (
          <line
            key={i}
            x1={pad.l}
            x2={w - pad.r}
            y1={y}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
        );
      })}
      <path d={areaPath(despesas)} fill="url(#fluxoDespesas)" />
      <path d={areaPath(receitas)} fill="url(#fluxoReceitas)" />
      <path
        d={toPath(despesas)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={toPath(receitas)}
        fill="none"
        stroke="#10b981"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!compact &&
        receitas.map((v, i) => {
          const x = pad.l + i * xStep;
          const y = h - pad.b - (v / max) * (h - pad.t - pad.b);
          return <circle key={i} cx={x} cy={y} r={1} fill="#10b981" />;
        })}
    </svg>
  );
}

function MobileDashboardMock() {
  const { t } = useTranslation("landing");
  const radarKpis = useRadarKpis();
  const smartTitleShort = t("mockup.smartLimit.titleShort");
  return (
    <div className="relative flex h-full w-full flex-col bg-slate-50/60 text-slate-900">
      <div className="flex-1 overflow-hidden px-2 pt-2 pb-7">
        {/* logo */}
        <div className="flex items-center justify-between gap-1">
          <img
            src="/logos/brand/logo-gasto-inteligente-completo-light.svg"
            alt="Gasto Inteligente"
            draggable={false}
            className="h-2.5 w-auto object-contain"
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="flex items-center rounded-full border border-slate-200 bg-white px-0.5 py-0.5">
              <ChevronLeft className="h-1.5 w-1.5 text-slate-500" />
              <ChevronRight className="h-1.5 w-1.5 text-slate-500" />
            </span>
            <span className="grid h-3 w-3 place-items-center rounded-full border border-slate-200 bg-white">
              <Bell className="h-1.5 w-1.5 text-slate-500" />
            </span>
          </div>
        </div>

        {/* header */}
        <div className="mt-1.5 min-w-0">
          <p className="text-[5px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.sidebar.monthSummary")}
          </p>
          <p className="text-[10px] font-bold leading-tight text-slate-900">
            {t("mockup.sidebar.exampleMonth")}
          </p>
          <p className="text-[5px] text-slate-500 truncate">
            {t("mockup.sidebar.exampleSubtitle")}
          </p>
        </div>

        {/* Alertas */}
        <div className="mt-1 rounded-md border border-slate-200 bg-white px-1.5 py-1">
          <div className="flex items-center gap-1">
            <Bell className="h-2 w-2 text-slate-700" />
            <div>
              <p className="text-[5.5px] font-bold text-slate-900">{t("mockup.alerts.title")}</p>
              <p className="text-[4.5px] text-slate-500">{t("mockup.alerts.allClear")}</p>
            </div>
          </div>
          <div className="mt-0.5 flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[4.5px] font-medium text-emerald-700">
            <Sparkles className="h-1 w-1" /> {t("mockup.alerts.nothingUrgent")}
          </div>
        </div>

        {/* radar */}
        <p className="mt-1.5 text-[4.5px] font-semibold uppercase tracking-widest text-slate-400">
          {t("mockup.radar.title")}
        </p>
        <div className="mt-0.5 grid grid-cols-2 gap-1">
          {radarKpis.map((k) => (
            <div key={k.l} className="rounded-md border border-slate-200 bg-white p-1">
              <div className="flex items-center justify-between">
                <p className="text-[4.5px] font-semibold tracking-wider text-slate-500">{k.l}</p>
                <span className={cn("grid h-2 w-2 place-items-center rounded-full", k.bg)}>
                  {k.icon}
                </span>
              </div>
              <p className="mt-0.5 text-[7px] font-bold tabular-nums text-slate-900 truncate">
                {k.v}
              </p>
              <p className="text-[4.5px] text-slate-400 truncate">{k.s}</p>
            </div>
          ))}
        </div>

        {/* Limite */}
        <div className="mt-1.5 rounded-md border border-amber-200 bg-gradient-to-br from-amber-50 via-amber-50/70 to-white p-1.5">
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-0.5 min-w-0">
              <span className="grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full bg-amber-100">
                <Sparkles className="h-1 w-1 text-amber-600" />
              </span>
              <p className="whitespace-pre-line text-[5px] font-bold uppercase leading-tight tracking-wider text-amber-700">
                {smartTitleShort}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-amber-300 bg-white px-1 py-0.5 text-[4.5px] font-semibold text-amber-700">
              <Gauge className="h-1 w-1" /> {t("mockup.smartLimit.watchPace")}
            </span>
          </div>
          <p className="mt-1 text-[5px] font-semibold text-amber-800">
            {t("mockup.smartLimit.ignoresFixed")}
          </p>
          <span className="mt-1 inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-white px-1 py-0.5 text-[4.5px] font-semibold text-amber-700">
            <SlidersHorizontal className="h-1 w-1" /> {t("mockup.smartLimit.onlyVariable")}
          </span>
        </div>
      </div>

      {/* bottom nav */}
      <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white px-1 pt-0.5 pb-1">
        <div className="flex items-center justify-around">
          {[
            { i: LayoutDashboard, l: t("mockup.nav.dashboard"), active: true },
            { i: Receipt, l: t("mockup.nav.expenses") },
            { i: CreditCard, l: t("mockup.nav.cards") },
            { i: Target, l: t("mockup.nav.goals") },
            { i: LayoutGrid, l: t("mockup.nav.more") },
          ].map(({ i: Icon, l, active }) => (
            <div key={l} className="flex flex-col items-center gap-0.5">
              <Icon
                className={cn("h-2 w-2", active ? "text-slate-900" : "text-slate-400")}
                strokeWidth={active ? 2.4 : 1.8}
              />
              <span
                className={cn(
                  "text-[4px] font-semibold",
                  active ? "text-slate-900" : "text-slate-400",
                )}
              >
                {l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeroDashboardMock() {
  const { t } = useTranslation("landing");
  return (
    <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.35)]">
      <div className="rounded-[22px] border border-slate-200/70 bg-white p-4 sm:p-5">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              {t("mockup.dashboard.overview")}
            </p>
            <p className="text-base font-bold text-slate-900">{t("mockup.dashboard.month")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500">
              <Calendar className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
        {/* KPI grid */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <KpiMini
            label={t("mockup.dashboard.balance")}
            value="R$ 3.142,80"
            tone="brand"
            icon={<Wallet className="h-3.5 w-3.5" />}
          />
          <KpiMini
            label={t("mockup.dashboard.income")}
            value="R$ 6.420,00"
            tone="success"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          />
          <KpiMini
            label={t("mockup.dashboard.expenses")}
            value="R$ 3.277,20"
            tone="danger"
            icon={<ArrowDownRight className="h-3.5 w-3.5" />}
          />
          <KpiMini
            label={t("mockup.dashboard.toPay")}
            value="R$ 980,00"
            tone="warning"
            icon={<Receipt className="h-3.5 w-3.5" />}
          />
        </div>
        {/* Chart */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-700">
                {t("mockup.dashboard.monthFlow")}
              </p>
              <p className="text-[10px] text-slate-400">{t("mockup.dashboard.incomeVsExpenses")}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className="h-1.5 w-2 rounded-full bg-emerald-500" />
                {t("mockup.dashboard.incomeShort")}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className="h-1.5 w-2 rounded-full bg-blue-500" />
                {t("mockup.dashboard.expensesShort")}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                +12%
              </span>
            </div>
          </div>
          <FluxoLineChart className="mt-3 h-24 w-full" />
          <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400">
            <span>01</span>
            <span>07</span>
            <span>14</span>
            <span>21</span>
            <span>28</span>
          </div>
        </div>
        {/* Limite */}
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">
              {t("mockup.dashboard.smartLimit")}
            </p>
            <p className="text-xs font-semibold tabular-nums text-slate-500">62%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-500 to-blue-500" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t("mockup.dashboard.smartLimitHint")}</p>
        </div>
      </div>
    </div>
  );
}

function KpiMini({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "brand" | "success" | "danger" | "warning";
  icon: React.ReactNode;
}) {
  const toneMap = {
    brand: "bg-blue-50 text-blue-700",
    success: "bg-emerald-50 text-emerald-700",
    danger: "bg-rose-50 text-rose-700",
    warning: "bg-amber-50 text-amber-700",
  } as const;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <span className={cn("grid h-6 w-6 place-items-center rounded-md", toneMap[tone])}>
          {icon}
        </span>
      </div>
      <p className="mt-1 text-sm font-bold tabular-nums text-slate-900 sm:text-base">{value}</p>
    </div>
  );
}

/* ============================== TRUST STRIP ============================== */

function TrustStrip() {
  const { t } = useTranslation("landing");
  const items = [
    { icon: ShieldCheck, label: t("trust.dataProtected"), hint: t("trust.dataProtectedHint") },
    { icon: Zap, label: t("trust.fast"), hint: t("trust.fastHint") },
    { icon: Eye, label: t("trust.clearVision"), hint: t("trust.clearVisionHint") },
    { icon: Star, label: t("trust.routine"), hint: t("trust.routineHint") },
  ];
  return (
    <div className="relative border-y border-slate-100 bg-gradient-to-b from-white via-slate-50/40 to-white">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-8 sm:px-6 md:grid-cols-4 md:gap-6 lg:px-8">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-slate-700 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200">
              <it.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 leading-tight">{it.label}</p>
              <p className="truncate text-[11px] text-slate-500">{it.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== HOW IT WORKS ============================== */

function HowItWorks() {
  const { t } = useTranslation("landing");
  const steps = [
    {
      icon: UserPlus,
      n: "01",
      title: t("how.step1Title"),
      text: t("how.step1Text"),
      accent: "from-blue-500 to-sky-500",
      ring: "ring-blue-100",
      glow: "shadow-[0_18px_40px_-18px_rgba(59,130,246,0.55)]",
      tag: `${t("how.stepTag")} 01`,
      tagBg: "bg-blue-50 text-blue-700 ring-blue-100",
    },
    {
      icon: Pencil,
      n: "02",
      title: t("how.step2Title"),
      text: t("how.step2Text"),
      accent: "from-emerald-500 to-teal-500",
      ring: "ring-emerald-100",
      glow: "shadow-[0_18px_40px_-18px_rgba(16,185,129,0.55)]",
      tag: `${t("how.stepTag")} 02`,
      tagBg: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    },
    {
      icon: LineChart,
      n: "03",
      title: t("how.step3Title"),
      text: t("how.step3Text"),
      accent: "from-violet-500 to-fuchsia-500",
      ring: "ring-violet-100",
      glow: "shadow-[0_18px_40px_-18px_rgba(139,92,246,0.55)]",
      tag: `${t("how.stepTag")} 03`,
      tagBg: "bg-violet-50 text-violet-700 ring-violet-100",
    },
  ];
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/60 to-white py-24 sm:py-28">
      {/* Decorative background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-100/40 via-transparent to-violet-100/40 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            {t("how.eyebrow")}
          </span>
          <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-[2.7rem] md:leading-[1.1]">
            {t("how.titleA")}{" "}
            <span className="bg-gradient-to-r from-blue-600 via-emerald-600 to-violet-600 bg-clip-text text-transparent">
              {t("how.titleHighlight")}
            </span>{" "}
            {t("how.titleB")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-slate-600 sm:text-lg">
            {t("how.subtitle")}
          </p>
        </div>

        <div className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-7">
          {/* Connector line on desktop */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-[12%] right-[12%] top-[68px] hidden md:block"
          >
            <div className="relative h-px w-full bg-gradient-to-r from-blue-200 via-emerald-200 to-violet-200">
              <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-blue-400" />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400" />
              <span className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-violet-400" />
            </div>
          </div>

          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <div className="group relative flex h-full flex-col rounded-3xl border border-slate-200/80 bg-white/95 p-7 backdrop-blur shadow-[0_18px_44px_-26px_rgba(15,23,42,0.22)] transition-all duration-300 hover:-translate-y-1.5 hover:border-slate-300 hover:shadow-[0_30px_60px_-26px_rgba(15,23,42,0.32)] sm:p-8">
                {/* Big watermark number */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-5 top-3 select-none text-[72px] font-black leading-none tracking-tight text-slate-100 transition-colors group-hover:text-slate-150"
                >
                  {s.n}
                </span>

                {/* Icon medallion */}
                <div className="relative">
                  <span
                    className={cn(
                      "relative grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white ring-4 transition-transform duration-300 group-hover:scale-105",
                      s.accent,
                      s.ring,
                      s.glow,
                    )}
                  >
                    <s.icon className="h-6 w-6" strokeWidth={2.2} />
                  </span>
                </div>

                <span
                  className={cn(
                    "mt-5 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ring-1",
                    s.tagBg,
                  )}
                >
                  {s.tag}
                </span>

                <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-900">{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{s.text}</p>

                {/* Mobile connector arrow (between cards) */}
                {i < steps.length - 1 && (
                  <div
                    aria-hidden
                    className="absolute -bottom-7 left-1/2 -translate-x-1/2 md:hidden"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm">
                      <ArrowRight className="h-3.5 w-3.5 rotate-90" />
                    </span>
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        {/* Footer line */}
        <p className="mx-auto mt-14 flex max-w-fit items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-[12.5px] text-slate-600 shadow-sm backdrop-blur">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          {t("how.footer")}
        </p>
      </div>
    </section>
  );
}

/* ============================== WHY US ============================== */

function WhyUs() {
  const { t } = useTranslation("landing");
  const cards = [
    { icon: LayoutDashboard, title: t("why.c1Title"), text: t("why.c1Text"), tone: "blue" },
    { icon: Eye, title: t("why.c2Title"), text: t("why.c2Text"), tone: "emerald" },
    { icon: CreditCard, title: t("why.c3Title"), text: t("why.c3Text"), tone: "violet" },
    { icon: Target, title: t("why.c4Title"), text: t("why.c4Text"), tone: "rose" },
    { icon: Bell, title: t("why.c5Title"), text: t("why.c5Text"), tone: "amber" },
    { icon: Bot, title: t("why.c6Title"), text: t("why.c6Text"), tone: "sky" },
  ] as const;

  const toneMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
  };

  return (
    <section id="recursos" className="bg-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t("why.eyebrow")}
          title={t("why.title")}
          subtitle={t("why.subtitle")}
        />
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.05}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-1 hover:shadow-[0_24px_48px_-22px_rgba(15,23,42,0.28)]">
                <span
                  className={cn(
                    "mb-4 inline-grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-110",
                    toneMap[c.tone],
                  )}
                >
                  <c.icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-bold text-slate-900">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== SCREENS / TABS ============================== */

type ScreenKey = "dashboard" | "gastos" | "cartoes" | "metas" | "investimentos" | "guardado";

const SCREENS: { key: ScreenKey; label: string; icon: typeof LayoutDashboard; desc: string }[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    desc: "Uma visão geral do seu mês, com saldo, receitas, despesas, contas a pagar, alertas e resumo financeiro.",
  },
  {
    key: "gastos",
    label: "Gastos",
    icon: Receipt,
    desc: "Organize seus gastos por mês de referência, categoria, forma de pagamento e período, com filtros claros e fáceis de usar.",
  },
  {
    key: "cartoes",
    label: "Cartões",
    icon: CreditCard,
    desc: "Acompanhe faturas, compras, limite, fechamento, vencimento e status de pagamento.",
  },
  {
    key: "metas",
    label: "Metas",
    icon: Target,
    desc: "Crie objetivos financeiros, acompanhe o progresso e veja quanto ainda falta para chegar lá.",
  },
  {
    key: "investimentos",
    label: "Investimentos",
    icon: TrendingUp,
    desc: "Tenha uma área preparada para acompanhar sua evolução patrimonial e organizar seus investimentos.",
  },
  {
    key: "guardado",
    label: "Guardado",
    icon: PiggyBank,
    desc: "Registre valores reservados em bancos ou carteiras e acompanhe quanto você realmente tem guardado.",
  },
];

const SCREEN_HIGHLIGHTS: Record<ScreenKey, string[]> = {
  dashboard: [
    "Saldo, receitas e despesas",
    "Fluxo do mês em gráfico",
    "Limite inteligente",
    "Alertas e calendário",
  ],
  gastos: [
    "Filtro por mês de referência",
    "Categorias e formas de pagamento",
    "Total e média do mês",
    "Lista clara e organizada",
  ],
  cartoes: [
    "Cartão visual com limite",
    "Fatura aberta e vencimento",
    "Compras e parcelas",
    "Marcar fatura como paga",
  ],
  metas: [
    "Capa visual da meta",
    "Progresso animado",
    "Quanto falta para concluir",
    "Histórico de aportes",
  ],
  investimentos: [
    "Carteira total e variação",
    "Gráfico de crescimento",
    "Distribuição por classe",
    "Resumo visual rápido",
  ],
  guardado: [
    "Total reservado",
    "Valor por banco e carteira",
    "Visual seguro e limpo",
    "Acompanhamento mensal",
  ],
};

function ScreensTabs() {
  const { t } = useTranslation("landing");
  const [active, setActive] = useState<ScreenKey>("dashboard");
  const labelMap: Record<ScreenKey, string> = {
    dashboard: t("screens.dashboard"),
    gastos: t("screens.gastos"),
    cartoes: t("screens.cartoes"),
    metas: t("screens.metas"),
    investimentos: t("screens.investimentos"),
    guardado: t("screens.guardado"),
  };
  const descMap: Record<ScreenKey, string> = {
    dashboard: t("screens.dashboardDesc"),
    gastos: t("screens.gastosDesc"),
    cartoes: t("screens.cartoesDesc"),
    metas: t("screens.metasDesc"),
    investimentos: t("screens.investimentosDesc"),
    guardado: t("screens.guardadoDesc"),
  };
  const current = SCREENS.find((s) => s.key === active)!;
  const highlights = t(`screens.highlights.${active}`, { returnObjects: true }) as string[];

  return (
    <section
      id="como-funciona"
      className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white py-20 sm:py-24"
    >
      {/* soft background accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 80% 0%, rgba(16,185,129,0.08), transparent 60%), radial-gradient(50% 50% at 10% 100%, rgba(59,130,246,0.08), transparent 60%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t("screens.eyebrow")}
          title={t("screens.title")}
          subtitle={t("screens.subtitle")}
        />

        {/* tabs — pill rail with sliding indicator */}
        <div className="mt-10 flex justify-center">
          <div className="no-scrollbar flex w-full max-w-3xl snap-x snap-mandatory gap-1 overflow-x-auto rounded-full border border-slate-200 bg-white/80 p-1 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.25)] backdrop-blur md:w-auto">
            {SCREENS.map((s) => {
              const Icon = s.icon;
              const isActive = s.key === active;
              return (
                <button
                  key={s.key}
                  onClick={() => setActive(s.key)}
                  className={cn(
                    "snap-start relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    isActive ? "text-white" : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="screen-tab-pill"
                      className="absolute inset-0 -z-0 rounded-full bg-gradient-to-r from-slate-900 to-slate-700 shadow-[0_10px_22px_-12px_rgba(15,23,42,0.55)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon className="relative z-10 h-4 w-4" />
                  <span className="relative z-10">{labelMap[s.key]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* preview */}
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={active + "-text"}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.35 }}
              className="lg:col-span-5"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <current.icon className="h-3.5 w-3.5 text-slate-700" />
                {labelMap[active]}
              </span>
              <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {labelMap[active]}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{descMap[active]}</p>
              <ul className="mt-5 space-y-2">
                {highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check className="h-3 w-3" />
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/cadastro"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                {t("screens.cta")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </motion.div>
          </AnimatePresence>

          <div className="relative lg:col-span-7">
            {/* decorative blob */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-blue-100/60 via-white to-emerald-100/60 blur-2xl"
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={active + "-mock"}
                initial={{ opacity: 0, y: 18, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.99 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <ScreenMock keyName={active} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScreenMock({ keyName }: { keyName: ScreenKey }) {
  const inner =
    keyName === "dashboard" ? (
      <HeroDashboardMock />
    ) : keyName === "gastos" ? (
      <GastosMock />
    ) : keyName === "cartoes" ? (
      <CartaoMock />
    ) : keyName === "metas" ? (
      <MetaMock />
    ) : keyName === "investimentos" ? (
      <InvestimentosMock />
    ) : (
      <GuardadoMock />
    );
  return <div className="mx-auto w-full max-w-[620px]">{inner}</div>;
}

/* ============================== DASHBOARD SHOWCASE ============================== */

function DashboardShowcase() {
  const { t } = useTranslation("landing");
  const bullets = t("dashboardShowcase.bullets", { returnObjects: true }) as string[];
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8">
        <Reveal className="lg:col-span-5">
          <Eyebrow>{t("dashboardShowcase.eyebrow")}</Eyebrow>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {t("dashboardShowcase.title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            {t("dashboardShowcase.text")}
          </p>
          <ul className="mt-6 space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {b}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className="lg:col-span-7" delay={0.1}>
          <HeroDashboardMock />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================== FEATURE SPLIT ============================== */

function FeatureSplit({
  eyebrow,
  title,
  text,
  bullets,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  text: string;
  bullets: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative py-20 sm:py-28",
        reverse ? "bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40" : "bg-white",
      )}
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8">
        <Reveal className={cn("lg:col-span-5", reverse && "lg:order-2")}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">{text}</p>
          <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {b}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className={cn("lg:col-span-7", reverse && "lg:order-1")} delay={0.1}>
          {visual}
        </Reveal>
      </div>
    </section>
  );
}

/* ============================== MOCKS ============================== */

function MockShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_36px_70px_-30px_rgba(15,23,42,0.32)]">
      <div className="rounded-[22px] border border-slate-200/70 bg-white p-4 sm:p-5">
        {children}
      </div>
    </div>
  );
}

function GastosMock() {
  const { t } = useTranslation("landing");
  const items = [
    {
      c: t("mockup.gastos.items.market"),
      avatarKey: "Mercado",
      v: "R$ 340,90",
      t: t("mockup.gastos.when.today"),
    },
    {
      c: t("mockup.gastos.items.restaurant"),
      avatarKey: "Restaurante",
      v: "R$ 78,50",
      t: t("mockup.gastos.when.yesterday"),
    },
    {
      c: t("mockup.gastos.items.transport"),
      avatarKey: "Transporte",
      v: "R$ 24,00",
      t: t("mockup.gastos.when.daysAgo", { n: 2 }),
    },
    {
      c: t("mockup.gastos.items.subscription"),
      avatarKey: "Assinatura",
      v: "R$ 39,90",
      t: t("mockup.gastos.when.daysAgo", { n: 3 }),
    },
  ];
  const filters = [
    t("mockup.gastos.filterDate"),
    t("mockup.gastos.filterCategory"),
    t("mockup.gastos.filterPix"),
    t("mockup.gastos.filterCard"),
  ];
  return (
    <MockShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.gastos.eyebrow")}
          </p>
          <p className="text-base font-bold text-slate-900">R$ 3.277,20</p>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 sm:flex-wrap sm:justify-end sm:overflow-visible">
          {filters.map((p, i) => (
            <span
              key={p}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                i === 0
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {i === 0 && <Calendar className="h-3 w-3" />}
              {p}
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
        {items.map((it) => (
          <li key={it.c} className="flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-3">
              <TransactionAvatar estabelecimento={it.avatarKey} size="sm" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{it.c}</p>
                <p className="text-[11px] text-slate-500">{it.t}</p>
              </div>
            </div>
            <p className="text-sm font-bold tabular-nums text-slate-900">{it.v}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.gastos.total")}
          </p>
          <p className="text-sm font-bold tabular-nums text-slate-900">R$ 3.277,20</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.gastos.average")}
          </p>
          <p className="text-sm font-bold tabular-nums text-slate-900">R$ 109,24</p>
        </div>
      </div>
    </MockShell>
  );
}

function CartaoMock() {
  const { t } = useTranslation("landing");
  const purchases = [
    { c: "Spotify", v: "R$ 21,90", t: t("mockup.card.purchases.spotify") },
    { c: "iFood", v: "R$ 64,80", t: t("mockup.card.purchases.ifood") },
    { c: "Posto Shell", v: "R$ 180,00", t: t("mockup.card.purchases.shell") },
  ];
  return (
    <MockShell>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-5 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 h-40 w-40 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(59,130,246,0.45), transparent 70%)" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-12 -left-10 h-36 w-36 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(16,185,129,0.30), transparent 70%)" }}
        />
        <div className="relative flex items-center justify-between">
          <p className="text-xs font-semibold opacity-80">{t("mockup.card.name")}</p>
          <CreditCard className="h-5 w-5 opacity-80" />
        </div>
        {/* chip */}
        <div className="relative mt-5 flex items-center gap-3">
          <div className="h-7 w-9 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner ring-1 ring-amber-100/40" />
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-widest opacity-60">
              {t("mockup.card.contactless")}
            </span>
          </div>
        </div>
        <p className="relative mt-3 font-mono text-base tracking-widest opacity-90">
          •••• •••• •••• 4218
        </p>
        <div className="relative mt-4 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-70">
              {t("mockup.card.limitAvailable")}
            </p>
            <p className="text-lg font-bold tabular-nums">R$ 4.820,00</p>
            <p className="mt-0.5 text-[10px] opacity-60">{t("mockup.card.ofTotal")}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider opacity-70">
              {t("mockup.card.due")}
            </p>
            <p className="text-sm font-semibold">15/12</p>
            <p className="text-[10px] opacity-60">VISA</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">{t("mockup.card.openInvoice")}</p>
          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {t("mockup.card.dueShort")}
          </span>
        </div>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">R$ 1.180,00</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: "42%" }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">{t("mockup.card.limitUsed")}</p>

        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {purchases.map((p) => (
            <li key={p.c} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2.5">
                <TransactionAvatar estabelecimento={p.c} size="sm" className="h-7 w-7" />
                <div>
                  <p className="text-xs font-semibold text-slate-900">{p.c}</p>
                  <p className="text-[10px] text-slate-500">{p.t}</p>
                </div>
              </div>
              <p className="text-xs font-bold tabular-nums text-slate-900">{p.v}</p>
            </li>
          ))}
        </ul>

        <button className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("mockup.card.markPaid")}
        </button>
      </div>
    </MockShell>
  );
}

function MetaCover({ kind }: { kind: "apartment" | "beach" | "car" | "reserve" }) {
  if (kind === "apartment") {
    return (
      <svg
        viewBox="0 0 600 220"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="apt-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="55%" stopColor="#fda4af" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="apt-b1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id="apt-b2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
        </defs>
        <rect width="600" height="220" fill="url(#apt-sky)" />
        {/* sun */}
        <circle cx="470" cy="80" r="38" fill="#fff7ed" opacity="0.95" />
        <circle cx="470" cy="80" r="56" fill="#fef3c7" opacity="0.35" />
        {/* distant skyline */}
        <g opacity="0.55" fill="#1e3a8a">
          <rect x="20" y="130" width="40" height="60" />
          <rect x="65" y="118" width="30" height="72" />
          <rect x="100" y="135" width="36" height="55" />
          <rect x="500" y="125" width="32" height="65" />
          <rect x="540" y="110" width="40" height="80" />
        </g>
        {/* main building */}
        <rect x="200" y="60" width="120" height="160" fill="url(#apt-b1)" rx="3" />
        <rect x="195" y="55" width="130" height="10" fill="#0f172a" rx="2" />
        {/* windows lit */}
        <g fill="#fbbf24">
          {Array.from({ length: 6 }).map((_, r) =>
            Array.from({ length: 4 }).map((_, c) => {
              const lit = (r + c) % 3 !== 0;
              return (
                <rect
                  key={`${r}-${c}`}
                  x={210 + c * 26}
                  y={75 + r * 22}
                  width="16"
                  height="13"
                  rx="1.5"
                  fill={lit ? "#fde68a" : "#475569"}
                  opacity={lit ? 0.95 : 0.55}
                />
              );
            }),
          )}
        </g>
        {/* side building */}
        <rect x="330" y="100" width="90" height="120" fill="url(#apt-b2)" rx="3" />
        <g fill="#fde68a" opacity="0.85">
          {Array.from({ length: 5 }).map((_, r) =>
            Array.from({ length: 3 }).map((_, c) => (
              <rect
                key={`s-${r}-${c}`}
                x={340 + c * 24}
                y={112 + r * 20}
                width="14"
                height="11"
                rx="1.5"
              />
            )),
          )}
        </g>
        {/* small left building */}
        <rect x="140" y="120" width="55" height="100" fill="#0f172a" rx="3" />
        <g fill="#fde68a" opacity="0.85">
          {Array.from({ length: 4 }).map((_, r) =>
            Array.from({ length: 2 }).map((_, c) => (
              <rect
                key={`l-${r}-${c}`}
                x={150 + c * 20}
                y={130 + r * 22}
                width="12"
                height="11"
                rx="1.5"
              />
            )),
          )}
        </g>
        {/* ground */}
        <rect x="0" y="200" width="600" height="20" fill="#0f172a" opacity="0.6" />
      </svg>
    );
  }
  if (kind === "beach") {
    return (
      <svg
        viewBox="0 0 600 220"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="b-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <linearGradient id="b-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#1e40af" />
          </linearGradient>
        </defs>
        <rect width="600" height="220" fill="url(#b-sky)" />
        <circle cx="450" cy="80" r="40" fill="#fff7ed" />
        <path d="M0,140 Q150,118 300,138 T600,134 L600,180 L0,180 Z" fill="url(#b-sea)" />
        <path d="M0,178 L600,178 L600,220 L0,220 Z" fill="#fde68a" />
      </svg>
    );
  }
  if (kind === "car") {
    return (
      <svg
        viewBox="0 0 600 220"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="c-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <rect width="600" height="220" fill="url(#c-sky)" />
        <rect x="0" y="160" width="600" height="60" fill="#1f2937" />
        <path d="M120 150 L200 110 L380 110 L460 150 L460 175 L120 175 Z" fill="#0f172a" />
        <rect x="200" y="120" width="170" height="30" rx="6" fill="#3b82f6" opacity="0.85" />
        <circle cx="180" cy="178" r="22" fill="#0f172a" stroke="#cbd5e1" strokeWidth="3" />
        <circle cx="400" cy="178" r="22" fill="#0f172a" stroke="#cbd5e1" strokeWidth="3" />
      </svg>
    );
  }
  // reserve / piggy
  return (
    <svg
      viewBox="0 0 600 220"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="r-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
      </defs>
      <rect width="600" height="220" fill="url(#r-bg)" />
      <g opacity="0.18" fill="#fff">
        <circle cx="80" cy="60" r="40" />
        <circle cx="520" cy="170" r="60" />
        <circle cx="300" cy="40" r="20" />
      </g>
      <g transform="translate(225,60)">
        <ellipse cx="75" cy="70" rx="80" ry="55" fill="#fbbf24" />
        <circle cx="125" cy="55" r="10" fill="#0f172a" />
        <rect
          x="20"
          y="20"
          width="50"
          height="14"
          rx="3"
          fill="#fbbf24"
          transform="rotate(-12,45,27)"
        />
        <rect
          x="55"
          y="25"
          width="6"
          height="3"
          rx="1"
          fill="#0f172a"
          transform="rotate(-12,45,27)"
        />
        <rect x="45" y="120" width="10" height="20" fill="#f59e0b" />
        <rect x="95" y="120" width="10" height="20" fill="#f59e0b" />
        <circle cx="140" cy="48" r="2.5" fill="#0f172a" />
      </g>
    </svg>
  );
}

function MetaMock() {
  const { t } = useTranslation("landing");
  // Featured goal — emotional, easy to read
  const guardado = 1050;
  const objetivo = 10000;
  const pct = Math.round((guardado / objetivo) * 100);
  const falta = objetivo - guardado;

  const otherGoals: {
    name: string;
    pct: number;
    saved: string;
    cover: "beach" | "car" | "reserve";
  }[] = [
    { name: t("mockup.meta.names.beach"), pct: 68, saved: "R$ 3.400", cover: "beach" },
    { name: t("mockup.meta.names.car"), pct: 32, saved: "R$ 8.000", cover: "car" },
    { name: t("mockup.meta.names.reserve"), pct: 84, saved: "R$ 8.400", cover: "reserve" },
  ];

  return (
    <MockShell>
      {/* Featured goal card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-26px_rgba(15,23,42,0.30)]">
        {/* Cover */}
        <div className="relative h-40 w-full overflow-hidden">
          <MetaCover kind="apartment" />
          {/* subtle gradient overlay for legibility */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, rgba(15,23,42,0) 50%, rgba(15,23,42,0.45) 100%)",
            }}
          />
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-blue-700 backdrop-blur">
            <Target className="h-3 w-3" /> {t("mockup.meta.active")}
          </div>
          <div className="absolute bottom-2 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur">
            <Calendar className="h-3 w-3" /> {t("mockup.meta.monthYear")}
          </div>
          <div className="absolute bottom-2 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-bold text-white shadow">
            <TrendingUp className="h-3 w-3" /> {pct}%
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.meta.eyebrow")}
          </p>
          <h4 className="mt-0.5 text-lg font-bold text-slate-900">{t("mockup.meta.title")}</h4>

          {/* Saved + total */}
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-medium text-slate-500">{t("mockup.meta.saved")}</p>
              <p className="text-2xl font-extrabold tabular-nums text-slate-900">
                R$ {guardado.toLocaleString("pt-BR")},00
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium text-slate-500">{t("mockup.meta.objective")}</p>
              <p className="text-sm font-bold tabular-nums text-slate-700">
                R$ {objetivo.toLocaleString("pt-BR")},00
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-3">
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${pct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-emerald-700">
                {t("mockup.meta.complete", { pct })}
              </span>
              <span className="text-slate-500">
                {t("mockup.meta.remaining")}{" "}
                <span className="font-semibold text-slate-700">
                  R$ {falta.toLocaleString("pt-BR")},00
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Other goals — variety */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.meta.otherGoals")}
          </p>
          <span className="text-[10px] font-medium text-slate-400">{t("mockup.meta.active3")}</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {otherGoals.map((g) => (
            <div
              key={g.name}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-transform hover:-translate-y-0.5"
            >
              <div className="relative h-12 w-full overflow-hidden sm:h-14">
                <MetaCover kind={g.cover} />
              </div>
              <div className="p-1.5 sm:p-2">
                <p className="line-clamp-1 text-[10px] font-semibold leading-tight text-slate-800 sm:text-[11px]">
                  {g.name}
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${g.pct}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-1 text-[9px] text-slate-500">
                  <span className="truncate">{g.saved}</span>
                  <span className="font-semibold text-emerald-700">{g.pct}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockShell>
  );
}

function ContasConectadasMock() {
  const contas = [
    {
      nome: "Maria Silva",
      email: "maria@exemplo.com",
      nivel: "Administrador",
      cor: "#10b981",
      iniciais: "MS",
      status: "Aceito",
    },
    {
      nome: "João Pereira",
      email: "joao@exemplo.com",
      nivel: "Ver e lançar",
      cor: "#3b82f6",
      iniciais: "JP",
      status: "Aceito",
    },
    {
      nome: "Contador",
      email: "contador@escritorio.com",
      nivel: "Somente ver",
      cor: "#a855f7",
      iniciais: "CT",
      status: "Pendente",
    },
  ];
  return (
    <MockShell>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Contas conectadas
          </p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">3 pessoas</p>
          <p className="mt-0.5 text-[11px] text-slate-500">com acesso à sua conta</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          + Convidar
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {contas.map((c) => (
          <div
            key={c.email}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5"
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: c.cor }}
            >
              {c.iniciais}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{c.nome}</p>
              <p className="truncate text-[11px] text-slate-500">{c.email}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                {c.nivel}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  c.status === "Aceito" ? "text-emerald-600" : "text-amber-600",
                )}
              >
                {c.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function InvestimentosMock() {
  const { t } = useTranslation("landing");
  const classes = [
    { l: t("mockup.invest.fixed"), v: "R$ 22,4k", pct: 46, color: "#10b981", chip: "+1,8%" },
    { l: t("mockup.invest.stocks"), v: "R$ 14,1k", pct: 29, color: "#3b82f6", chip: "+6,4%" },
    { l: t("mockup.invest.funds"), v: "R$ 11,8k", pct: 25, color: "#a855f7", chip: "+2,1%" },
  ];
  return (
    <MockShell>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.invest.wallet")}
          </p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 48.320,90</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{t("mockup.invest.totalAssets")}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <ArrowUpRight className="h-3.5 w-3.5" /> +4,2%
          </span>
          <span className="text-[10px] font-medium text-slate-400">
            {t("mockup.invest.vsLastMonth")}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-emerald-50/40 to-white p-3">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span>{t("mockup.invest.evolution")}</span>
          <span className="text-emerald-600">+R$ 1.940</span>
        </div>
        <svg viewBox="0 0 300 100" className="mt-1 h-28 w-full">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,80 L25,72 L50,76 L75,60 L100,64 L125,50 L150,55 L175,40 L200,46 L225,30 L250,36 L275,22 L300,18 L300,100 L0,100 Z"
            fill="url(#lg)"
          />
          <motion.path
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            d="M0,80 L25,72 L50,76 L75,60 L100,64 L125,50 L150,55 L175,40 L200,46 L225,30 L250,36 L275,22 L300,18"
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="300" cy="18" r="4" fill="#10b981" />
          <circle cx="300" cy="18" r="8" fill="#10b981" opacity="0.25" />
        </svg>
      </div>

      {/* allocation bar */}
      <div className="mt-3">
        <div className="flex h-2 overflow-hidden rounded-full">
          {classes.map((c) => (
            <div key={c.l} style={{ width: `${c.pct}%`, background: c.color }} />
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
        {classes.map((c) => (
          <div key={c.l} className="rounded-xl border border-slate-100 bg-slate-50 p-2 sm:p-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className="flex min-w-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[10px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate">{c.l}</span>
              </span>
              <span className="shrink-0 text-[9px] font-bold text-emerald-600">{c.chip}</span>
            </div>
            <p className="mt-1 text-xs font-bold tabular-nums text-slate-900 sm:text-sm">{c.v}</p>
            <p className="text-[9px] text-slate-500 sm:text-[10px]">
              {t("mockup.invest.ofPortfolio", { pct: c.pct })}
            </p>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function GuardadoMock() {
  const { t } = useTranslation("landing");
  const items = [
    {
      l: "Nubank",
      v: "R$ 2.100",
      pct: 43,
      logo: "/logos/bancos/nubank.svg",
      brand: "#820ad1",
      initial: "N",
      bar: "bg-violet-500",
      logoBg: "#fff" as string | null,
    },
    {
      l: "Inter",
      v: "R$ 1.480",
      pct: 30,
      logo: "/logos/bancos/banco-inter.svg",
      brand: "#ff7a00",
      initial: "I",
      bar: "bg-amber-500",
      logoBg: "#ff7a00" as string | null,
    },
    {
      l: "C6 Bank",
      v: "R$ 980",
      pct: 20,
      logo: "/logos/bancos/Logo_C6_Bank.svg",
      brand: "#1f1f1f",
      initial: "C6",
      bar: "bg-slate-700",
      logoBg: "#1f1f1f" as string | null,
    },
    {
      l: t("mockup.guardado.wallet"),
      v: "R$ 320",
      pct: 7,
      logo: null as string | null,
      brand: "#10b981",
      initial: "💵",
      bar: "bg-emerald-500",
      logoBg: null as string | null,
    },
  ];
  return (
    <MockShell>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.guardado.totalSaved")}
          </p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 4.880,00</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{t("mockup.guardado.reservesIn")}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" /> {t("mockup.guardado.secureReserve")}
        </span>
      </div>

      {/* distribution bar */}
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {items.map((it) => (
          <div key={it.l} className={cn("h-full", it.bar)} style={{ width: `${it.pct}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {items.map((it) => (
          <span key={it.l} className="inline-flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", it.bar)} />
            {it.l} · {it.pct}%
          </span>
        ))}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2.5">
        {items.map((it) => (
          <li
            key={it.l}
            className="rounded-xl border border-slate-200 bg-white p-3 transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(15,23,42,0.25)]"
          >
            <div className="flex items-center justify-between">
              <span
                className="grid h-9 w-9 place-items-center overflow-hidden rounded-full ring-1 ring-slate-200"
                style={{ background: it.logoBg ?? it.brand }}
                aria-hidden
              >
                {it.logo ? (
                  <img
                    src={it.logo}
                    alt={it.l}
                    draggable={false}
                    className="h-6 w-6 object-contain"
                  />
                ) : (
                  <span className="text-sm font-bold text-white">{it.initial}</span>
                )}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">{it.pct}%</span>
            </div>
            <p className="mt-2 text-xs font-medium text-slate-500">{it.l}</p>
            <p className="text-sm font-bold tabular-nums text-slate-900">{it.v}</p>
          </li>
        ))}
      </ul>
    </MockShell>
  );
}

/* ============================== MORE FEATURES (compact) ============================== */

function MoreFeatures() {
  const { t } = useTranslation("landing");
  const items = [
    {
      icon: SlidersHorizontal,
      title: t("more.i1Title"),
      text: t("more.i1Text"),
      tone: "from-blue-50 to-blue-100/40 text-blue-700 ring-blue-100",
    },
    {
      icon: Target,
      title: t("more.i2Title"),
      text: t("more.i2Text"),
      tone: "from-emerald-50 to-emerald-100/40 text-emerald-700 ring-emerald-100",
    },
    {
      icon: TrendingUp,
      title: t("more.i3Title"),
      text: t("more.i3Text"),
      tone: "from-violet-50 to-violet-100/40 text-violet-700 ring-violet-100",
    },
    {
      icon: UserPlus,
      title: t("more.i4Title"),
      text: t("more.i4Text"),
      tone: "from-amber-50 to-amber-100/40 text-amber-700 ring-amber-100",
    },
  ];

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/50 to-white py-16 sm:py-20">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{t("more.eyebrow")}</Eyebrow>
          <h2 className="mt-3 text-[1.65rem] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            {t("more.title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">{t("more.subtitle")}</p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {items.map((it, i) => (
            <Reveal key={it.title} delay={i * 0.05}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_18px_36px_-16px_rgba(15,23,42,0.25)]">
                <div
                  className={cn(
                    "mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ring-1",
                    it.tone,
                  )}
                >
                  <it.icon className="h-5 w-5" />
                </div>
                <h3 className="text-[15px] font-semibold text-slate-900">{it.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{it.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== EMPRESA INTELIGENTE ============================== */

function EmpresaInteligenteSection() {
  const { t } = useTranslation("landing");
  const cards = [
    {
      icon: Building2,
      title: t("empresa.c1Title"),
      text: t("empresa.c1Text"),
      tone: "from-emerald-50 to-emerald-100/40 text-emerald-700 ring-emerald-100",
    },
    {
      icon: Users,
      title: t("empresa.c2Title"),
      text: t("empresa.c2Text"),
      tone: "from-violet-50 to-violet-100/40 text-violet-700 ring-violet-100",
    },
    {
      icon: LineChart,
      title: t("empresa.c3Title"),
      text: t("empresa.c3Text"),
      tone: "from-sky-50 to-sky-100/40 text-sky-700 ring-sky-100",
    },
    {
      icon: ClipboardList,
      title: t("empresa.c4Title"),
      text: t("empresa.c4Text"),
      tone: "from-amber-50 to-amber-100/40 text-amber-700 ring-amber-100",
    },
    {
      icon: Activity,
      title: t("empresa.c5Title"),
      text: t("empresa.c5Text"),
      tone: "from-rose-50 to-rose-100/40 text-rose-700 ring-rose-100",
    },
  ];

  const trust = [
    { icon: ShieldCheck, title: t("empresa.trust1Title"), text: t("empresa.trust1Text") },
    { icon: Landmark, title: t("empresa.trust2Title"), text: t("empresa.trust2Text") },
    { icon: Cloud, title: t("empresa.trust3Title"), text: t("empresa.trust3Text") },
  ];

  return (
    <section id="mei-empresa" className="relative overflow-hidden bg-white py-20 sm:py-28">
      {/* soft refined gradient accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/3 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-teal-100/50 via-emerald-50/30 to-transparent blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-32 h-[26rem] w-[26rem] rounded-full bg-gradient-to-br from-violet-100/40 via-indigo-50/20 to-transparent blur-3xl"
      />
      {/* very subtle dotted grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 75%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
          {/* LEFT: copy + cards */}
          <div className="lg:col-span-7">
            <Reveal>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t("empresa.tag")}
              </span>
              <h2 className="mt-4 text-[1.9rem] font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-[2.6rem]">
                {t("empresa.titleA")}{" "}
                <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                  {t("empresa.titleHighlight")}
                </span>
                {t("empresa.titleB")}
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                {t("empresa.subtitle")}
              </p>
            </Reveal>

            {/* staggered cards */}
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cards.map((c, i) => (
                <Reveal
                  key={c.title}
                  delay={i * 0.06}
                  className={cn(i === 1 && "sm:translate-y-6", i === 3 && "sm:translate-y-6")}
                >
                  <div className="group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] backdrop-blur transition-all hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_22px_44px_-18px_rgba(15,23,42,0.28)]">
                    <div
                      className={cn(
                        "mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ring-1",
                        c.tone,
                      )}
                    >
                      <c.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-[15px] font-semibold text-slate-900">{c.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.text}</p>
                    <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-slate-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-600" />
                  </div>
                </Reveal>
              ))}
            </div>

            {/* trust row */}
            <Reveal delay={0.2}>
              <div className="mt-10 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4 backdrop-blur sm:grid-cols-3">
                {trust.map((t) => (
                  <div key={t.title} className="flex items-center gap-3 px-2">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                      <t.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                      <p className="truncate text-xs text-slate-500">{t.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* RIGHT: visual composition */}
          <div className="relative lg:col-span-5">
            <EmpresaVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

function EmpresaVisual() {
  const { t } = useTranslation("landing");
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-[560px] lg:aspect-auto lg:h-[680px]">
      {/* soft halo behind portrait */}
      <div
        aria-hidden
        className="absolute inset-x-8 top-4 bottom-12 rounded-[2.5rem] bg-gradient-to-br from-teal-100/50 via-white to-violet-100/40 blur-2xl"
      />

      {/* dotted curve accent */}
      <svg
        aria-hidden
        viewBox="0 0 400 600"
        className="absolute inset-0 h-full w-full text-slate-300/70"
        fill="none"
      >
        <path
          d="M30 540 C 130 460, 280 560, 380 440"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 6"
          strokeLinecap="round"
        />
      </svg>

      {/* portrait — large, centered, focal point */}
      <div className="absolute left-1/2 top-2 h-[92%] w-[80%] -translate-x-1/2 overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_30px_70px_-22px_rgba(15,23,42,0.32)] ring-1 ring-slate-200/60">
        <img
          src={empresaEntrepreneur}
          alt="Empreendedora sorrindo enquanto trabalha no notebook"
          loading="lazy"
          width={1024}
          height={1024}
          className="h-full w-full object-cover object-top"
        />
        <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-white/70 to-transparent" />
      </div>

      {/* Floating: Radar — small, top-right corner (away from face) */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="absolute right-0 top-6 hidden w-[170px] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.28)] backdrop-blur sm:block"
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("mockup.empresaFloating.radarTitle")}
          </span>
          <Activity className="h-3 w-3 text-slate-400" />
        </div>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {[
            { l: "Dólar", v: "5,12", up: false },
            { l: "Euro", v: "5,58", up: true },
            { l: "Selic", v: "10,75%", up: false },
            { l: "IPCA", v: "4,21%", up: true },
          ].map((r) => (
            <li key={r.l} className="flex items-center justify-between">
              <span className="text-slate-500">{r.l}</span>
              <span
                className={cn(
                  "flex items-center gap-0.5 font-semibold",
                  r.up ? "text-emerald-600" : "text-rose-500",
                )}
              >
                {r.v}
                {r.up ? (
                  <ArrowUpRight className="h-2.5 w-2.5" />
                ) : (
                  <ArrowDownRight className="h-2.5 w-2.5" />
                )}
              </span>
            </li>
          ))}
        </ul>
      </motion.div>

      {/* Floating: Overview — left side, mid-height (below face area) */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="absolute -left-2 top-[44%] w-[220px] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.28)] backdrop-blur"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t("mockup.empresaFloating.monthSummary")}
          </span>
          <LayoutDashboard className="h-3.5 w-3.5 text-slate-400" />
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <Row
            label={t("mockup.empresaFloating.incomeLabel")}
            value="R$ 28.560"
            trend="up"
            delta="+12%"
          />
          <Row
            label={t("mockup.empresaFloating.expensesLabel")}
            value="R$ 16.230"
            trend="down"
            delta="-4%"
          />
          <div className="my-2 border-t border-dashed border-slate-200" />
          <div className="flex items-center justify-between">
            <span className="text-slate-600">{t("mockup.empresaFloating.balanceLabel")}</span>
            <span className="font-bold text-emerald-600">R$ 12.330</span>
          </div>
        </div>
      </motion.div>

      {/* Floating: Contas a receber — right side, lower (below face) */}
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.18 }}
        className="absolute -right-2 top-[62%] w-[200px] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.28)] backdrop-blur"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
            {t("mockup.empresaFloating.toReceive")}
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <p className="mt-2 text-lg font-bold text-slate-900">R$ 14.980</p>
        <p className="text-xs text-slate-500">{t("mockup.empresaFloating.openTitles")}</p>
        <MiniChart color="emerald" points={[6, 9, 7, 12, 10, 14, 13, 16]} />
      </motion.div>

      {/* Floating: Pacote para Contador — bottom center, anchors composition */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.28 }}
        className="absolute left-1/2 bottom-0 w-[280px] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.4)] backdrop-blur"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t("mockup.empresaFloating.accountantPackage")}
            </p>
            <p className="text-sm font-semibold text-slate-900">Outubro/2025</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
            {t("mockup.empresaFloating.packageReady")}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          {t("mockup.empresaFloating.packageDesc")}
        </p>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  value,
  trend,
  delta,
}: {
  label: string;
  value: string;
  trend: "up" | "down";
  delta: string;
}) {
  const up = trend === "up";
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-semibold text-slate-900">{value}</span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600",
          )}
        >
          {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {delta}
        </span>
      </span>
    </div>
  );
}

function MiniChart({ color, points }: { color: "emerald" | "violet"; points: number[] }) {
  const w = 170;
  const h = 36;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = Math.max(1, max - min);
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const stroke = color === "emerald" ? "#059669" : "#7c3aed";
  const fill = color === "emerald" ? "#10b98122" : "#8b5cf622";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-9 w-full">
      <path d={area} fill={fill} />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ============================== FOR WHO ============================== */

function ForWho() {
  const { t } = useTranslation("landing");
  const items = t("forWho.items", { returnObjects: true }) as string[];
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t("forWho.eyebrow")}
          title={t("forWho.title")}
          subtitle={t("forWho.subtitle")}
        />
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((it, i) => (
            <Reveal key={it} delay={i * 0.04}>
              <div className="flex h-full items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.22)]">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                  <Check className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-slate-800">{it}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== TRUST POINTS ============================== */

function TrustPoints() {
  const { t } = useTranslation("landing");
  const points = t("trustPoints", { returnObjects: true }) as string[];
  return (
    <section className="bg-slate-50 py-16">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap justify-center gap-2">
          {points.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== PLANS ============================== */

const PLAN_DESCRIPTIONS: Record<PlanTier, string> = {
  free: "",
  sem_assinatura: "",
  free_ads: "",
  pessoal_manual: "Para começar a organizar suas finanças pessoais com simplicidade.",
  pessoal_premium: "Vida financeira pessoal completa, com automação e mais recursos.",
  mei_essencial: "O essencial para o MEI manter contas, recibos e fluxo organizados.",
  mei_inteligente: "MEI com automação completa: ganhe tempo e tenha clareza total.",
  empresa: "Visão financeira completa para empresas que precisam de mais controle.",
  admin_master: "",
};

const PLAN_AUDIENCE: Record<PlanTier, { label: string; tone: string } | null> = {
  free: null,
  sem_assinatura: null,
  free_ads: null,
  pessoal_manual: { label: "Pessoa Física", tone: "bg-blue-50 text-blue-700 ring-blue-100" },
  pessoal_premium: { label: "Pessoa Física", tone: "bg-blue-50 text-blue-700 ring-blue-100" },
  mei_essencial: { label: "MEI", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  mei_inteligente: { label: "MEI", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  empresa: { label: "Empresa", tone: "bg-violet-50 text-violet-700 ring-violet-100" },
  admin_master: null,
};

const HIGHLIGHT: Partial<Record<PlanTier, { label: string; tone: "primary" | "emerald" }>> = {
  pessoal_premium: { label: "Mais escolhido", tone: "primary" },
  mei_inteligente: { label: "Recomendado MEI", tone: "emerald" },
};

const VISIBLE_HIGHLIGHTS = 5;

function FreeAdsPlanCard() {
  const { t } = useTranslation("landing");
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { storedPlan, status, loading: planLoading, isAdminMaster } = usePlan();
  const chooseFreeAds = useServerFn(chooseFreeAdsPlan);
  const [submitting, setSubmitting] = useState(false);
  const features = t("plans.freeAds.features", { returnObjects: true }) as string[];

  async function handleStartFree() {
    if (authLoading || planLoading || submitting) return;
    if (!user) {
      void navigate({ to: "/cadastro" });
      return;
    }
    if (storedPlan === "free_ads" && status === "ativo") {
      void navigate({ to: "/app" });
      return;
    }
    if (isAdminMaster) {
      void navigate({ to: "/meu-plano", hash: "planos-disponiveis" });
      return;
    }

    setSubmitting(true);
    try {
      const result = await chooseFreeAds();
      if (result.ok) {
        void navigate({ to: "/app" });
      } else if (result.reason === "paid_plan_active" || result.reason === "admin_master") {
        void navigate({ to: "/meu-plano", hash: "planos-disponiveis" });
      } else {
        toast.error(t("plans.freeAds.error"));
      }
    } catch {
      toast.error(t("plans.freeAds.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Reveal className="h-full">
      <div className="group relative flex h-full min-h-[520px] flex-col overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 via-white to-white px-5 py-6 text-slate-900 shadow-[0_10px_30px_-18px_rgba(15,118,110,0.2)] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-[0_22px_44px_-18px_rgba(15,118,110,0.28)] sm:px-6 xl:px-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-emerald-100/70 blur-2xl"
        />
        <div className="relative flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">
            {t("plans.freeAds.badge")}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            {t("plans.freeAds.adsLabel")}
          </span>
        </div>

        <h3 className="relative mt-3 text-base font-bold tracking-tight text-slate-900 lg:text-[1.0625rem]">
          {t("plans.freeAds.name")}
        </h3>
        <p className="relative mt-1 min-h-[34px] text-xs leading-snug text-slate-600">
          {t("plans.freeAds.subtitle")}
        </p>

        <div className="relative mt-3 flex items-baseline gap-1">
          <span className="text-[1.75rem] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums">
            {t("plans.freeAds.price")}
          </span>
          <span className="text-xs font-medium text-slate-500">/{t("plans.perMonth")}</span>
        </div>
        <p className="relative mt-0.5 text-[11px] text-emerald-700">
          {t("plans.freeAds.description")}
        </p>

        <div className="relative my-3 h-px w-full bg-gradient-to-r from-transparent via-emerald-200 to-transparent" />
        <ul className="relative space-y-1.5">
          {Array.isArray(features) &&
            features.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 text-[12.5px] leading-snug text-slate-700"
              >
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
                <span>{feature}</span>
              </li>
            ))}
        </ul>
        <p className="relative mt-3 text-[11px] leading-relaxed text-slate-500">
          {t("plans.freeAds.paidNote")}
        </p>
        <div className="flex-1" />
        <Button
          type="button"
          onClick={() => void handleStartFree()}
          disabled={authLoading || planLoading || submitting}
          className="relative mt-4 w-full rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          {submitting ? t("plans.freeAds.activating") : t("plans.freeAds.cta")}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Button>
      </div>
    </Reveal>
  );
}

function PlanCardItem({
  plan: p,
  index: i,
}: {
  plan: (typeof COMMERCIAL_PLANS)[number];
  index: number;
}) {
  const { t } = useTranslation("landing");
  const [expanded, setExpanded] = useState(false);
  const tag = HIGHLIGHT[p.tier];
  const featured = !!tag;
  const audience = PLAN_AUDIENCE[p.tier];
  const [priceMain] = p.priceLabel.split("/");
  const translatedHighlights = t(`plans.highlights.${p.tier}`, { returnObjects: true }) as string[];
  const highlightItems = Array.isArray(translatedHighlights) ? translatedHighlights : p.highlights;
  const hasMore = highlightItems.length > VISIBLE_HIGHLIGHTS;
  const visibleItems = expanded ? highlightItems : highlightItems.slice(0, VISIBLE_HIGHLIGHTS);
  const audienceLabel = audience
    ? audience.label === "Pessoa Física"
      ? t("plans.audiencePF")
      : audience.label === "MEI"
        ? t("plans.audienceMEI")
        : t("plans.audienceEmpresa")
    : "";
  const tagLabel = tag
    ? tag.label === "Mais escolhido"
      ? t("plans.highlightPremium")
      : t("plans.highlightMEI")
    : "";
  const description = t(`plans.descriptions.${p.tier}`, { defaultValue: "" }) as string;
  const planName = t(`plans.names.${p.tier}`, { defaultValue: p.name });

  return (
    <Reveal delay={i * 0.05} className="h-full">
      <div
        className={cn(
          "group relative flex h-full min-h-[520px] flex-col overflow-hidden rounded-3xl px-5 py-6 sm:px-6 sm:py-6 xl:px-5 xl:py-6 transition-all duration-300",
          featured
            ? "bg-gradient-to-b from-slate-900 to-slate-800 text-white shadow-[0_24px_60px_-22px_rgba(15,23,42,0.55)] ring-1 ring-white/5 hover:-translate-y-1 hover:shadow-[0_32px_70px_-22px_rgba(15,23,42,0.65)]"
            : "border border-slate-200 bg-white text-slate-900 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_22px_44px_-18px_rgba(15,23,42,0.25)]",
        )}
      >
        {featured && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-24 h-40 opacity-60"
            style={{
              background:
                tag!.tone === "primary"
                  ? "radial-gradient(60% 100% at 50% 100%, rgba(59,130,246,0.45), transparent 70%)"
                  : "radial-gradient(60% 100% at 50% 100%, rgba(16,185,129,0.45), transparent 70%)",
            }}
          />
        )}

        <div className="relative flex items-center justify-between gap-2">
          {audience ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1",
                featured ? "bg-white/10 text-white/90 ring-white/20" : audience.tone,
              )}
            >
              {audienceLabel}
            </span>
          ) : (
            <span />
          )}
          {tag && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                tag.tone === "primary"
                  ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/40"
                  : "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40",
              )}
            >
              <Sparkles className="h-3 w-3" />
              {tagLabel}
            </span>
          )}
        </div>

        <h3
          className={cn(
            "relative mt-3 text-base lg:text-[1.0625rem] font-bold tracking-tight",
            featured ? "text-white" : "text-slate-900",
          )}
        >
          {planName}
        </h3>
        <p
          className={cn(
            "relative mt-1 min-h-[34px] text-xs leading-snug",
            featured ? "text-slate-300" : "text-slate-500",
          )}
        >
          {description}
        </p>

        <div className="relative mt-3 flex items-baseline gap-1">
          <span
            className={cn(
              "text-[1.75rem] font-extrabold leading-none tracking-tight tabular-nums",
              featured ? "text-white" : "text-slate-900",
            )}
          >
            {priceMain.trim()}
          </span>
          <span
            className={cn("text-xs font-medium", featured ? "text-slate-400" : "text-slate-500")}
          >
            /{t("plans.perMonth")}
          </span>
        </div>
        <p
          className={cn(
            "relative mt-0.5 text-[11px]",
            featured ? "text-slate-400" : "text-slate-400",
          )}
        >
          {t("plans.cancelAnytime")}
        </p>

        <div
          className={cn(
            "relative my-3 h-px w-full",
            featured
              ? "bg-gradient-to-r from-transparent via-white/15 to-transparent"
              : "bg-gradient-to-r from-transparent via-slate-200 to-transparent",
          )}
        />

        <ul className="relative space-y-1.5">
          {visibleItems.map((h) => (
            <li
              key={h}
              className={cn(
                "flex items-start gap-2 text-[12.5px] leading-snug",
                featured ? "text-slate-200" : "text-slate-700",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                  featured
                    ? "bg-emerald-400/20 text-emerald-300"
                    : "bg-emerald-50 text-emerald-700",
                )}
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              <span>{h}</span>
            </li>
          ))}
        </ul>

        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "relative mt-2 self-start text-[11.5px] font-semibold underline-offset-2 hover:underline",
              featured ? "text-slate-300 hover:text-white" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {expanded ? t("plans.viewLess") : t("plans.viewAll", { count: highlightItems.length })}
          </button>
        )}

        <div className="flex-1" />

        <Link
          to="/cadastro"
          className={cn(
            "relative mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-all",
            featured
              ? "bg-white text-slate-900 hover:bg-slate-100"
              : "bg-slate-900 text-white hover:bg-slate-800",
          )}
        >
          {t("plans.choose")}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Reveal>
  );
}

function Plans() {
  const { t } = useTranslation("landing");
  return (
    <section
      id="planos"
      className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/40 to-white py-20 sm:py-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(50% 40% at 100% 0%, rgba(59,130,246,0.08), transparent 60%), radial-gradient(40% 40% at 0% 100%, rgba(16,185,129,0.08), transparent 60%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t("plans.eyebrow")}
          title={t("plans.title")}
          subtitle={t("plans.subtitle")}
          center
        />

        {/* audience chips (decorative legend) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700 ring-1 ring-blue-100">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> {t("plans.audiencePF")}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-100">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("plans.audienceMEI")}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-700 ring-1 ring-violet-100">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> {t("plans.audienceEmpresa")}
          </span>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm font-medium text-slate-600">
          {t("plans.freeOrPaid")}
        </p>

        <div className="mx-auto mt-10 grid max-w-md grid-cols-1 items-stretch gap-5 sm:max-w-3xl sm:grid-cols-2 sm:gap-6 lg:max-w-6xl lg:grid-cols-3 xl:max-w-[1380px] xl:grid-cols-5 xl:gap-4 2xl:gap-5">
          <FreeAdsPlanCard />
          {COMMERCIAL_PLANS.map((p, i) => (
            <PlanCardItem key={p.tier} plan={p} index={i + 1} />
          ))}
        </div>

        {/* Trust microcopy under plans */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> {t("plans.trustPay")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {t("plans.trustNoFid")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-emerald-600" /> {t("plans.trustImmediate")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-emerald-600" /> {t("plans.trustUpdates")}
          </span>
        </div>

        {/* Helper note */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-slate-500">
          {t("plans.helperA")}{" "}
          <a
            href="#duvidas"
            onClick={(e) => handleAnchorClick(e, "#duvidas")}
            className="font-semibold text-blue-700 underline-offset-2 hover:underline"
          >
            {t("plans.helperLink")}
          </a>{" "}
          {t("plans.helperB")}
        </p>
      </div>
    </section>
  );
}

/* ============================== BANKS STRIP ============================== */

const BANKS: { name: string; src: string; scale?: number }[] = [
  { name: "Nubank", src: "/logos/bancos/nubank.svg", scale: 1.85 },
  { name: "Inter", src: "/logos/bancos/inter.svg", scale: 1.05 },
  { name: "Mercado Pago", src: "/logos/bancos/mercado-pago.svg", scale: 1.7 },
  { name: "Caixa", src: "/logos/bancos/caixa.svg" },
  { name: "Banco do Brasil", src: "/logos/bancos/banco-do-brasil.svg" },
  { name: "Bradesco", src: "/logos/bancos/bradesco.svg" },
  { name: "Santander", src: "/logos/bancos/santander.svg", scale: 1.35 },
  { name: "PicPay", src: "/logos/bancos/picpay.svg" },
  { name: "Will Bank", src: "/logos/bancos/will-bank.svg", scale: 1.25 },
  { name: "C6 Bank", src: "/logos/bancos/c6-bank.svg" },
];

function BanksStrip() {
  const { t } = useTranslation("landing");
  const explainers = [
    {
      icon: CreditCard,
      tone: "from-blue-500 to-sky-500",
      title: t("banks.e1Title"),
      text: t("banks.e1Text"),
    },
    {
      icon: Receipt,
      tone: "from-emerald-500 to-teal-500",
      title: t("banks.e2Title"),
      text: t("banks.e2Text"),
    },
    {
      icon: PiggyBank,
      tone: "from-violet-500 to-fuchsia-500",
      title: t("banks.e3Title"),
      text: t("banks.e3Text"),
    },
  ];

  return (
    <section className="relative overflow-hidden border-y border-slate-100 bg-gradient-to-b from-white via-slate-50/40 to-white py-16 sm:py-20">
      {/* subtle decorative dots */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.05) 1px, transparent 0)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Eyebrow>{t("banks.eyebrow")}</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {t("banks.title")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            {t("banks.subtitle")}
          </p>
        </div>

        {/* Logos marquee — single line, infinite loop */}
        <div
          className="banks-marquee relative mt-12 overflow-hidden"
          style={{
            maskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)",
          }}
        >
          <div className="banks-marquee-track flex gap-3 sm:gap-4">
            {[...BANKS, ...BANKS].map((b, i) => (
              <div
                key={`${b.name}-${i}`}
                className="flex h-20 w-36 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.25)] sm:w-40"
                title={b.name}
                aria-hidden={i >= BANKS.length}
              >
                <img
                  src={b.src}
                  alt={b.name}
                  loading="lazy"
                  draggable={false}
                  style={{ transform: `scale(${b.scale ?? 1})` }}
                  className="h-8 w-full object-contain"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Explanatory feature cards */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {explainers.map((e, i) => (
            <Reveal key={e.title} delay={i * 0.05}>
              <div className="group flex h-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.22)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.28)]">
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-[0_10px_24px_-12px_rgba(59,130,246,0.45)] transition-transform group-hover:scale-105",
                    e.tone,
                  )}
                >
                  <e.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{e.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{e.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-8 text-center text-[11px] uppercase tracking-wider text-slate-400">
          {t("banks.disclaimer")}
        </p>
      </div>
    </section>
  );
}

/* ============================== TESTIMONIALS ============================== */

const TESTIMONIAL_META = [
  { initials: "CR", color: "from-blue-500 to-sky-500", highlight: false },
  { initials: "RM", color: "from-emerald-500 to-teal-500", highlight: true },
  { initials: "JA", color: "from-violet-500 to-fuchsia-500", highlight: false },
];

function Testimonials() {
  const { t } = useTranslation("landing");
  const items = t("testimonials.items", { returnObjects: true }) as Array<{
    name: string;
    role: string;
    text: string;
  }>;
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/70 to-white py-24 sm:py-28">
      {/* Decorative background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[480px] w-[920px] -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-100/50 via-transparent to-emerald-100/40 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm backdrop-blur">
            <span className="flex items-center gap-0.5 text-amber-400">
              {Array.from({ length: 5 }).map((_, k) => (
                <Star key={k} className="h-3 w-3 fill-current" />
              ))}
            </span>
            <span>{t("testimonials.rating")}</span>
          </span>
          <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-[2.7rem] md:leading-[1.1]">
            {t("testimonials.titleA")}{" "}
            <span className="bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
              {t("testimonials.titleHighlight")}
            </span>
            {t("testimonials.titleB")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-slate-600 sm:text-lg">
            {t("testimonials.subtitle")}
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-2xl grid-cols-1 gap-6 md:max-w-3xl md:gap-7 lg:max-w-none lg:grid-cols-3">
          {items.map((item, i) => {
            const meta = TESTIMONIAL_META[i] ?? TESTIMONIAL_META[0];
            const tt = { ...item, ...meta };
            return (
              <Reveal key={tt.name} delay={i * 0.08}>
                <figure
                  className={cn(
                    "group relative flex h-full flex-col overflow-hidden rounded-3xl p-7 sm:p-8 md:p-9 lg:p-8 transition-all duration-300",
                    tt.highlight
                      ? "bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-[0_30px_70px_-30px_rgba(15,23,42,0.55)] ring-1 ring-white/10 lg:-translate-y-2 hover:-translate-y-3"
                      : "border border-slate-200/80 bg-white/90 backdrop-blur shadow-[0_18px_44px_-26px_rgba(15,23,42,0.22)] hover:-translate-y-1 hover:shadow-[0_28px_60px_-26px_rgba(15,23,42,0.32)] hover:border-slate-300",
                  )}
                >
                  {tt.highlight && (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-400/30 to-blue-500/20 blur-2xl"
                      />
                      <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 ring-1 ring-white/15 backdrop-blur">
                        <Sparkles className="h-3 w-3" /> {t("testimonials.highlightTag")}
                      </span>
                    </>
                  )}

                  {/* Decorative quote mark */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-6 top-3 select-none font-serif text-[88px] leading-none",
                      tt.highlight ? "text-white/10" : "text-slate-100",
                    )}
                  >
                    “
                  </span>

                  <div
                    className={cn(
                      "relative flex items-center gap-1",
                      tt.highlight ? "text-amber-300" : "text-amber-400",
                    )}
                  >
                    {Array.from({ length: 5 }).map((_, k) => (
                      <Star key={k} className="h-[18px] w-[18px] fill-current drop-shadow-sm" />
                    ))}
                  </div>

                  <blockquote
                    className={cn(
                      "relative mt-5 flex-1 text-[15px] leading-[1.7] sm:text-[15.5px] md:text-base md:leading-[1.75] lg:text-[15.5px] lg:leading-relaxed",
                      tt.highlight ? "text-white/90" : "text-slate-700",
                    )}
                  >
                    {tt.text}
                  </blockquote>

                  <figcaption
                    className={cn(
                      "relative mt-7 flex items-center gap-3 border-t pt-5 md:gap-4",
                      tt.highlight ? "border-white/10" : "border-slate-100",
                    )}
                  >
                    <span
                      className={cn(
                        "relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-md ring-2 md:h-12 md:w-12 md:text-base",
                        tt.color,
                        tt.highlight ? "ring-white/20" : "ring-white",
                      )}
                    >
                      {tt.initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-semibold tracking-tight md:text-[15px] lg:truncate",
                          tt.highlight ? "text-white" : "text-slate-900",
                        )}
                      >
                        {tt.name}
                      </p>
                      <p
                        className={cn(
                          "text-[12px] md:text-[13px] lg:truncate",
                          tt.highlight ? "text-white/60" : "text-slate-500",
                        )}
                      >
                        {tt.role}
                      </p>
                    </div>
                    <ShieldCheck
                      className={cn(
                        "ml-auto h-4 w-4 shrink-0 md:h-5 md:w-5",
                        tt.highlight ? "text-emerald-300" : "text-emerald-500",
                      )}
                      aria-label={t("testimonials.verifiedAria")}
                    />
                  </figcaption>
                </figure>
              </Reveal>
            );
          })}
        </div>

        {/* Trust footer */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {t("testimonials.trust1")}
          </span>
          <span className="hidden h-3 w-px bg-slate-200 sm:inline-block" />
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-blue-500" />
            {t("testimonials.trust2")}
          </span>
          <span className="hidden h-3 w-px bg-slate-200 sm:inline-block" />
          <span className="inline-flex items-center gap-1.5 text-amber-500">
            <Star className="h-4 w-4 fill-current" />
            <span className="text-slate-600">{t("testimonials.trust3")}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

/* ============================== FAQ ============================== */

function FAQ() {
  const { t } = useTranslation("landing");
  const faqs = t("faq.items", { returnObjects: true }) as Array<{ q: string; a: string }>;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="duvidas" className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t("faq.eyebrow")}
          title={t("faq.title")}
          subtitle={t("faq.subtitle")}
          center
        />
        <div className="mt-10 space-y-3">
          {faqs.map((f, i) => {
            const active = open === i;
            return (
              <div
                key={f.q}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <button
                  onClick={() => setOpen(active ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="text-sm font-semibold text-slate-900 sm:text-base">{f.q}</span>
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 shrink-0 text-slate-500 transition-transform",
                      active && "rotate-180",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid overflow-hidden transition-all duration-300",
                    active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================== FINAL CTA ============================== */

function FinalCTA() {
  const { t } = useTranslation("landing");
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-[32px] p-8 text-white sm:p-12 lg:p-14"
          style={{
            background:
              "radial-gradient(80% 120% at 0% 0%, #1e40af 0%, transparent 60%), radial-gradient(60% 90% at 100% 100%, #10b981 0%, transparent 60%), linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          }}
        >
          {/* dotted overlay */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.18) 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />
          {/* glow blobs */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-emerald-500/30 blur-3xl"
          />

          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
            {/* Copy */}
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur">
                <Sparkles className="h-3 w-3" /> {t("finalCta.badge")}
              </span>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.6rem] lg:leading-[1.1]">
                {t("finalCta.title")}
              </h2>
              <p className="mt-4 max-w-xl text-base text-slate-200 sm:text-lg">
                {t("finalCta.subtitle")}
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/cadastro"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 shadow-[0_18px_36px_-12px_rgba(255,255,255,0.35)] transition-transform hover:-translate-y-0.5"
                >
                  {t("finalCta.primary")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#planos"
                  onClick={(e) => handleAnchorClick(e, "#planos")}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  {t("finalCta.secondary")}
                </a>
              </div>

              <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
                <li className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" /> {t("finalCta.noCommitment")}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />{" "}
                  {t("finalCta.cancelAnytime")}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" /> {t("finalCta.browser")}
                </li>
              </ul>
            </div>

            {/* Visual side — mini dashboard preview */}
            <div className="relative hidden lg:col-span-5 lg:block">
              <motion.div
                initial={{ opacity: 0, y: 20, rotate: -2 }}
                whileInView={{ opacity: 1, y: 0, rotate: -2 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="relative rounded-2xl border border-white/15 bg-white/95 p-4 text-slate-900 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.5)] backdrop-blur"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    Visão geral
                  </p>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    +12% este mês
                  </span>
                </div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
                  R$ 6.420,00
                </p>
                <div className="mt-3 flex h-16 items-end gap-1">
                  {[40, 55, 35, 70, 50, 78, 60, 88, 46, 72, 84, 58].map((h, i) => (
                    <div key={i} className="flex-1 overflow-hidden rounded-t-md bg-slate-100">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-blue-500 to-emerald-400"
                        style={{ height: `${h}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Meta
                    </p>
                    <p className="text-sm font-bold text-slate-900">68% concluída</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      A pagar
                    </p>
                    <p className="text-sm font-bold tabular-nums text-slate-900">R$ 980,00</p>
                  </div>
                </div>
              </motion.div>

              {/* Floating chip */}
              <motion.div
                aria-hidden
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="absolute -bottom-4 -left-4 flex items-center gap-2 rounded-2xl border border-white/15 bg-white/15 px-3 py-2 text-white backdrop-blur"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/30 text-emerald-200">
                  <Target className="h-4 w-4" />
                </span>
                <div className="text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    Meta
                  </p>
                  <p className="text-xs font-bold">Apartamento · 11%</p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================== FOOTER ============================== */

export function Footer() {
  const { t } = useTranslation("landing");
  return (
    <footer className="relative border-t border-slate-200 bg-gradient-to-b from-white to-slate-50">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:gap-10 md:grid-cols-12 md:gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-12 lg:col-span-4">
            <img
              src="/logos/brand/logo-gasto-inteligente-sidebar-light.svg"
              alt="Gasto Inteligente"
              className="w-[150px] sm:w-[160px] h-auto object-contain"
              draggable={false}
            />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
              {t("footer.tagline")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {t("footer.badgeData")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                <Zap className="h-3.5 w-3.5 text-blue-600" /> {t("footer.badgeFast")}
              </span>
            </div>
          </div>

          {/* Produto */}
          <div className="md:col-span-3 lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t("footer.product")}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>
                <LandingAnchorLink
                  section="recursos"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.features")}
                </LandingAnchorLink>
              </li>
              <li>
                <LandingAnchorLink
                  section="como-funciona"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.how")}
                </LandingAnchorLink>
              </li>
              <li>
                <LandingAnchorLink
                  section="planos"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.plans")}
                </LandingAnchorLink>
              </li>
              <li>
                <LandingAnchorLink
                  section="duvidas"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.faq")}
                </LandingAnchorLink>
              </li>
            </ul>
          </div>

          {/* Conta */}
          <div className="md:col-span-3 lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t("footer.account")}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/login" className="transition-colors hover:text-slate-900">
                  {t("footer.links.signIn")}
                </Link>
              </li>
              <li>
                <Link to="/cadastro" className="transition-colors hover:text-slate-900">
                  {t("footer.links.signUp")}
                </Link>
              </li>
              <li>
                <Link to="/recuperar-senha" className="transition-colors hover:text-slate-900">
                  {t("footer.links.reset")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Suporte */}
          <div className="md:col-span-3 lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t("footer.support")}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>
                <LandingAnchorLink
                  section="duvidas"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.help")}
                </LandingAnchorLink>
              </li>
              <li>
                <a
                  href="mailto:contato@gastointeligente.com.br"
                  className="transition-colors hover:text-slate-900"
                >
                  {t("footer.links.contact")}
                </a>
              </li>
              <li>
                <Link to="/status" className="transition-colors hover:text-slate-900">
                  {t("footer.links.status")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="md:col-span-3 lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t("footer.legal")}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/termos" className="transition-colors hover:text-slate-900">
                  {t("footer.links.terms")}
                </Link>
              </li>
              <li>
                <Link to="/privacidade" className="transition-colors hover:text-slate-900">
                  {t("footer.links.privacy")}
                </Link>
              </li>
              <li>
                <Link to="/lgpd" className="transition-colors hover:text-slate-900">
                  {t("footer.links.lgpd")}
                </Link>
              </li>
              <li>
                <CookiePreferencesLink />
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p suppressHydrationWarning>
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
          <p className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("footer.madeWith")}
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ============================== HELPERS ============================== */

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  center,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <div className={cn(center && "text-center")}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-[1.65rem] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p
          className={cn(
            "mt-3 text-base text-slate-600",
            center ? "mx-auto max-w-2xl" : "max-w-2xl",
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">
      {children}
    </span>
  );
}

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================== GASTO AI SECTION ============================== */

function GastoAISection() {
  const { t } = useTranslation("landing");
  const messages = [
    { role: "user" as const, text: t("ai.msg1") },
    { role: "ai" as const, text: t("ai.msg2") },
    { role: "user" as const, text: t("ai.msg3") },
    { role: "ai" as const, text: t("ai.msg4") },
  ];
  const bullets = t("ai.bullets", { returnObjects: true }) as string[];
  const chips = t("ai.chips", { returnObjects: true }) as string[];

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50/60 py-20 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          backgroundImage:
            "radial-gradient(50% 50% at 20% 0%, rgba(99,102,241,0.10), transparent 60%), radial-gradient(50% 50% at 90% 100%, rgba(16,185,129,0.10), transparent 60%)",
        }}
      />
      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8">
        <Reveal className="lg:col-span-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
            <Sparkles className="h-3 w-3" /> {t("ai.tag")}
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {t("ai.title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">{t("ai.text")}</p>
          <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {b}
              </li>
            ))}
          </ul>
          <Link
            to="/cadastro"
            className="mt-7 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_-14px_rgba(15,23,42,0.55)] transition-transform hover:-translate-y-0.5"
          >
            {t("ai.cta")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>

        <Reveal className="lg:col-span-7" delay={0.1}>
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-indigo-100/70 via-white to-emerald-100/60 blur-2xl"
            />
            <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_36px_70px_-30px_rgba(15,23,42,0.32)]">
              <div className="rounded-[22px] border border-slate-200/70 bg-white p-4 sm:p-5">
                {/* Chat header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-white shadow-[0_8px_18px_-8px_rgba(79,70,229,0.6)]">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{t("ai.chatTitle")}</p>
                      <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {t("ai.chatStatus")}
                      </p>
                    </div>
                  </div>
                  <span className="hidden items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white sm:inline-flex">
                    <Sparkles className="h-3 w-3" /> AI
                  </span>
                </div>

                {/* Messages */}
                <ul className="mt-4 space-y-3">
                  {messages.map((m, i) => (
                    <li
                      key={i}
                      className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                          m.role === "user"
                            ? "rounded-br-md bg-slate-900 text-white"
                            : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800",
                        )}
                      >
                        {m.role === "ai" && (
                          <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                            <Sparkles className="h-3 w-3" /> {t("ai.chatTitle")}
                          </span>
                        )}
                        {m.text}
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Suggested chips */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                    >
                      {c}
                    </span>
                  ))}
                </div>

                {/* Input */}
                <div className="mt-4 flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-2 pl-4 pr-1">
                  <MessageCircle className="h-4 w-4 text-slate-400" />
                  <p className="flex-1 truncate text-sm text-slate-500">
                    {t("ai.inputPlaceholder")}
                  </p>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
                    <Send className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================== ORÇAMENTO MOCK ============================== */

function OrcamentoMock() {
  const categorias = [
    { c: "Mercado", usado: 520, limite: 800, color: "bg-emerald-500" },
    { c: "Transporte", usado: 180, limite: 300, color: "bg-blue-500" },
    { c: "Lazer", usado: 410, limite: 400, color: "bg-rose-500" },
    { c: "Assinaturas", usado: 89, limite: 150, color: "bg-violet-500" },
  ];
  return (
    <MockShell>
      {/* Limite inteligente */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
              Limite inteligente · hoje
            </p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">R$ 84,20</p>
            <p className="mt-1 text-[11px] text-white/70">por dia · até o fim do mês</p>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur">
            <Gauge className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-white/10 p-2.5">
            <p className="text-white/60">Renda</p>
            <p className="mt-0.5 font-bold tabular-nums">R$ 6.420</p>
          </div>
          <div className="rounded-lg bg-white/10 p-2.5">
            <p className="text-white/60">Fixas pagas</p>
            <p className="mt-0.5 font-bold tabular-nums">R$ 2.180</p>
          </div>
          <div className="rounded-lg bg-white/10 p-2.5">
            <p className="text-white/60">Sobra</p>
            <p className="mt-0.5 font-bold tabular-nums text-emerald-300">R$ 2.105</p>
          </div>
        </div>
      </div>

      {/* Orçamento por categoria */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Orçamento por categoria
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
            <Bell className="h-2.5 w-2.5" /> 1 estouro
          </span>
        </div>
        <ul className="mt-3 space-y-3">
          {categorias.map((cat) => {
            const pct = Math.min(100, Math.round((cat.usado / cat.limite) * 100));
            const estourou = cat.usado > cat.limite;
            return (
              <li key={cat.c}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{cat.c}</span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      estourou ? "text-rose-600" : "text-slate-600",
                    )}
                  >
                    R$ {cat.usado} / R$ {cat.limite}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full", estourou ? "bg-rose-500" : cat.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </MockShell>
  );
}

/* ============================== CONTAS MOCK ============================== */

function ContasMock() {
  const { t } = useTranslation("landing");
  const contas = [
    {
      n: t("mockup.contas.items.rent"),
      v: "R$ 1.450,00",
      d: "05/12",
      tone: "ok" as const,
      label: t("mockup.contas.labels.paid"),
    },
    {
      n: t("mockup.contas.items.internet"),
      v: "R$ 119,90",
      d: "12/12",
      tone: "warn" as const,
      label: t("mockup.contas.labels.in3"),
    },
    {
      n: t("mockup.contas.items.energy"),
      v: "R$ 248,30",
      d: "18/12",
      tone: "info" as const,
      label: t("mockup.contas.labels.in9"),
    },
    {
      n: t("mockup.contas.items.client"),
      v: "R$ 1.800,00",
      d: "20/12",
      tone: "income" as const,
      label: t("mockup.contas.labels.toReceive"),
    },
  ];
  return (
    <MockShell>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {t("mockup.contas.eyebrow")}
          </p>
          <p className="text-base font-bold text-slate-900">{t("mockup.contas.open")}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
          <CalendarClock className="h-5 w-5" />
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {contas.map((c) => {
          const toneCls =
            c.tone === "ok"
              ? "border-emerald-200 bg-emerald-50/60"
              : c.tone === "warn"
                ? "border-amber-200 bg-amber-50/60"
                : c.tone === "income"
                  ? "border-blue-200 bg-blue-50/60"
                  : "border-slate-200 bg-white";
          const badgeCls =
            c.tone === "ok"
              ? "bg-emerald-100 text-emerald-700"
              : c.tone === "warn"
                ? "bg-amber-100 text-amber-800"
                : c.tone === "income"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-700";
          return (
            <li
              key={c.n}
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-2.5",
                toneCls,
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg",
                    c.tone === "ok"
                      ? "bg-emerald-100 text-emerald-700"
                      : c.tone === "warn"
                        ? "bg-amber-100 text-amber-700"
                        : c.tone === "income"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-700",
                  )}
                >
                  {c.tone === "income" ? (
                    <ArrowDownRight className="h-4 w-4" />
                  ) : c.tone === "ok" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Calendar className="h-4 w-4" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{c.n}</p>
                  <p className="text-[11px] text-slate-500">
                    {t("mockup.contas.due", { date: c.d })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums text-slate-900">{c.v}</p>
                <span
                  className={cn(
                    "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                    badgeCls,
                  )}
                >
                  {c.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.contas.summary.toPay")}
          </p>
          <p className="text-sm font-bold tabular-nums text-rose-700">R$ 368,20</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t("mockup.contas.summary.toReceive")}
          </p>
          <p className="text-sm font-bold tabular-nums text-emerald-700">R$ 1.800,00</p>
        </div>
      </div>
    </MockShell>
  );
}

/* ============================== INTELLIGENCE SECTION ============================== */

function IntelligenceSection() {
  const { t } = useTranslation("landing");
  const cards = [
    {
      icon: Gauge,
      title: t("intelligence.cards.scoreTitle"),
      text: t("intelligence.cards.scoreText"),
      iconCls:
        "border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/40 text-emerald-700",
    },
    {
      icon: Activity,
      title: t("intelligence.cards.diagnosisTitle"),
      text: t("intelligence.cards.diagnosisText"),
      iconCls: "border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/40 text-blue-700",
    },
    {
      icon: Bell,
      title: t("intelligence.cards.alertsTitle"),
      text: t("intelligence.cards.alertsText"),
      iconCls: "border-amber-100 bg-gradient-to-br from-amber-50 to-amber-100/40 text-amber-700",
    },
    {
      icon: Lightbulb,
      title: t("intelligence.cards.tipsTitle"),
      text: t("intelligence.cards.tipsText"),
      iconCls:
        "border-violet-100 bg-gradient-to-br from-violet-50 to-violet-100/40 text-violet-700",
    },
    {
      icon: Bot,
      title: t("intelligence.cards.aiTitle"),
      text: t("intelligence.cards.aiText"),
      iconCls: "border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/40 text-slate-700",
    },
  ];

  return (
    <section id="inteligencia" className="relative overflow-hidden bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("intelligence.eyebrow")}
          title={t("intelligence.title")}
          subtitle={t("intelligence.subtitle")}
        />

        {/* Preview hero: Score + Diagnóstico + Alerta + Dica */}
        <Reveal className="mt-10">
          <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] sm:p-7">
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-100 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                  <Gauge className="h-3.5 w-3.5" />
                  <span className="truncate">{t("intelligence.preview.scoreLabel")}</span>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <span className="num text-5xl font-extrabold tracking-tight text-slate-900">
                    82
                  </span>
                  <span className="mb-1 text-xs font-medium text-emerald-700">
                    {t("intelligence.preview.scoreStatus")}
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" />
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                  <Activity className="h-3.5 w-3.5" />
                  <span className="truncate">{t("intelligence.preview.diagnosisLabel")}</span>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="min-w-0">{t("intelligence.preview.diagnosisGood")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span className="min-w-0">{t("intelligence.preview.diagnosisRisk")}</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  <Bell className="h-3.5 w-3.5" />
                  <span>{t("intelligence.preview.alertTag")}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  {t("intelligence.preview.alertSample")}
                </p>
              </div>

              <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-violet-700">
                  <Lightbulb className="h-3.5 w-3.5" />
                  <span>{t("intelligence.preview.tipTag")}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  {t("intelligence.preview.tipSample")}
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Cards grid */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.04}>
              <div className="group h-full rounded-3xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.18)]">
                <span
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
                    c.iconCls,
                  )}
                >
                  <c.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-900 hover:shadow-sm"
          >
            {t("intelligence.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}

/* ============================== APP EXPERIENCE SECTION ============================== */

function AppExperienceSection() {
  const { t } = useTranslation("landing");

  const chips = [
    { icon: Plus, label: t("appExperience.chips.fab") },
    { icon: LayoutGrid, label: t("appExperience.chips.bottomNav") },
    { icon: Sparkles, label: t("appExperience.chips.theme") },
    { icon: Smartphone, label: t("appExperience.chips.android") },
  ];

  const radarItems = [
    { k: "Selic", v: "15,00%" },
    { k: "CDI", v: "14,90%" },
    { k: "IPCA", v: "0,40%" },
    { k: "Dólar", v: "R$ 5,xx" },
    { k: "Euro", v: "R$ 6,xx" },
  ];

  return (
    <section id="app-mobile" className="relative overflow-hidden bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("appExperience.eyebrow")}
          title={t("appExperience.title")}
          subtitle={t("appExperience.subtitle")}
        />

        {/* Bloco 1 — Mockup + chips */}
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <div className="flex justify-center lg:justify-start">
              <img
                src={mobileGastoInteligente}
                alt={t("appExperience.title")}
                loading="lazy"
                className="w-[260px] sm:w-[300px] lg:w-[340px] h-auto drop-shadow-[0_30px_60px_rgba(15,23,42,0.25)]"
              />
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div>
              <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">
                {t("appExperience.block1Title")}
              </h3>
              <p className="mt-3 text-base text-slate-600">{t("appExperience.block1Text")}</p>
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {chips.map((c) => (
                  <li
                    key={c.label}
                    className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
                      <c.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 truncate">{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Bloco 2 — 3 cards (WhatsApp / Cofre / Radar) */}
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Reveal>
            <div className="h-full rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.18)]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                <MessageCircle className="h-5 w-5" />
              </span>
              <h4 className="mt-4 text-base font-bold text-slate-900">
                {t("appExperience.whatsappTitle")}
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {t("appExperience.whatsappText")}
              </p>
              <div className="mt-4 space-y-2">
                <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-emerald-500 px-3 py-1.5 text-xs text-white">
                  {t("appExperience.whatsappSample.user")}
                </div>
                <div
                  className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-1.5 text-xs text-slate-700"
                  dangerouslySetInnerHTML={{ __html: t("appExperience.whatsappSample.bot") }}
                />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="h-full rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.18)]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700">
                <Lock className="h-5 w-5" />
              </span>
              <h4 className="mt-4 text-base font-bold text-slate-900">
                {t("appExperience.vaultTitle")}
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {t("appExperience.vaultText")}
              </p>
              <div className="mt-4 space-y-2">
                {["•••• •••• •••• 4821", "••••••••••••", "•••••• ••••••"].map((mask, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs tracking-widest text-slate-500"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                    <span className="truncate">{mask}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="h-full rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.18)]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-100 bg-amber-50 text-amber-700">
                <Landmark className="h-5 w-5" />
              </span>
              <h4 className="mt-4 text-base font-bold text-slate-900">
                {t("appExperience.radarTitle")}
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {t("appExperience.radarText")}
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {radarItems.map((it) => (
                  <li
                    key={it.k}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {it.k}
                    </div>
                    <div className="num text-sm font-bold text-slate-900">{it.v}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-slate-500">
                {t("appExperience.radarMicro")} · {t("appExperience.radarDisclaimer")}
              </p>
            </div>
          </Reveal>
        </div>

        <div className="mt-12 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t("appExperience.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}

function PhoneAppMock() {
  const { t } = useTranslation("landing");
  return (
    <div className="relative w-[260px] sm:w-[280px]">
      <div className="relative rounded-[2.4rem] border-[10px] border-slate-900 bg-white shadow-[0_30px_60px_-25px_rgba(15,23,42,0.45)]">
        <div className="relative h-[540px] overflow-hidden rounded-[1.5rem] bg-gradient-to-b from-slate-50 to-white">
          {/* TopBar */}
          <div className="flex h-11 items-center justify-between border-b border-slate-100 bg-white/90 px-3">
            <Menu className="h-4 w-4 text-slate-700" />
            <span className="text-[11px] font-bold text-slate-900">Gasto Inteligente</span>
            <Bell className="h-4 w-4 text-slate-700" />
          </div>
          {/* Conteúdo */}
          <div className="space-y-3 p-3 pb-20">
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <div className="text-[10px] uppercase tracking-wider text-slate-300">
                {t("appExperience.phone.balance")}
              </div>
              <div className="num mt-1 text-xl font-extrabold">R$ 4.280,75</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-lg bg-white/10 px-2 py-1.5">
                  <div className="text-emerald-300">{t("appExperience.phone.income")}</div>
                  <div className="num font-bold">R$ 6.120</div>
                </div>
                <div className="rounded-lg bg-white/10 px-2 py-1.5">
                  <div className="text-rose-300">{t("appExperience.phone.expenses")}</div>
                  <div className="num font-bold">R$ 1.839</div>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">
                  {t("appExperience.phone.smartLimit")}
                </span>
                <span className="num text-[10px] font-bold text-emerald-700">R$ 1.180</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-[64%] rounded-full bg-emerald-500" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold text-slate-700">
                {t("appExperience.phone.nextBills")}
              </div>
              <ul className="mt-2 space-y-1.5">
                {[
                  {
                    n: t("appExperience.phone.billLight"),
                    v: "R$ 132",
                    d: t("appExperience.phone.tomorrow"),
                  },
                  { n: "Netflix", v: "R$ 39,90", d: t("appExperience.phone.inDays", { n: 3 }) },
                ].map((it) => (
                  <li key={it.n} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate text-slate-700">{it.n}</span>
                    <span className="shrink-0 text-slate-500">{it.d}</span>
                    <span className="num shrink-0 font-bold text-slate-900">{it.v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {/* BottomNav + FAB */}
          <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white">
            <div className="relative flex h-14 items-end justify-around px-2 pb-2">
              <div className="flex flex-col items-center gap-0.5 text-[9px] text-slate-500">
                <LayoutDashboard className="h-4 w-4" />
                {t("appExperience.phone.dashboard")}
              </div>
              <div className="flex flex-col items-center gap-0.5 text-[9px] text-slate-500">
                <Receipt className="h-4 w-4" />
                {t("appExperience.phone.list")}
              </div>
              <div className="w-12" />
              <div className="flex flex-col items-center gap-0.5 text-[9px] text-slate-500">
                <CreditCard className="h-4 w-4" />
                {t("appExperience.phone.cards")}
              </div>
              <div className="flex flex-col items-center gap-0.5 text-[9px] text-slate-500">
                <Menu className="h-4 w-4" />
                {t("appExperience.phone.more")}
              </div>
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-900 text-white shadow-lg ring-4 ring-white">
                  <Plus className="h-5 w-5" strokeWidth={2.6} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== STYLES ============================== */

function LandingStyles() {
  // Scoped reset to ensure landing always reads as light, even if <html> has .dark
  return (
    <style>{`
      .gi-landing { color-scheme: light; overflow-x: clip; }
      .gi-landing, .gi-landing * { border-color: rgb(226 232 240); }
      .gi-landing ::selection { background: rgba(59,130,246,0.18); }
      .gi-landing .no-scrollbar::-webkit-scrollbar { display: none; }
      .gi-landing .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      @media (max-width: 480px) {
        .gi-landing section { padding-top: 3.5rem; padding-bottom: 3.5rem; }
      }
    `}</style>
  );
}

/* ============================== PLANEJAMENTO SECTION ============================== */

function PlanejamentoSection() {
  const { t } = useTranslation("landing");
  const cards = [
    {
      icon: Target,
      title: t("planningSection.cards.rule.title"),
      text: t("planningSection.cards.rule.description"),
      iconCls: "border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/40 text-blue-700",
    },
    {
      icon: Calculator,
      title: t("planningSection.cards.daily.title"),
      text: t("planningSection.cards.daily.description"),
      iconCls:
        "border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/40 text-emerald-700",
    },
    {
      icon: TrendingDown,
      title: t("planningSection.cards.forecast.title"),
      text: t("planningSection.cards.forecast.description"),
      iconCls: "border-amber-100 bg-gradient-to-br from-amber-50 to-amber-100/40 text-amber-700",
    },
    {
      icon: Activity,
      title: t("planningSection.cards.planned.title"),
      text: t("planningSection.cards.planned.description"),
      iconCls:
        "border-violet-100 bg-gradient-to-br from-violet-50 to-violet-100/40 text-violet-700",
    },
  ];

  return (
    <section id="planejamento" className="relative overflow-hidden bg-slate-50/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("planningSection.eyebrow")}
          title={t("planningSection.title")}
          subtitle={t("planningSection.description")}
        />

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          {/* Mock visual */}
          <Reveal>
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] sm:p-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <Target className="h-3.5 w-3.5" />
                  <span>{t("planningSection.mock.title")}</span>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  {t("planningSection.mock.forecast")}
                </span>
              </div>

              {/* 50/30/20 bar */}
              <div className="mt-5">
                <div className="flex h-3 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                  <div className="h-full w-1/2 bg-gradient-to-r from-blue-400 to-blue-600" />
                  <div className="h-full w-[30%] bg-gradient-to-r from-emerald-400 to-emerald-600" />
                  <div className="h-full w-[20%] bg-gradient-to-r from-violet-400 to-violet-600" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    {t("planningSection.mock.essentials")} · 50%
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {t("planningSection.mock.variables")} · 30%
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-violet-500" />
                    {t("planningSection.mock.reserve")} · 20%
                  </span>
                </div>
              </div>

              {/* Mini cards */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                    <Calculator className="h-3.5 w-3.5" />
                    <span className="truncate">{t("planningSection.mock.dailyLimit")}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="num text-2xl font-extrabold tracking-tight text-slate-900">
                      {t("planningSection.mock.dailyValue")}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {t("planningSection.mock.dailyStatus")}
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                    <TrendingDown className="h-3.5 w-3.5" />
                    <span>{t("planningSection.mock.forecast")}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">
                    {t("planningSection.mock.forecastText")}
                  </p>
                </div>
              </div>

              {/* Termômetro */}
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <span>{t("planningSection.mock.usedLabel")}</span>
                  <span className="num text-slate-900">68%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-blue-400 via-emerald-400 to-amber-400" />
                </div>
              </div>
            </div>
          </Reveal>

          {/* Cards/benefícios */}
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.05}>
                <div className="group h-full rounded-3xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.18)]">
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
                      c.iconCls,
                    )}
                  >
                    <c.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-slate-900">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-900 hover:shadow-sm"
          >
            {t("planningSection.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}

/* ============================== CONTAS SECTION ============================== */

function ContasSection() {
  const { t } = useTranslation("landing");
  const cards = [
    {
      icon: Wallet,
      title: t("billsSection.cards.payable.title"),
      text: t("billsSection.cards.payable.description"),
      iconCls: "border-rose-100 bg-gradient-to-br from-rose-50 to-rose-100/40 text-rose-700",
    },
    {
      icon: ArrowDownRight,
      title: t("billsSection.cards.receivable.title"),
      text: t("billsSection.cards.receivable.description"),
      iconCls:
        "border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/40 text-emerald-700",
    },
    {
      icon: Repeat,
      title: t("billsSection.cards.subscriptions.title"),
      text: t("billsSection.cards.subscriptions.description"),
      iconCls:
        "border-violet-100 bg-gradient-to-br from-violet-50 to-violet-100/40 text-violet-700",
    },
    {
      icon: Bell,
      title: t("billsSection.cards.alerts.title"),
      text: t("billsSection.cards.alerts.description"),
      iconCls: "border-amber-100 bg-gradient-to-br from-amber-50 to-amber-100/40 text-amber-700",
    },
  ];

  // Mini calendário ilustrativo (1..30); destaques: 5, 12, 18, 24
  const highlights: Record<number, string> = {
    5: "bg-rose-500",
    12: "bg-emerald-500",
    18: "bg-violet-500",
    24: "bg-amber-500",
  };
  const days = Array.from({ length: 30 }, (_, i) => i + 1);

  return (
    <section id="contas" className="relative overflow-hidden bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("billsSection.eyebrow")}
          title={t("billsSection.title")}
          subtitle={t("billsSection.description")}
        />

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          {/* Mock visual: calendário + lista */}
          <Reveal>
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] sm:p-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{t("billsSection.mock.title")}</span>
                </div>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                  {t("billsSection.mock.subtitle")}
                </span>
              </div>

              {/* Calendário compacto 7 colunas */}
              <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
                {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                  <div
                    key={i}
                    className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {d}
                  </div>
                ))}
                {days.map((n) => {
                  const hl = highlights[n];
                  return (
                    <div
                      key={n}
                      className={cn(
                        "relative flex aspect-square items-center justify-center rounded-md border text-[11px] font-medium",
                        hl
                          ? "border-slate-200 bg-white text-slate-900"
                          : "border-slate-100 bg-white text-slate-500",
                      )}
                    >
                      <span className="num">{n}</span>
                      {hl && <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", hl)} />}
                    </div>
                  );
                })}
              </div>

              {/* Lista de contas */}
              <ul className="mt-5 space-y-2">
                <li className="flex items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-rose-50/40 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {t("billsSection.mock.bill1")}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {t("billsSection.mock.bill1Status")}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    {t("billsSection.mock.tagPending")}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <ArrowDownRight className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {t("billsSection.mock.bill2")}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {t("billsSection.mock.bill2Status")}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {t("billsSection.mock.tagReceivable")}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                      <Repeat className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {t("billsSection.mock.bill3")}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {t("billsSection.mock.bill3Status")}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    {t("billsSection.mock.tagRecurring")}
                  </span>
                </li>
              </ul>
            </div>
          </Reveal>

          {/* Cards/benefícios */}
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.05}>
                <div className="group h-full rounded-3xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.18)]">
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
                      c.iconCls,
                    )}
                  >
                    <c.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-slate-900">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-900 hover:shadow-sm"
          >
            {t("billsSection.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}

/* ============================== MERCADO INTELIGENTE SECTION ============================== */

function MercadoInteligenteSection() {
  const { t } = useTranslation("landing");
  const highlights = [
    { icon: ClipboardList, key: "list" },
    { icon: ShoppingCart, key: "cart" },
    { icon: LineChart, key: "history" },
    { icon: Wallet, key: "budget" },
  ] as const;

  return (
    <section
      id="mercado-inteligente"
      className="relative overflow-hidden bg-slate-50 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("mercadoInteligente.eyebrow")}
          title={t("mercadoInteligente.title")}
          subtitle={t("mercadoInteligente.subtitle")}
        />

        <Reveal className="mt-8">
          <p className="mx-auto max-w-3xl text-center text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("mercadoInteligente.description")}
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((h, i) => (
            <Reveal key={h.key} delay={i * 0.04}>
              <div className="group h-full rounded-3xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.18)]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/40 text-emerald-700">
                  <h.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">
                  {t(`mercadoInteligente.highlights.${h.key}.title`)}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {t(`mercadoInteligente.highlights.${h.key}.text`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-900 hover:shadow-sm"
          >
            {t("mercadoInteligente.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}

/* ============================== IMPORTACAO INTELIGENTE SECTION ============================== */

function ImportacaoInteligenteSection() {
  const { t } = useTranslation("landing");
  const highlights = [
    { icon: Upload, key: "pdfImage" },
    { icon: FileText, key: "statements" },
    { icon: ScanLine, key: "receipt" },
    { icon: Eye, key: "review" },
  ] as const;

  return (
    <section
      id="importacao-inteligente"
      className="relative overflow-hidden bg-white py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          center
          eyebrow={t("importacaoInteligente.eyebrow")}
          title={t("importacaoInteligente.title")}
          subtitle={t("importacaoInteligente.subtitle")}
        />

        <Reveal className="mt-8">
          <p className="mx-auto max-w-3xl text-center text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("importacaoInteligente.description")}
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((h, i) => (
            <Reveal key={h.key} delay={i * 0.04}>
              <div className="group h-full rounded-3xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.18)]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/40 text-blue-700">
                  <h.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">
                  {t(`importacaoInteligente.highlights.${h.key}.title`)}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {t(`importacaoInteligente.highlights.${h.key}.text`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <LandingAnchorLink
            section="planos"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-900 hover:shadow-sm"
          >
            {t("importacaoInteligente.cta")}
            <ArrowRight className="h-4 w-4" />
          </LandingAnchorLink>
        </div>
      </div>
    </section>
  );
}
