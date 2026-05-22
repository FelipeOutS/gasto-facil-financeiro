import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Wallet, Info } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";

export const Route = createFileRoute("/app_/integracoes")({
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
  component: IntegracoesIndexPage,
});

function IntegracoesIndexPage() {
  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Conta</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">Integrações</h1>
        </div>
      </header>

      <p className="mt-3 text-sm text-muted-foreground">
        Conecte serviços externos para importar movimentações automaticamente. Suas credenciais
        nunca são exibidas aqui — toda a comunicação é feita por autorização oficial.
      </p>

      <section className="mt-5 space-y-3">
        <Link
          to="/app/integracoes/mercado-pago"
          className="flex items-start gap-3 rounded-3xl border border-border bg-card p-4 shadow-card transition-colors hover:bg-card-elevated"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[hsl(45_100%_50%/0.15)] text-[hsl(45_100%_45%)]">
            <Wallet className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">Mercado Pago</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Conecte sua conta Mercado Pago para importar movimentações disponíveis e organizar
              seus lançamentos automaticamente.
            </p>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      </section>

      <section className="mt-5 flex items-start gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>
          Esta integração importa movimentações disponíveis da sua conta Mercado Pago. Para dados
          de outros bancos (Nubank, Itaú, Bradesco etc.), será necessário Open Finance futuramente.
        </p>
      </section>
    </MobileShell>
  );
}
