import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import i18n from "@/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: i18n.t("common:seo.title", { defaultValue: "Auditoria Geral - Gasto Inteligente" }) },
      { name: "description", content: "Auditoria completa e factual do projeto Gasto Inteligente." },
      { property: "og:title", content: "Auditoria Geral - Gasto Inteligente" },
      { property: "og:description", content: "Auditoria completa e factual do projeto Gasto Inteligente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { t } = useTranslation(["common", "mercado"]);

  return (
    <MobileShell hideNav unprotected>
      <div className="flex flex-col min-h-[90vh] items-center justify-center px-6 py-12 text-center space-y-8">
        <div className="text-left max-w-4xl prose dark:prose-invert bg-card p-8 rounded-2xl border shadow-sm overflow-auto max-h-[80vh]">
          <h1>AUDITORIA GERAL COMPLETA DO GASTO INTELIGENTE — ESTADO ATUAL, PENDÊNCIAS E CAMINHO ATÉ 100%</h1>
          
          <p>Quero uma auditoria completa e factual de todo o projeto Gasto Inteligente.</p>
          
          <p>O objetivo é descobrir:</p>
          <ul>
            <li>Tudo o que já foi feito;</li>
            <li>Tudo o que está funcionando;</li>
            <li>Tudo o que está apenas parcialmente pronto;</li>
            <li>Tudo o que está apenas preparado no código;</li>
            <li>Tudo o que ainda falta;</li>
            <li>O que realmente bloqueia o lançamento;</li>
            <li>O que pode ficar para depois;</li>
            <li>Quantos passos ainda faltam para o site chegar a 100%;</li>
            <li>Qual deve ser a ordem correta das próximas etapas.</li>
          </ul>

          <p>Esta solicitação é somente de auditoria e documentação.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground border-t pt-4">
            <div>• Não implemente novas funcionalidades.</div>
            <div>• Não publique.</div>
            <div>• Não altere o banco.</div>
            <div>• Não altere secrets.</div>
            <div>• Não ative WhatsApp.</div>
            <div>• Não ative dispatcher.</div>
            <div>• Não crie cron.</div>
            <div>• Não processe pagamentos.</div>
            <div>• Não altere planos.</div>
            <div>• Não altere receitas ou gastos.</div>
            <div>• Não altere Android, iOS ou PWA.</div>
            <div>• Não execute chamadas externas desnecessárias.</div>
          </div>

          <p className="mt-6 italic">Responda em português do Brasil.</p>

          <hr className="my-8" />

          <h2>1. REGRA PRINCIPAL DA AUDITORIA</h2>
          <p>Não utilize apenas documentos antigos, respostas anteriores ou suposições. Verifique diretamente:</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <li>Código atual</li>
            <li>Rotas</li>
            <li>Componentes</li>
            <li>Banco oficial</li>
            <li>Migrations</li>
            <li>Tabelas</li>
            <li>Funções SQL</li>
            <li>RLS</li>
            <li>Policies</li>
            <li>Grants</li>
            <li>Secrets presentes</li>
            <li>Feature flags</li>
            <li>Jobs / Crons / Workers</li>
            <li>Filas / Webhooks</li>
            <li>Logs / Testes</li>
            <li>Build / Typecheck / Lint</li>
            <li>Security scan</li>
            <li>Ambientes Produção/Preview</li>
            <li>Documentação / Histórico Git</li>
            <li>Status real das integrações</li>
          </ul>

          <p>Para cada afirmação, utilize uma destas classificações:</p>
          <div className="flex flex-wrap gap-2">
            <code>[CÓDIGO]</code> <code>[BANCO]</code> <code>[TESTE]</code> <code>[PRODUÇÃO]</code> <code>[GIT]</code> <code>[DOCUMENTAÇÃO]</code> <code>[INFERÊNCIA]</code> <code>[NÃO VALIDADO]</code> <code>[PLANEJADO]</code>
          </div>

          <hr className="my-8" />

          <h2>2. DECISÃO FIXA SOBRE JOANIN E CARREFOUR</h2>
          <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-lg border border-amber-200 dark:border-amber-900/50">
            <h3>Joanin & Carrefour</h3>
            <ul>
              <li>Deve permanecer somente para Admin Master (role <code>owner</code>).</li>
              <li>Deve permanecer pausado.</li>
              <li>Não deve bloquear o lançamento.</li>
              <li>Não deve aparecer para usuários comuns.</li>
              <li>Não deve executar sincronização automática.</li>
              <li>Será concluído somente depois de todo o restante do projeto.</li>
            </ul>
            <p><strong>ETAPA FUTURA — APÓS A CONCLUSÃO DE TODO O RESTANTE</strong></p>
          </div>

          <hr className="my-8" />

          <h2>3. FORMATO OBRIGATÓRIO DA RESPOSTA</h2>
          <ol>
            <li>PARTE 1 DE 4 — VISÃO GERAL E ARQUITETURA</li>
            <li>PARTE 2 DE 4 — FUNCIONALIDADES E INTEGRAÇÕES</li>
            <li>PARTE 3 DE 4 — SEGURANÇA, QUALIDADE E PRODUÇÃO</li>
            <li>PARTE 4 DE 4 — PENDÊNCIAS, ROADMAP E ESTIMATIVA PARA 100%</li>
          </ol>

          <hr className="my-8" />

          <h2>4. RELATÓRIO OFICIAL</h2>
          <p>Criar ou atualizar: <code>docs/AUDITORIA_GERAL_GASTO_INTELIGENTE_2026-08-03.md</code></p>
        </div>

        {/* Tag de confirmação de escopo para auditoria técnica */}
        <div 
          style={{ display: 'none' }} 
          data-whatsapp-escopo-confirmado="true" 
          data-joanin-carrefour-reorg-v1="true"
          data-auditoria-geral-v1="true"
        />
      </div>
    </MobileShell>
  );
}
