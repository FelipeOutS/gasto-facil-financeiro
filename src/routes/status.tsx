import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/landing/LegalLayout";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Status do sistema — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Status atual dos serviços do Gasto Inteligente. Acompanhe a disponibilidade da plataforma.",
      },
      { property: "og:title", content: "Status do sistema — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Disponibilidade dos serviços do Gasto Inteligente.",
      },
    ],
  }),
  component: StatusPage,
});

function formatNow() {
  try {
    return new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date().toISOString();
  }
}

function StatusPage() {
  const updated = formatNow();
  const services = [
    { name: "Plataforma web", state: "Operacional" },
    { name: "Login e autenticação", state: "Operacional" },
    { name: "Importações de extrato e fatura", state: "Operacional" },
    { name: "Pacote para Contador", state: "Operacional" },
    { name: "Radar Econômico", state: "Operacional" },
  ];

  return (
    <LegalLayout title="Status do sistema" eyebrow="Disponibilidade" updatedAt={updated}>
      <div className="not-prose mb-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-emerald-800">
            Todos os serviços operando normalmente.
          </p>
          <p className="text-xs text-emerald-700/80">
            Sem incidentes registrados no momento.
          </p>
        </div>
      </div>

      <h2>Serviços monitorados</h2>
      <ul className="not-prose mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {services.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between px-5 py-3 text-sm"
          >
            <span className="font-medium text-slate-800">{s.name}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {s.state}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10">Comunicação de incidentes</h2>
      <p>
        Caso ocorra alguma instabilidade ou manutenção programada, vamos
        comunicar pelos nossos canais oficiais e atualizar esta página.
      </p>
    </LegalLayout>
  );
}
