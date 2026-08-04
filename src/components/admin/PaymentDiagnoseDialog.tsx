import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCcw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { diagnoseMpPayment, reconcileMpPaymentById } from "@/lib/admin.functions";

type Diagnosis = {
  mercado_pago_status: string;
  mp_raw_status: string | null;
  local_payment_status: string | null;
  local_subscription_status: string | null;
  user_id: string | null;
  user_email: string | null;
  plan: string | null;
  amount: number | null;
  external_payment_id: string;
  inconsistencies: string[];
  recommended_action: string;
};

function shortId(s: string | null | undefined) {
  if (!s) return "—";
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function StatusPill({ value, tone }: { value: string | null; tone?: "ok" | "warn" | "error" }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
        : tone === "error"
          ? "bg-red-500/15 text-red-600 border-red-500/30"
          : "bg-muted text-foreground/80 border-border";
  return <Badge className={`border ${cls}`}>{value}</Badge>;
}

function toneFor(status: string | null | undefined): "ok" | "warn" | "error" | undefined {
  const s = (status ?? "").toLowerCase();
  if (["approved", "paid", "authorized", "ativo", "active"].includes(s)) return "ok";
  if (["pending", "in_process", "in_mediation"].includes(s)) return "warn";
  if (
    ["rejected", "cancelled", "canceled", "refunded", "charged_back", "expired", "failed"].includes(
      s,
    )
  )
    return "error";
  return undefined;
}

export function PaymentDiagnoseDialog({
  paymentId,
  open,
  onOpenChange,
  currentPeriodEnd,
  onReconciled,
}: {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentPeriodEnd?: string | null;
  onReconciled?: () => void;
}) {
  const diagnoseFn = useServerFn(diagnoseMpPayment);
  const reconcileFn = useServerFn(reconcileMpPaymentById);

  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [confirmReconcile, setConfirmReconcile] = useState(false);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!paymentId) return;
    setLoading(true);
    setError(null);
    setDiag(null);
    setConfirmReconcile(false);
    try {
      const res = (await diagnoseFn({ data: { paymentId } })) as {
        ok: boolean;
        diagnosis: Diagnosis;
      };
      setDiag(res.diagnosis);
      if (res.diagnosis.recommended_action === "payment_not_found") {
        setError("O Mercado Pago não encontrou esse pagamento. Verifique o ID.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      setError(`Falha ao diagnosticar: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [paymentId, diagnoseFn]);

  useEffect(() => {
    if (open && paymentId) void load();
    if (!open) {
      setDiag(null);
      setError(null);
      setConfirmReconcile(false);
    }
  }, [open, paymentId, load]);

  const canReconcile =
    diag && diag.mercado_pago_status === "approved" && diag.local_subscription_status !== "ativo";

  const handleReconcile = async () => {
    if (!paymentId) return;
    setReconciling(true);
    try {
      const res = (await reconcileFn({ data: { paymentId } })) as {
        ok: boolean;
        applied: boolean;
        message: string;
        diagnosis?: Diagnosis;
      };
      if (res.ok) {
        toast.success(res.applied ? "Pagamento reconciliado" : "Sem alterações", {
          description: res.message,
        });
        if (res.diagnosis) setDiag(res.diagnosis);
        setConfirmReconcile(false);
        onReconciled?.();
      } else {
        toast.error("Reconciliação não aplicada", { description: res.message });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error("Falha ao reconciliar", { description: msg });
    } finally {
      setReconciling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Diagnóstico de pagamento
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            MP ID: {paymentId ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : error && !diag ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : diag ? (
          <div className="space-y-3 text-sm">
            {error ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Status MP (canônico)">
                <StatusPill
                  value={diag.mercado_pago_status}
                  tone={toneFor(diag.mercado_pago_status)}
                />
              </Field>
              <Field label="Status MP (raw)">
                <span className="text-xs">{diag.mp_raw_status ?? "—"}</span>
              </Field>
              <Field label="Pagamento local">
                <StatusPill
                  value={diag.local_payment_status}
                  tone={toneFor(diag.local_payment_status)}
                />
              </Field>
              <Field label="Plano local">
                <StatusPill
                  value={diag.local_subscription_status}
                  tone={toneFor(diag.local_subscription_status)}
                />
              </Field>
              <Field label="Plano">
                <span className="text-xs">{diag.plan ?? "—"}</span>
              </Field>
              <Field label="Valor">
                <span className="text-xs">
                  {diag.amount != null
                    ? diag.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    : "—"}
                </span>
              </Field>
              <Field label="Usuário">
                <span className="font-mono text-xs">{shortId(diag.user_id)}</span>
              </Field>
              <Field label="E-mail">
                <span className="text-xs break-all">{diag.user_email ?? "—"}</span>
              </Field>
              {currentPeriodEnd ? (
                <Field label="Fim do ciclo">
                  <span className="text-xs">
                    {new Date(currentPeriodEnd).toLocaleString("pt-BR")}
                  </span>
                </Field>
              ) : null}
              <Field label="Ação recomendada">
                <Badge variant="outline" className="text-xs">
                  {diag.recommended_action}
                </Badge>
              </Field>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                Inconsistências
              </div>
              {diag.inconsistencies.length === 0 ? (
                <div className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Nenhuma detectada
                </div>
              ) : (
                <ul className="list-disc pl-5 text-xs text-red-700">
                  {diag.inconsistencies.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </div>

            {diag.mercado_pago_status === "approved" &&
            diag.local_subscription_status === "ativo" ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700">
                Pagamento aprovado e plano já está ativo. Nada a reconciliar.
              </div>
            ) : null}

            {diag.mercado_pago_status !== "approved" &&
            diag.recommended_action !== "payment_not_found" ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                Este pagamento não está aprovado no Mercado Pago. A reconciliação automática não
                será aplicada.
              </div>
            ) : null}

            {canReconcile && confirmReconcile ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <div className="mb-2 font-medium">
                  Confirmar reconciliação manual deste pagamento?
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleReconcile()} disabled={reconciling}>
                    {reconciling ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmReconcile(false)}
                    disabled={reconciling}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading || !paymentId}
          >
            <RefreshCcw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Rediagnosticar
          </Button>
          <div className="flex gap-2">
            {canReconcile && !confirmReconcile ? (
              <Button size="sm" onClick={() => setConfirmReconcile(true)} disabled={reconciling}>
                Reconciliar pagamento
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
