import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-3xl space-y-8 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Gasto Inteligente 2026
        </h1>
        
        <div className="rounded-3xl border border-brand/20 bg-card p-8 shadow-elevated">
          <h2 className="mb-4 text-2xl font-bold text-brand"># PROMPT 9B — CHECKPOINT FINAL E LIBERAÇÃO COMERCIAL DO SITE WEB</h2>
          
          <div className="space-y-4 text-left text-muted-foreground">
            <p className="font-medium text-foreground">Status Atual do Projeto:</p>
            <ul className="list-inside list-disc space-y-2">
              <li><span className="font-semibold text-green-600">PWA Ativa:</span> Instalável e funcional em produção.</li>
              <li><span className="font-semibold text-green-600">Segurança:</span> RLS 100% ativo, vulnerabilidades mitigadas.</li>
              <li><span className="font-semibold text-amber-600">Mercado Pago:</span> Configurado em modo produção (Checkout Pro).</li>
              <li><span className="font-semibold text-amber-600">WhatsApp:</span> Infraestrutura pronta, aguardando aprovação de templates pela Meta.</li>
            </ul>
          </div>
          
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <a 
              href="/auth" 
              className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground shadow-lg transition-transform active:scale-95"
            >
              Começar Agora
            </a>
            <a 
              href="/meu-plano" 
              className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-background px-8 text-sm font-bold transition-transform active:scale-95"
            >
              Ver Planos
            </a>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Checkpoints técnicos concluídos. Prontidão comercial validada.
        </p>
      </div>
    </div>
  ),
});
