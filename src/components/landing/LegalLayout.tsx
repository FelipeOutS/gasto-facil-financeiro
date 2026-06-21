import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Footer as PublicFooter } from "@/components/landing/PublicLanding";

type Props = {
  title: string;
  eyebrow?: string;
  updatedAt?: string;
  children: React.ReactNode;
};

/**
 * Layout simples e público para páginas institucionais (Termos, Privacidade,
 * LGPD, Status). Mantém a estética leve e clara da landing — sem tema dark
 * vazando da área logada.
 */
export function LegalLayout({ title, eyebrow = "Institucional", updatedAt, children }: Props) {
  return (
    <div
      className="gi-landing min-h-screen bg-white text-slate-900 antialiased"
      style={{ colorScheme: "light" }}
    >
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/logos/brand/logo-gasto-inteligente-completo-light.svg"
              alt="Gasto Inteligente"
              className="h-9 w-auto sm:h-10 object-contain"
              draggable={false}
            />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o início
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {eyebrow}
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          {title}
        </h1>
        {updatedAt && (
          <p className="mt-2 text-sm text-slate-500">Última atualização: {updatedAt}</p>
        )}

        <div className="legal-content mt-8 space-y-5 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:font-medium [&_a]:text-blue-700 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-slate-900">
          {children}
        </div>

        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          <p>
            Este é um conteúdo informativo inicial. Para dúvidas, entre em contato pelo e-mail{" "}
            <a
              href="mailto:contato@gastointeligente.com.br"
              className="font-semibold text-blue-700 hover:underline"
            >
              contato@gastointeligente.com.br
            </a>
            .
          </p>
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a página inicial
          </Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
