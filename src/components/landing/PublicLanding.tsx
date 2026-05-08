import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BrandLogo } from "@/components/BrandLogo";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { COMMERCIAL_PLANS, type PlanTier } from "@/lib/plans";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────
   Public landing — always light theme, white-first, premium feel.
   Scoped under .gi-landing so dark theme classes don't leak in.
   ────────────────────────────────────────────────────────────── */

const NAV = [
  { label: "Início", href: "#top" },
  { label: "Recursos", href: "#recursos" },
  { label: "Como funciona", href: "#telas" },
  { label: "Planos", href: "#planos" },
  { label: "Dúvidas", href: "#faq" },
];

const HEADER_OFFSET = 72;

function smoothScrollTo(href: string) {
  if (typeof window === "undefined") return;
  const id = href.replace(/^#/, "");
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  if (history.replaceState) history.replaceState(null, "", href);
}

function handleAnchorClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  onAfter?: () => void,
) {
  if (!href.startsWith("#")) return;
  e.preventDefault();
  smoothScrollTo(href);
  onAfter?.();
}

export function PublicLanding() {
  return (
    <div
      id="top"
      className="gi-landing min-h-screen bg-white text-slate-900 antialiased"
      style={{ colorScheme: "light" }}
    >
      <Header />
      <Hero />
      <BanksStrip />
      <TrustStrip />
      <WhyUs />
      <HowItWorks />
      <ScreensTabs />
      <DashboardShowcase />
      <FeatureSplit
        eyebrow="Gastos"
        title="Entenda para onde seu dinheiro está indo."
        text="Filtre por mês, categoria, período e forma de pagamento. Separe gastos do mês atual, contas de meses anteriores e lançamentos do cartão com mais clareza. O sistema trabalha com mês de referência: você define a qual mês cada gasto pertence."
        bullets={["Filtro por mês de referência", "Categorias inteligentes", "Total e média do mês", "Forma de pagamento"]}
        visual={<GastosMock />}
        reverse
      />
      <FeatureSplit
        eyebrow="Cartões"
        title="Controle suas faturas sem confusão."
        text="Acompanhe compras, faturas abertas e fechadas, vencimentos, limite usado e pagamento da fatura em um só lugar."
        bullets={["Limite disponível em tempo real", "Fechamento e vencimento", "Compras parceladas", "Marcar fatura como paga"]}
        visual={<CartaoMock />}
      />
      <FeatureSplit
        eyebrow="Metas"
        title="Transforme objetivos em progresso visual."
        text="Crie metas financeiras e acompanhe quanto já foi reservado, quanto falta e sua evolução até atingir o objetivo."
        bullets={["Imagem de capa para a meta", "Barra de progresso animada", "Valor guardado e restante", "Percentual concluído"]}
        visual={<MetaMock />}
        reverse
      />
      <FeatureSplit
        eyebrow="Investimentos"
        title="Acompanhe seu crescimento financeiro."
        text="Tenha uma visão organizada para acompanhar investimentos, evolução patrimonial e planejamento de longo prazo."
        bullets={["Carteira consolidada", "Evolução mensal", "Resumo por classe", "Visão de longo prazo"]}
        visual={<InvestimentosMock />}
      />
      <ForWho />
      <TrustPoints />
      <Plans />
      <Testimonials />
      <FAQ />
      <FinalCTA />
      <Footer />
      <LandingStyles />
    </div>
  );
}

/* ============================== HEADER ============================== */

function Header() {
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
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "bg-white/85 backdrop-blur-xl border-b border-slate-200/70 shadow-[0_6px_24px_-18px_rgba(15,23,42,0.18)]"
          : "bg-white/0 border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="#top" onClick={(e) => handleAnchorClick(e, "#top")} className="flex items-center gap-2">
          <BrandMark className="h-8 w-auto" />
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={(e) => handleAnchorClick(e, n.href)}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link
            to="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Entrar
          </Link>
          <Link
            to="/cadastro"
            className="group inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(15,23,42,0.45)] transition-all hover:bg-slate-800 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.55)]"
          >
            Começar agora
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 md:hidden"
          aria-label="Abrir menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-200 bg-white md:hidden">
          <div className="flex flex-col px-4 py-3">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={(e) => handleAnchorClick(e, n.href, () => setOpen(false))}
                className="rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {n.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
              <Link
                to="/login"
                className="rounded-full border border-slate-200 px-4 py-2.5 text-center text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="rounded-full bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Começar agora
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
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden">
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
          maskImage:
            "radial-gradient(ellipse at top, rgba(0,0,0,0.7) 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at top, rgba(0,0,0,0.7) 0%, transparent 70%)",
        }}
      />
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-12 pb-16 sm:px-6 md:pt-20 md:pb-24 lg:grid-cols-12 lg:gap-12 lg:px-8">
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
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-5 font-display text-[2rem] font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.6rem]"
          >
            Controle suas finanças com mais{" "}
            <span className="bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 bg-clip-text text-transparent">
              clareza, inteligência
            </span>{" "}
            e praticidade.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg"
          >
            O Gasto Inteligente ajuda você a organizar gastos, cartões, contas, metas, renda e
            investimentos em um só lugar, com uma visão simples e fácil de entender.
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
              Começar agora
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Entrar na minha conta
            </Link>
          </motion.div>
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mt-8 flex flex-wrap gap-2"
          >
            {[
              "Controle pessoal",
              "Cartões e faturas",
              "Metas financeiras",
              "Organização mensal",
              "Visual intuitivo",
            ].map((b) => (
              <li
                key={b}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                {b}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Visual mockup */}
        <div className="relative lg:col-span-6">
          {/* decorative blob behind mockup */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 hidden md:block"
          >
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
                    Receita
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
                    Alerta
                  </p>
                  <p className="text-xs font-bold leading-tight text-slate-900">Conta vence amanhã</p>
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
                    Meta · Viagem
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900">68% concluída</p>
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
                      Fatura
                    </p>
                    <p className="text-xs font-bold text-slate-900">Em aberto</p>
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

function HeroDashboardMock() {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.35)]">
      <div className="rounded-[22px] border border-slate-200/70 bg-white p-4 sm:p-5">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Visão geral
            </p>
            <p className="text-base font-bold text-slate-900">Novembro · 2026</p>
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
          <KpiMini label="Saldo" value="R$ 3.142,80" tone="brand" icon={<Wallet className="h-3.5 w-3.5" />} />
          <KpiMini label="Receitas" value="R$ 6.420,00" tone="success" icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
          <KpiMini label="Despesas" value="R$ 3.277,20" tone="danger" icon={<ArrowDownRight className="h-3.5 w-3.5" />} />
          <KpiMini label="A pagar" value="R$ 980,00" tone="warning" icon={<Receipt className="h-3.5 w-3.5" />} />
        </div>
        {/* Chart bars */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Fluxo do mês</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              +12%
            </span>
          </div>
          <div className="mt-3 flex h-20 items-end gap-1.5">
            {[45, 60, 38, 72, 55, 80, 64, 90, 48, 70, 84, 58].map((h, i) => (
              <div key={i} className="flex-1 overflow-hidden rounded-t-md bg-slate-200">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-blue-500 to-emerald-400"
                  style={{ height: `${h}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Limite */}
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Limite inteligente</p>
            <p className="text-xs font-semibold tabular-nums text-slate-500">62%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-500 to-blue-500" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Você ainda pode gastar R$ 1.180 esta semana.</p>
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
        <span className={cn("grid h-6 w-6 place-items-center rounded-md", toneMap[tone])}>{icon}</span>
      </div>
      <p className="mt-1 text-sm font-bold tabular-nums text-slate-900 sm:text-base">{value}</p>
    </div>
  );
}

/* ============================== TRUST STRIP ============================== */

function TrustStrip() {
  const items = [
    { icon: ShieldCheck, label: "Seus dados protegidos", hint: "Privacidade em primeiro lugar" },
    { icon: Zap, label: "Rápido e leve", hint: "Pensado para o dia a dia" },
    { icon: Eye, label: "Visão clara do mês", hint: "Tudo organizado num olhar" },
    { icon: Star, label: "Feito para sua rotina", hint: "Pessoa física, MEI e mais" },
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
  const steps = [
    {
      icon: UserPlus,
      n: "01",
      title: "Crie sua conta",
      text: "Cadastre-se em poucos segundos e personalize seu perfil pessoal, MEI ou empresa.",
    },
    {
      icon: Pencil,
      n: "02",
      title: "Lance suas finanças",
      text: "Adicione gastos, receitas, contas e cartões. Tudo organizado por mês de referência.",
    },
    {
      icon: LineChart,
      n: "03",
      title: "Acompanhe a evolução",
      text: "Visualize gráficos, alertas, metas e tenha clareza total sobre o seu dinheiro.",
    },
  ];
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-slate-50/70 py-20 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.4]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Como funciona"
          title="Em 3 passos simples você assume o controle."
          subtitle="Sem planilha, sem complicação. Você começa em minutos e enxerga resultado já no primeiro mês."
          center
        />
        <div className="relative mt-14 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {/* connector line on desktop */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent md:block"
          />
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="group relative flex h-full flex-col items-center rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-[0_18px_40px_-26px_rgba(15,23,42,0.25)] transition-all hover:-translate-y-1 hover:shadow-[0_28px_56px_-26px_rgba(15,23,42,0.32)]">
                <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white shadow-[0_14px_30px_-12px_rgba(59,130,246,0.55)] transition-transform group-hover:scale-105">
                  <s.icon className="h-7 w-7" />
                  <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-white text-[10px] font-extrabold text-slate-700 shadow ring-1 ring-slate-200">
                    {s.n}
                  </span>
                </span>
                <h3 className="mt-5 text-lg font-bold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== WHY US ============================== */

function WhyUs() {
  const cards = [
    {
      icon: LayoutDashboard,
      title: "Tudo em um só lugar",
      text: "Acompanhe gastos, contas, cartões, metas, renda e investimentos sem depender de várias planilhas.",
      tone: "blue",
    },
    {
      icon: Eye,
      title: "Visão clara do mês",
      text: "Entenda quanto entrou, quanto saiu, o que já foi pago e o que ainda precisa de atenção.",
      tone: "emerald",
    },
    {
      icon: CreditCard,
      title: "Cartões mais organizados",
      text: "Controle faturas, compras, vencimentos, limite disponível e ciclo do cartão com mais facilidade.",
      tone: "violet",
    },
    {
      icon: Target,
      title: "Metas com progresso visual",
      text: "Veja quanto você já guardou, quanto falta e acompanhe sua evolução até o objetivo.",
      tone: "rose",
    },
    {
      icon: Bell,
      title: "Alertas inteligentes",
      text: "Receba avisos importantes sobre contas, faturas, vencimentos e pontos que precisam da sua atenção.",
      tone: "amber",
    },
    {
      icon: Sparkles,
      title: "Interface simples",
      text: "Um sistema bonito, direto e fácil de usar, mesmo para quem não entende muito de finanças.",
      tone: "sky",
    },
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
          eyebrow="Por que usar"
          title="Tudo que você precisa para entender seu dinheiro."
          subtitle="Uma plataforma pensada para deixar a sua vida financeira simples, visual e organizada."
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
  dashboard: ["Saldo, receitas e despesas", "Fluxo do mês em gráfico", "Limite inteligente", "Alertas e calendário"],
  gastos: ["Filtro por mês de referência", "Categorias e formas de pagamento", "Total e média do mês", "Lista clara e organizada"],
  cartoes: ["Cartão visual com limite", "Fatura aberta e vencimento", "Compras e parcelas", "Marcar fatura como paga"],
  metas: ["Capa visual da meta", "Progresso animado", "Quanto falta para concluir", "Histórico de aportes"],
  investimentos: ["Carteira total e variação", "Gráfico de crescimento", "Distribuição por classe", "Resumo visual rápido"],
  guardado: ["Total reservado", "Valor por banco e carteira", "Visual seguro e limpo", "Acompanhamento mensal"],
};

function ScreensTabs() {
  const [active, setActive] = useState<ScreenKey>("dashboard");
  const current = SCREENS.find((s) => s.key === active)!;
  const highlights = SCREEN_HIGHLIGHTS[active];

  return (
    <section id="telas" className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white py-20 sm:py-24">
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
          eyebrow="Veja por dentro"
          title="As telas que organizam toda a sua rotina financeira."
          subtitle="Navegue pelas principais áreas do Gasto Inteligente e veja como cada parte trabalha pra você."
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
                  <span className="relative z-10">{s.label}</span>
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
                {current.label}
              </span>
              <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {current.label}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{current.desc}</p>
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
                Conhecer o sistema
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
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8">
        <Reveal className="lg:col-span-5">
          <Eyebrow>Dashboard</Eyebrow>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Seu mês financeiro em uma visão simples.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            O Dashboard reúne as informações mais importantes para você entender rapidamente sua
            situação: receitas, despesas, contas, saldo, alertas e limite inteligente.
          </p>
          <ul className="mt-6 space-y-2.5">
            {["Saldo do mês", "Receitas e despesas", "Contas a pagar", "Alertas importantes", "Limite inteligente"].map(
              (b) => (
                <li key={b} className="flex items-center gap-2 text-sm text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {b}
                </li>
              ),
            )}
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
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
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
      <div className="rounded-[22px] border border-slate-200/70 bg-white p-4 sm:p-5">{children}</div>
    </div>
  );
}

function GastosMock() {
  const items = [
    { c: "Mercado", v: "R$ 340,90", t: "Hoje", color: "bg-emerald-100 text-emerald-700" },
    { c: "Restaurante", v: "R$ 78,50", t: "Ontem", color: "bg-amber-100 text-amber-700" },
    { c: "Transporte", v: "R$ 24,00", t: "2 dias", color: "bg-blue-100 text-blue-700" },
    { c: "Assinatura", v: "R$ 39,90", t: "3 dias", color: "bg-violet-100 text-violet-700" },
  ];
  return (
    <MockShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Gastos · mês</p>
          <p className="text-base font-bold text-slate-900">R$ 3.277,20</p>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 sm:flex-wrap sm:justify-end sm:overflow-visible">
          {["Nov · 2026", "Categoria", "Pix", "Cartão"].map((p, i) => (
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
              <TransactionAvatar estabelecimento={it.c} size="sm" />
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
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">R$ 3.277,20</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Média</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">R$ 109,24</p>
        </div>
      </div>
    </MockShell>
  );
}

function CartaoMock() {
  const purchases = [
    { c: "Spotify", v: "R$ 21,90", t: "Hoje", color: "bg-emerald-100 text-emerald-700" },
    { c: "iFood", v: "R$ 64,80", t: "Ontem · 3x", color: "bg-rose-100 text-rose-700" },
    { c: "Posto Shell", v: "R$ 180,00", t: "2 dias", color: "bg-amber-100 text-amber-700" },
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
          <p className="text-xs font-semibold opacity-80">Inteligente Black</p>
          <CreditCard className="h-5 w-5 opacity-80" />
        </div>
        {/* chip */}
        <div className="relative mt-5 flex items-center gap-3">
          <div className="h-7 w-9 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner ring-1 ring-amber-100/40" />
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-widest opacity-60">Contactless</span>
          </div>
        </div>
        <p className="relative mt-3 font-mono text-base tracking-widest opacity-90">•••• •••• •••• 4218</p>
        <div className="relative mt-4 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-70">Limite disponível</p>
            <p className="text-lg font-bold tabular-nums">R$ 4.820,00</p>
            <p className="mt-0.5 text-[10px] opacity-60">de R$ 8.000,00</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider opacity-70">Vence</p>
            <p className="text-sm font-semibold">15/12</p>
            <p className="text-[10px] opacity-60">VISA</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">Fatura aberta</p>
          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            Vence 15/12
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
        <p className="mt-1.5 text-[11px] text-slate-500">42% do limite utilizado</p>

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
          Marcar fatura como paga
        </button>
      </div>
    </MockShell>
  );
}

function MetaCover({ kind }: { kind: "apartment" | "beach" | "car" | "reserve" }) {
  if (kind === "apartment") {
    return (
      <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
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
              <rect key={`s-${r}-${c}`} x={340 + c * 24} y={112 + r * 20} width="14" height="11" rx="1.5" />
            )),
          )}
        </g>
        {/* small left building */}
        <rect x="140" y="120" width="55" height="100" fill="#0f172a" rx="3" />
        <g fill="#fde68a" opacity="0.85">
          {Array.from({ length: 4 }).map((_, r) =>
            Array.from({ length: 2 }).map((_, c) => (
              <rect key={`l-${r}-${c}`} x={150 + c * 20} y={130 + r * 22} width="12" height="11" rx="1.5" />
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
      <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
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
      <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
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
    <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
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
        <rect x="20" y="20" width="50" height="14" rx="3" fill="#fbbf24" transform="rotate(-12,45,27)" />
        <rect x="55" y="25" width="6" height="3" rx="1" fill="#0f172a" transform="rotate(-12,45,27)" />
        <rect x="45" y="120" width="10" height="20" fill="#f59e0b" />
        <rect x="95" y="120" width="10" height="20" fill="#f59e0b" />
        <circle cx="140" cy="48" r="2.5" fill="#0f172a" />
      </g>
    </svg>
  );
}

function MetaMock() {
  // Featured goal — emotional, easy to read
  const guardado = 1050;
  const objetivo = 10000;
  const pct = Math.round((guardado / objetivo) * 100);
  const falta = objetivo - guardado;

  const otherGoals: { name: string; pct: number; saved: string; cover: "beach" | "car" | "reserve" }[] = [
    { name: "Viagem para a praia", pct: 68, saved: "R$ 3.400", cover: "beach" },
    { name: "Comprar um carro", pct: 32, saved: "R$ 8.000", cover: "car" },
    { name: "Reserva de emergência", pct: 84, saved: "R$ 8.400", cover: "reserve" },
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
            style={{ background: "linear-gradient(180deg, rgba(15,23,42,0) 50%, rgba(15,23,42,0.45) 100%)" }}
          />
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-blue-700 backdrop-blur">
            <Target className="h-3 w-3" /> Meta ativa
          </div>
          <div className="absolute bottom-2 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur">
            <Calendar className="h-3 w-3" /> Dez · 2027
          </div>
          <div className="absolute bottom-2 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-bold text-white shadow">
            <TrendingUp className="h-3 w-3" /> {pct}%
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Meta · Imóvel</p>
          <h4 className="mt-0.5 text-lg font-bold text-slate-900">Entrada do apartamento</h4>

          {/* Saved + total */}
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-medium text-slate-500">Guardado</p>
              <p className="text-2xl font-extrabold tabular-nums text-slate-900">
                R$ {guardado.toLocaleString("pt-BR")},00
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium text-slate-500">Objetivo</p>
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
              <span className="font-semibold text-emerald-700">{pct}% concluído</span>
              <span className="text-slate-500">
                Faltam <span className="font-semibold text-slate-700">R$ {falta.toLocaleString("pt-BR")},00</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Other goals — variety */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Outras metas</p>
          <span className="text-[10px] font-medium text-slate-400">3 ativas</span>
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
                <p className="line-clamp-1 text-[10px] font-semibold leading-tight text-slate-800 sm:text-[11px]">{g.name}</p>
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

function InvestimentosMock() {
  const classes = [
    { l: "Renda fixa", v: "R$ 22,4k", pct: 46, color: "#10b981", chip: "+1,8%" },
    { l: "Ações", v: "R$ 14,1k", pct: 29, color: "#3b82f6", chip: "+6,4%" },
    { l: "Fundos", v: "R$ 11,8k", pct: 25, color: "#a855f7", chip: "+2,1%" },
  ];
  return (
    <MockShell>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Carteira</p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 48.320,90</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Patrimônio total · 12 meses</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <ArrowUpRight className="h-3.5 w-3.5" /> +4,2%
          </span>
          <span className="text-[10px] font-medium text-slate-400">vs. mês anterior</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-emerald-50/40 to-white p-3">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span>Evolução</span>
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
            <p className="text-[9px] text-slate-500 sm:text-[10px]">{c.pct}% da carteira</p>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function GuardadoMock() {
  const items = [
    { l: "Nubank", v: "R$ 2.100", pct: 43, color: "bg-violet-100 text-violet-700", bar: "bg-violet-500" },
    { l: "Inter", v: "R$ 1.480", pct: 30, color: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
    { l: "C6 Bank", v: "R$ 980", pct: 20, color: "bg-slate-200 text-slate-800", bar: "bg-slate-500" },
    { l: "Carteira", v: "R$ 320", pct: 7, color: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  ];
  return (
    <MockShell>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Total guardado</p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 4.880,00</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Reservas em 4 contas</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" /> Reserva segura
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
          <li key={it.l} className="rounded-xl border border-slate-200 bg-white p-3 transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(15,23,42,0.25)]">
            <div className="flex items-center justify-between">
              <BrandLogo name={it.l} variant="bank" className="h-8 w-8" />
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

/* ============================== FOR WHO ============================== */

function ForWho() {
  const items = [
    "Pessoa física",
    "MEI",
    "Autônomos",
    "Pequenos negócios",
    "Quem quer sair da bagunça financeira",
    "Quem quer trocar planilhas por uma ferramenta visual",
  ];
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Para quem é"
          title="Feito para quem quer enxergar melhor o próprio dinheiro."
          subtitle="Do controle pessoal ao acompanhamento de pequenas rotinas financeiras, o Gasto Inteligente foi pensado para você."
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
  const points = [
    "Sem complicação",
    "Visual fácil de entender",
    "Organização mensal",
    "Controle por categorias",
    "Ideal para rotina pessoal e MEI",
    "Acesso pelo navegador",
    "Pensado para uso diário",
  ];
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

function PlanCardItem({ plan: p, index: i }: { plan: (typeof COMMERCIAL_PLANS)[number]; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const tag = HIGHLIGHT[p.tier];
  const featured = !!tag;
  const audience = PLAN_AUDIENCE[p.tier];
  const [priceMain, pricePer] = p.priceLabel.split("/");
  const hasMore = p.highlights.length > VISIBLE_HIGHLIGHTS;
  const visibleItems = expanded ? p.highlights : p.highlights.slice(0, VISIBLE_HIGHLIGHTS);

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
              {audience.label}
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
              {tag.label}
            </span>
          )}
        </div>

        <h3 className={cn("relative mt-3 text-base lg:text-[1.0625rem] font-bold tracking-tight", featured ? "text-white" : "text-slate-900")}>
          {p.name}
        </h3>
        <p
          className={cn(
            "relative mt-1 min-h-[34px] text-xs leading-snug",
            featured ? "text-slate-300" : "text-slate-500",
          )}
        >
          {PLAN_DESCRIPTIONS[p.tier]}
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
          <span className={cn("text-xs font-medium", featured ? "text-slate-400" : "text-slate-500")}>
            /{(pricePer || "mês").trim()}
          </span>
        </div>
        <p className={cn("relative mt-0.5 text-[11px]", featured ? "text-slate-400" : "text-slate-400")}>
          Cancele quando quiser
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
                  featured ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-50 text-emerald-700",
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
            {expanded ? "Ver menos" : `Ver todos os ${p.highlights.length} recursos`}
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
          Escolher plano
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Reveal>
  );
}

function Plans() {
  return (
    <section id="planos" className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/40 to-white py-20 sm:py-24">
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
          eyebrow="Planos"
          title="Escolha o plano ideal para sua rotina financeira."
          subtitle="Escolha o plano que combina com sua rotina e evolua conforme sua organização crescer."
          center
        />

        {/* audience chips (decorative legend) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700 ring-1 ring-blue-100">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Pessoa Física
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-100">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> MEI
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-700 ring-1 ring-violet-100">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Empresa
          </span>
        </div>

        <div className="mx-auto mt-12 grid max-w-md grid-cols-1 items-stretch gap-5 sm:max-w-3xl sm:grid-cols-2 sm:gap-6 lg:max-w-6xl lg:grid-cols-3 xl:max-w-[1380px] xl:grid-cols-5 xl:gap-4 2xl:gap-5">
          {COMMERCIAL_PLANS.map((p, i) => (
            <PlanCardItem key={p.tier} plan={p} index={i} />
          ))}
        </div>

        {/* Trust microcopy under plans */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Pagamento seguro
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Sem fidelidade
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-emerald-600" /> Acesso imediato
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-emerald-600" /> Atualizações inclusas
          </span>
        </div>

        {/* Helper note */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-slate-500">
          Não sabe qual escolher?{" "}
          <a href="#faq" onClick={(e) => handleAnchorClick(e, "#faq")} className="font-semibold text-blue-700 underline-offset-2 hover:underline">
            Veja as dúvidas frequentes
          </a>{" "}
          ou comece pelo plano mais próximo do seu momento — você pode evoluir depois.
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
  const explainers = [
    {
      icon: CreditCard,
      tone: "from-blue-500 to-sky-500",
      title: "Cartões de qualquer banco",
      text: "Cadastre Visa, Master, Elo ou cartões digitais — controle limite, fatura e parcelas.",
    },
    {
      icon: Receipt,
      tone: "from-emerald-500 to-teal-500",
      title: "Contas, Pix e boletos",
      text: "Lance entradas e saídas de qualquer conta corrente, poupança ou carteira digital.",
    },
    {
      icon: PiggyBank,
      tone: "from-violet-500 to-fuchsia-500",
      title: "Reservas e guardado",
      text: "Acompanhe quanto você guarda em cada banco e veja o total reservado num só lugar.",
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
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Eyebrow>Funciona com qualquer banco</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            Organize sua vida financeira independentemente do banco que você usa.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            Você lança seus gastos, contas e cartões de qualquer banco ou carteira digital.
            Sem integração obrigatória — você no controle.
          </p>
        </div>

        {/* Logos marquee — single line, infinite loop */}
        <div
          className="banks-marquee relative mt-12 overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)",
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
          Marcas e logos pertencem a seus respectivos donos. Uso meramente ilustrativo.
        </p>
      </div>
    </section>
  );
}

/* ============================== TESTIMONIALS ============================== */

const TESTIMONIALS = [
  {
    name: "Camila R.",
    role: "Designer · Pessoa Física",
    text: "Finalmente parei de me perder com planilhas. Em uma semana já tinha clareza de para onde meu dinheiro estava indo.",
    initials: "CR",
    color: "from-blue-500 to-sky-500",
  },
  {
    name: "Rafael M.",
    role: "MEI · Confeitaria",
    text: "Separar pessoal e negócio ficou simples. As metas e os alertas me ajudam a fechar o mês no azul sempre.",
    initials: "RM",
    color: "from-emerald-500 to-teal-500",
  },
  {
    name: "Juliana A.",
    role: "Autônoma",
    text: "A visão do mês é incrível. Consigo entender o que pagar, o que adiar e o que sobra para guardar.",
    initials: "JA",
    color: "from-violet-500 to-fuchsia-500",
  },
];

function Testimonials() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/60 to-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Quem já usa"
          title="Pessoas reais, controle financeiro de verdade."
          subtitle="Histórias de quem trocou a bagunça por uma rotina financeira leve e clara."
          center
        />
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.06}>
              <div className="group relative h-full rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_18px_44px_-26px_rgba(15,23,42,0.22)] transition-all hover:-translate-y-1 hover:shadow-[0_28px_56px_-26px_rgba(15,23,42,0.30)]">
                <Quote className="absolute right-5 top-5 h-8 w-8 text-slate-100 transition-colors group-hover:text-blue-100" />
                <div className="flex items-center gap-1 text-amber-400">
                  {Array.from({ length: 5 }).map((_, k) => (
                    <Star key={k} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-700">"{t.text}"</p>
                <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
                  <span
                    className={cn(
                      "grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow",
                      t.color,
                    )}
                  >
                    {t.initials}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{t.name}</p>
                    <p className="text-[11px] text-slate-500">{t.role}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== FAQ ============================== */

const FAQS = [
  {
    q: "O que é o Gasto Inteligente?",
    a: "É uma plataforma de controle financeiro que ajuda você a organizar gastos, cartões, contas, metas, renda e investimentos em um só lugar, com uma visão simples e fácil de entender.",
  },
  {
    q: "Preciso entender de finanças para usar?",
    a: "Não. O sistema foi pensado para ser simples e visual, mesmo para quem não entende muito de finanças.",
  },
  {
    q: "Posso controlar cartões e faturas?",
    a: "Sim. Você acompanha compras, faturas, vencimentos, limite usado e pagamento da fatura em um só lugar.",
  },
  {
    q: "Consigo separar gastos por mês de referência?",
    a: "Sim. O sistema trabalha com mês de referência, então você define a qual mês cada gasto pertence — perfeito para faturas e contas que pagam um mês mas se referem a outro.",
  },
  {
    q: "O sistema ajuda com metas financeiras?",
    a: "Sim. Você cria metas, acompanha quanto já foi reservado, quanto falta e visualiza a evolução até o objetivo.",
  },
  {
    q: "Existe plano para MEI?",
    a: "Sim. Temos os planos MEI Essencial e MEI Inteligente, com linguagem e recursos pensados para o seu negócio.",
  },
  {
    q: "Posso acessar pelo celular?",
    a: "Sim. O Gasto Inteligente é totalmente responsivo e funciona muito bem no celular, tablet e computador, direto pelo navegador.",
  },
  {
    q: "O modo dark existe?",
    a: "O modo dark/light fica disponível dentro da área logada do usuário. A página pública de apresentação usa visual claro para facilitar a leitura.",
  },
  {
    q: "Como faço para começar?",
    a: "Clique em “Começar agora” no topo da página, crie sua conta gratuitamente e escolha o plano que combina com você.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Dúvidas"
          title="Perguntas frequentes"
          subtitle="Se ainda restou alguma dúvida, fale com a gente."
          center
        />
        <div className="mt-10 space-y-3">
          {FAQS.map((f, i) => {
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
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-emerald-500/30 blur-3xl" />

          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
            {/* Copy */}
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur">
                <Sparkles className="h-3 w-3" /> Comece em minutos
              </span>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.6rem] lg:leading-[1.1]">
                Pronto para organizar sua vida financeira?
              </h2>
              <p className="mt-4 max-w-xl text-base text-slate-200 sm:text-lg">
                Comece hoje e tenha uma visão mais clara do seu dinheiro, dos seus gastos e dos seus objetivos.
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/cadastro"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 shadow-[0_18px_36px_-12px_rgba(255,255,255,0.35)] transition-transform hover:-translate-y-0.5"
                >
                  Criar minha conta
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#planos"
                  onClick={(e) => handleAnchorClick(e, "#planos")}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  Ver planos
                </a>
              </div>

              <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
                <li className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Sem fidelidade</li>
                <li className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Cancele quando quiser</li>
                <li className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Acesso pelo navegador</li>
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Visão geral</p>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    +12% este mês
                  </span>
                </div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">R$ 6.420,00</p>
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
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Meta</p>
                    <p className="text-sm font-bold text-slate-900">68% concluída</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">A pagar</p>
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Meta</p>
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

function Footer() {
  return (
    <footer className="relative border-t border-slate-200 bg-gradient-to-b from-white to-slate-50">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-12">
          {/* Brand */}
          <div className="lg:col-span-4">
            <BrandMark className="h-8 w-auto" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
              Gasto Inteligente — controle financeiro simples, visual e pensado para o seu dia a dia.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Dados protegidos
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                <Zap className="h-3.5 w-3.5 text-blue-600" /> Rápido e leve
              </span>
            </div>
          </div>

          {/* Produto */}
          <div className="lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Produto</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="#recursos" onClick={(e) => handleAnchorClick(e, "#recursos")} className="transition-colors hover:text-slate-900">Recursos</a></li>
              <li><a href="#telas" onClick={(e) => handleAnchorClick(e, "#telas")} className="transition-colors hover:text-slate-900">Como funciona</a></li>
              <li><a href="#planos" onClick={(e) => handleAnchorClick(e, "#planos")} className="transition-colors hover:text-slate-900">Planos</a></li>
              <li><a href="#faq" onClick={(e) => handleAnchorClick(e, "#faq")} className="transition-colors hover:text-slate-900">Dúvidas</a></li>
            </ul>
          </div>

          {/* Conta */}
          <div className="lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Conta</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li><Link to="/login" className="transition-colors hover:text-slate-900">Entrar</Link></li>
              <li><Link to="/cadastro" className="transition-colors hover:text-slate-900">Cadastrar-se</Link></li>
              <li><Link to="/recuperar-senha" className="transition-colors hover:text-slate-900">Recuperar senha</Link></li>
            </ul>
          </div>

          {/* Suporte */}
          <div className="lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Suporte</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="#faq" onClick={(e) => handleAnchorClick(e, "#faq")} className="transition-colors hover:text-slate-900">Central de ajuda</a></li>
              <li><a href="mailto:contato@gastointeligente.com.br" className="transition-colors hover:text-slate-900">Fale conosco</a></li>
              <li><span className="text-slate-400">Status do sistema</span></li>
            </ul>
          </div>

          {/* Legal */}
          <div className="lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Legal</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li><span className="text-slate-400">Termos de uso</span></li>
              <li><span className="text-slate-400">Política de privacidade</span></li>
              <li><span className="text-slate-400">LGPD</span></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Gasto Inteligente. Todos os direitos reservados.</p>
          <p className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Feito com cuidado para sua vida financeira.
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
      <h2 className="mt-3 text-[1.65rem] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {subtitle && (
        <p className={cn("mt-3 text-base text-slate-600", center ? "mx-auto max-w-2xl" : "max-w-2xl")}>
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
