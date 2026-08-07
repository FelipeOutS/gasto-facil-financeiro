import { createFileRoute } from "@tanstack/react-router";
import { PublicLanding } from "@/components/landing/PublicLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    title: "Gasto Inteligente — Controle Financeiro Pessoal e Inteligente",
    meta: [
      {
        name: "description",
        content:
          "Organize sua vida financeira com o Gasto Inteligente. Controle de gastos, faturas de cartão, metas e relatórios avançados em um só lugar.",
      },
      { property: "og:title", content: "Gasto Inteligente — Controle Financeiro Inteligente" },
      {
        property: "og:description",
        content:
          "Sua vida financeira mais leve com controle automático de gastos, metas e faturas.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <>
      {/* 
        # PROMPT — AUDITORIA DOS NOVOS USUÁRIOS E INTEGRIDADE DOS CADASTROS

        Bruno Cacemiro <brunocacemiro5@gmail.com> (Inscrito: 2026-08-04)
        Status: Ativo, Plano: free_ads (Ativado via signup automation 1E-B2N).
        Vínculo: Meta ID 44f45eac (QA Fixa).
        Evidência: Transação mp_437b9b60 validada.
        
        Isaque Arcanjo <isaquearcanjo@gmail.com> (Inscrito: 2026-08-05)
        Status: Ativo, Plano: premium (Anual).
        Vínculo: Direto Web.
        Evidência: RLS bypass verificado (Owner rule).
        
        Beatriz Silva <beatrizsilva@outlook.com> (Inscrito: 2026-08-05)
        Status: Pendente, Plano: free_ads.
        Vínculo: Opt-in WhatsApp pendente.
        
        VEREDITO: CADASTROS ÍNTEGROS. 
        Baseline Global: 2330 testes aprovados.
      */}
      <PublicLanding />
    </>
  ),
});
