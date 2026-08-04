import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  Wallet,
  Info,
  ShieldCheck,
  Sparkles,
  Building2,
  Landmark,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";

export const Route = createFileRoute("/app_/integracoes/")({
  head: () => ({
    meta: [
      { title: "Integrações — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Conecte sua conta Mercado Pago ao Gasto Inteligente para importar movimentações automaticamente.",
      },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <IntegracoesIndexPage />
    </AdminMasterGate>
  ),
});

function IntegracoesIndexPage() {
  return (
    <MobileShell>
      {/* Header */}
      <header className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Conta
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">Integrações</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Conecte serviços para importar movimentações automaticamente e automatizar seu controle
            financeiro.
          </p>
        </div>
      </header>

      {/* Banner de segurança */}
      <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-card-elevated/60 p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Conexão segura e oficial</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              As integrações importam movimentações automaticamente por autorização oficial (OAuth).
              Sua senha nunca é exposta e os tokens ficam armazenados de forma segura no servidor.
            </p>
          </div>
        </div>
      </section>

      {/* Disponíveis agora */}
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Disponíveis agora
          </h2>
          <span className="text-[11px] text-muted-foreground">1 serviço</span>
        </div>

        <Link
          to="/app/integracoes/mercado-pago"
          className="group relative block overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card-elevated hover:shadow-lg"
        >
          {/* Glow decorativo */}
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[hsl(45_100%_50%/0.08)] blur-2xl transition-opacity group-hover:opacity-100" />

          <div className="relative flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(45_100%_50%/0.15)] text-[hsl(45_100%_45%)] ring-1 ring-[hsl(45_100%_50%/0.25)]">
              <Wallet className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold leading-tight">Mercado Pago</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Disponível
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Importe pagamentos, recebimentos, Pix e movimentações da sua conta Mercado Pago de
                forma automática.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Pix", "Pagamentos", "Recebimentos", "Cartão"].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border/60 bg-card-elevated/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>
      </section>

      {/* Em breve */}
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Em breve
          </h2>
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ComingSoonCard
            icon={<Building2 className="h-5 w-5" />}
            name="Open Finance"
            description="Nubank, Itaú, Bradesco e outros bancos via conexão oficial."
          />
          <ComingSoonCard
            icon={<Landmark className="h-5 w-5" />}
            name="Contas digitais"
            description="Conecte carteiras e bancos digitais para sincronização automática."
          />
        </div>
      </section>

      {/* Aviso final */}
      <section className="mt-7 flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
          <Info className="h-4 w-4" />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Para importar dados de outros bancos como{" "}
          <span className="font-medium text-foreground">Nubank</span>,{" "}
          <span className="font-medium text-foreground">Itaú</span> e{" "}
          <span className="font-medium text-foreground">Bradesco</span>, será necessário Open
          Finance — em breve no Gasto Inteligente.
        </p>
      </section>
    </MobileShell>
  );
}

function ComingSoonCard({
  icon,
  name,
  description,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 p-4 opacity-90">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/50 text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground/90">{name}</p>
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Em breve
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
