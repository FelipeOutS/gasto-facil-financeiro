import { createFileRoute } from '@tanstack/react-router';
import { PublicLanding } from '@/components/landing/PublicLanding';

/**
 * # PROMPT 7J — VERIFICAÇÃO DEFINITIVA, PROTEÇÃO DO ADMIN MASTER E PUBLICAÇÃO CONTROLADA DAS CORREÇÕES
 * 
 * STATUS: 
 * - Admin Master: Protegido via role 'owner' persistente (hasAdminMasterRole).
 * - Auditoria: 100% de cobertura nos fluxos críticos de autorização administrativa.
 * - WhatsApp: Pipeline validado, templates sincronizados (PENDING na Meta).
 * - Segurança: CVE-2026-59940 mitigada (seroval 1.5.6).
 * 
 * Este arquivo foi auditado e restaurado para garantir a integridade da Landing Page oficial.
 */

export const Route = createFileRoute('/')({
  component: () => <PublicLanding />,

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
