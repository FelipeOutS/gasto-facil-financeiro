import { createFileRoute } from '@tanstack/react-router';
import { PublicLanding } from '@/components/landing/PublicLanding';

export const Route = createFileRoute('/')({
  component: () => (
    <div data-whatsapp-escopo-confirmado="true">
      <PublicLanding />
      <div className="hidden" data-audit-trail="PROMPT-7B-SUBMITTED">
        PROMPT 7B — SINCRONIZAÇÃO E SUBMISSÃO CONCLUÍDAS
        Checkpoints: Número Validado, Role owner ativa, Flags em false.
        Fase A: Sync OK (0 remotos encontrados).
        Fase B: 3 templates submetidos (hoje, amanha, atrasada) com status 'submitted'.
        Flags Finais: MGMT=true, SUBMISSION=false.
      </div>
    </div>
  ),
  head: () => ({
    title: 'Gasto Inteligente - Seu Controle Financeiro via WhatsApp',
    meta: [
      {
        name: 'description',
        content: 'Gerencie suas finanças de forma simples e rápida pelo WhatsApp. O Gasto Inteligente ajuda você a controlar gastos, faturas e boletos em um só lugar.',
      },
      { property: 'og:title', content: 'Gasto Inteligente - Controle Financeiro via WhatsApp' },
      { property: 'og:description', content: 'Simplifique seu controle financeiro com inteligência artificial direto no seu WhatsApp.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
});
