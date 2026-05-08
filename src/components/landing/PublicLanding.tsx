import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
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
        <a href="#top" className="flex items-center gap-2">
          <BrandMark className="h-8 w-auto" />
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
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
                onClick={() => setOpen(false)}
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
            className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.6rem]"
          >
            Controle suas finanças com mais{" "}
            <span className="relative inline-block bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 bg-clip-text text-transparent">
              clareza, inteligência
              <svg
                aria-hidden
                viewBox="0 0 300 12"
                className="absolute -bottom-2 left-0 h-2.5 w-full"
                preserveAspectRatio="none"
              >
                <path
                  d="M2,7 Q75,1 150,6 T298,5"
                  fill="none"
                  stroke="url(#hero-underline)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="hero-underline" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
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
              <it.icon className="h-4.5 w-4.5" />
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

function ScreensTabs() {
  const [active, setActive] = useState<ScreenKey>("dashboard");
  const current = SCREENS.find((s) => s.key === active)!;
  return (
    <section id="telas" className="bg-gradient-to-b from-slate-50 to-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Veja por dentro"
          title="As telas que organizam toda a sua rotina financeira."
          subtitle="Navegue pelas principais áreas do Gasto Inteligente."
        />
        {/* tabs */}
        <div className="mt-10 flex snap-x gap-2 overflow-x-auto pb-2 md:flex-wrap md:justify-center md:overflow-visible">
          {SCREENS.map((s) => {
            const Icon = s.icon;
            const isActive = s.key === active;
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  "snap-start inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_22px_-12px_rgba(15,23,42,0.55)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                )}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
        {/* preview */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
          <motion.div
            key={active + "-text"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="lg:col-span-5"
          >
            <h3 className="text-2xl font-bold text-slate-900 sm:text-3xl">{current.label}</h3>
            <p className="mt-3 text-base leading-relaxed text-slate-600">{current.desc}</p>
            <Link
              to="/cadastro"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800"
            >
              Conhecer o sistema
              <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
          <motion.div
            key={active + "-mock"}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-7"
          >
            <ScreenMock keyName={active} />
          </motion.div>
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
  return <div className="mx-auto w-full max-w-[600px]">{inner}</div>;
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Gastos · mês</p>
          <p className="text-base font-bold text-slate-900">R$ 3.277,20</p>
        </div>
        <div className="flex gap-1.5">
          {["Mês atual", "Categoria", "Pix", "Cartão"].map((p, i) => (
            <span
              key={p}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                i === 0
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
        {items.map((it) => (
          <li key={it.c} className="flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-3">
              <span className={cn("grid h-9 w-9 place-items-center rounded-xl text-xs font-bold", it.color)}>
                {it.c[0]}
              </span>
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
  return (
    <MockShell>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-5 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 h-40 w-40 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(59,130,246,0.4), transparent 70%)" }}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold opacity-80">Inteligente Black</p>
          <CreditCard className="h-5 w-5 opacity-80" />
        </div>
        <p className="mt-6 font-mono text-base tracking-widest opacity-90">•••• •••• •••• 4218</p>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-70">Limite disponível</p>
            <p className="text-lg font-bold tabular-nums">R$ 4.820,00</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider opacity-70">Vence</p>
            <p className="text-sm font-semibold">15/12</p>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700">Fatura aberta</p>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            Em aberto
          </span>
        </div>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">R$ 1.180,00</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-[42%] rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" />
        </div>
        <button className="mt-3 w-full rounded-full bg-slate-900 py-2 text-xs font-semibold text-white">
          Marcar fatura como paga
        </button>
      </div>
    </MockShell>
  );
}

function MetaMock() {
  return (
    <MockShell>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div
          className="h-32 w-full"
          style={{
            background:
              "linear-gradient(135deg, #38bdf8 0%, #6366f1 50%, #ec4899 100%)",
          }}
        />
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Meta</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              68%
            </span>
          </div>
          <p className="mt-1 text-lg font-bold text-slate-900">Viagem para a praia</p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: "68%" }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Guardado</p>
              <p className="text-sm font-bold tabular-nums text-slate-900">R$ 3.400</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Falta</p>
              <p className="text-sm font-bold tabular-nums text-slate-900">R$ 1.600</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
              <p className="text-sm font-bold tabular-nums text-slate-900">R$ 5.000</p>
            </div>
          </div>
        </div>
      </div>
    </MockShell>
  );
}

function InvestimentosMock() {
  return (
    <MockShell>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Carteira</p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 48.320,90</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          <ArrowUpRight className="h-3.5 w-3.5" /> +4,2%
        </span>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
        <svg viewBox="0 0 300 100" className="h-28 w-full">
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
          <path
            d="M0,80 L25,72 L50,76 L75,60 L100,64 L125,50 L150,55 L175,40 L200,46 L225,30 L250,36 L275,22 L300,18"
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { l: "Renda fixa", v: "R$ 22.4k" },
          { l: "Ações", v: "R$ 14.1k" },
          { l: "Fundos", v: "R$ 11.8k" },
        ].map((it) => (
          <div key={it.l} className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{it.l}</p>
            <p className="text-sm font-bold tabular-nums text-slate-900">{it.v}</p>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function GuardadoMock() {
  const items = [
    { l: "Nubank", v: "R$ 2.100", color: "bg-violet-100 text-violet-700" },
    { l: "Inter", v: "R$ 1.480", color: "bg-amber-100 text-amber-700" },
    { l: "C6 Bank", v: "R$ 980", color: "bg-slate-200 text-slate-800" },
    { l: "Carteira", v: "R$ 320", color: "bg-emerald-100 text-emerald-700" },
  ];
  return (
    <MockShell>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Total guardado</p>
        <p className="text-2xl font-extrabold tabular-nums text-slate-900">R$ 4.880,00</p>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2.5">
        {items.map((it) => (
          <li key={it.l} className="rounded-xl border border-slate-200 p-3">
            <span
              className={cn(
                "mb-2 inline-grid h-8 w-8 place-items-center rounded-lg text-xs font-bold",
                it.color,
              )}
            >
              {it.l[0]}
            </span>
            <p className="text-xs font-medium text-slate-500">{it.l}</p>
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
  pessoal_manual: "Para quem quer organizar tudo manualmente, com controle simples e direto.",
  pessoal_premium: "Mais automação e recursos completos para sua vida financeira.",
  mei_essencial: "O essencial para organizar as finanças do seu MEI.",
  mei_inteligente: "MEI com automação completa para ganhar tempo e clareza.",
  empresa: "Visão financeira completa para empresas que precisam de mais controle.",
  admin_master: "",
};

const HIGHLIGHT: Partial<Record<PlanTier, string>> = {
  pessoal_premium: "Mais escolhido",
  mei_inteligente: "Recomendado MEI",
};

function Plans() {
  return (
    <section id="planos" className="bg-white py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Planos"
          title="Escolha o plano ideal para sua rotina financeira."
          subtitle="Comece com o plano que combina com o seu momento e evolua conforme sua organização financeira crescer."
        />
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
          {COMMERCIAL_PLANS.map((p, i) => {
            const tag = HIGHLIGHT[p.tier];
            const featured = !!tag;
            return (
              <Reveal key={p.tier} delay={i * 0.05}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-3xl border p-6 transition-all hover:-translate-y-1",
                    featured
                      ? "border-slate-900 bg-slate-900 text-white shadow-[0_30px_60px_-25px_rgba(15,23,42,0.55)]"
                      : "border-slate-200 bg-white shadow-[0_14px_36px_-22px_rgba(15,23,42,0.18)]",
                  )}
                >
                  {tag && (
                    <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-blue-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow">
                      <Sparkles className="h-3 w-3" /> {tag}
                    </span>
                  )}
                  <h3 className={cn("text-lg font-bold", featured ? "text-white" : "text-slate-900")}>
                    {p.name}
                  </h3>
                  <p className={cn("mt-1 text-xs leading-relaxed", featured ? "text-slate-300" : "text-slate-500")}>
                    {PLAN_DESCRIPTIONS[p.tier]}
                  </p>
                  <div className="mt-5">
                    <p className={cn("text-3xl font-extrabold tabular-nums", featured ? "text-white" : "text-slate-900")}>
                      {p.priceLabel.split("/")[0]}
                    </p>
                    <p className={cn("text-xs", featured ? "text-slate-400" : "text-slate-500")}>/mês</p>
                  </div>
                  <ul className="mt-5 flex-1 space-y-2">
                    {p.highlights.map((h) => (
                      <li
                        key={h}
                        className={cn(
                          "flex items-start gap-2 text-xs leading-relaxed",
                          featured ? "text-slate-200" : "text-slate-700",
                        )}
                      >
                        <CheckCircle2
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0",
                            featured ? "text-emerald-400" : "text-emerald-600",
                          )}
                        />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/cadastro"
                    className={cn(
                      "mt-6 inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition-all",
                      featured
                        ? "bg-white text-slate-900 hover:bg-slate-100"
                        : "bg-slate-900 text-white hover:bg-slate-800",
                    )}
                  >
                    Escolher plano
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================== BANKS STRIP ============================== */

const BANKS = [
  { name: "Nubank", src: "/logos/bancos/nubank.svg" },
  { name: "Itaú", src: "/logos/bancos/itau.svg" },
  { name: "Inter", src: "/logos/bancos/inter.svg" },
  { name: "Mercado Pago", src: "/logos/bancos/mercado-pago.svg" },
  { name: "Caixa", src: "/logos/bancos/caixa.svg" },
  { name: "Banco do Brasil", src: "/logos/bancos/banco-do-brasil.svg" },
  { name: "Bradesco", src: "/logos/bancos/bradesco.svg" },
  { name: "Santander", src: "/logos/bancos/santander.svg" },
  { name: "PicPay", src: "/logos/bancos/picpay.svg" },
  { name: "C6 Bank", src: "/logos/bancos/c6-bank.svg" },
];

function BanksStrip() {
  return (
    <section className="relative overflow-hidden border-y border-slate-100 bg-white py-16 sm:py-20">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
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
        <div className="mt-10 grid grid-cols-3 items-center gap-x-6 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10">
          {BANKS.map((b, i) => (
            <Reveal key={b.name} delay={i * 0.03}>
              <div
                className="group flex h-14 items-center justify-center"
                title={b.name}
              >
                <img
                  src={b.src}
                  alt={b.name}
                  loading="lazy"
                  draggable={false}
                  className="max-h-9 w-auto max-w-[110px] object-contain opacity-60 grayscale transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0"
                />
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
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-[32px] p-10 text-center text-white sm:p-14"
          style={{
            background:
              "radial-gradient(80% 120% at 0% 0%, #1e40af 0%, transparent 60%), radial-gradient(60% 90% at 100% 100%, #10b981 0%, transparent 60%), linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.18) 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />
          {/* floating decorative chips */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-4 top-8 hidden rotate-[-6deg] items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white backdrop-blur md:flex"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/30 text-emerald-200">
              <Target className="h-4 w-4" />
            </span>
            <div className="text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Meta</p>
              <p className="text-xs font-bold">68% concluída</p>
            </div>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-4 bottom-8 hidden rotate-[5deg] items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white backdrop-blur md:flex"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-400/30 text-blue-200">
              <TrendingUp className="h-4 w-4" />
            </span>
            <div className="text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Mês</p>
              <p className="text-xs font-bold tabular-nums">+12% vs anterior</p>
            </div>
          </div>
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Pronto para organizar sua vida financeira?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-200 sm:text-lg">
              Comece hoje e tenha uma visão mais clara do seu dinheiro, dos seus gastos e dos seus
              objetivos.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/cadastro"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 shadow-lg transition-transform hover:-translate-y-0.5"
              >
                Criar minha conta
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#planos"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/10"
              >
                Ver planos
              </a>
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
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div>
          <BrandMark className="h-8 w-auto" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
            Gasto Inteligente — controle financeiro simples, visual e pensado para o seu dia a dia.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Produto</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li><a href="#recursos" className="hover:text-slate-900">Recursos</a></li>
            <li><a href="#telas" className="hover:text-slate-900">Como funciona</a></li>
            <li><a href="#planos" className="hover:text-slate-900">Planos</a></li>
            <li><a href="#faq" className="hover:text-slate-900">Dúvidas</a></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Conta</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li><Link to="/login" className="hover:text-slate-900">Entrar</Link></li>
            <li><Link to="/cadastro" className="hover:text-slate-900">Cadastrar-se</Link></li>
            <li><Link to="/recuperar-senha" className="hover:text-slate-900">Recuperar senha</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Legal</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li><span className="text-slate-400">Termos de uso</span></li>
            <li><span className="text-slate-400">Política de privacidade</span></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Gasto Inteligente. Todos os direitos reservados.</p>
          <p>Feito com cuidado para sua vida financeira.</p>
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
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
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
      .gi-landing { color-scheme: light; }
      .gi-landing, .gi-landing * { border-color: rgb(226 232 240); }
      .gi-landing ::selection { background: rgba(59,130,246,0.18); }
    `}</style>
  );
}
