import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { useState, useMemo } from "react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import {
  getDeletionPreview,
  executeDataDeletion,
  type DeletionSelection,
} from "@/lib/privacy.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

export const Route = createFileRoute("/app_/privacidade")({
  head: () => ({ meta: [{ title: "Privacidade e Dados — Gasto Inteligente" }] }),
  component: PrivacyPage,
});

type Step = "choose" | "review" | "success";

interface SelectionState {
  category: string;
  scope: string;
}

function PrivacyPage() {
  const { t } = useTranslation("privacy");
  const [step, setStep] = useState<Step>("choose");
  const [selections, setSelections] = useState<SelectionState[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, number>>({});
  const [dependencies, setDependencies] = useState<
    { type: string; count: number; action: string }[]
  >([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [isConfirmChecked, setIsConfirmChecked] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const getPreview = useServerFn(getDeletionPreview);
  const deleteFn = useServerFn(executeDataDeletion);

  const categories = useMemo(
    () => [
      { id: "expenses", group: "daily" },
      { id: "income", group: "daily" },
      { id: "payables", group: "daily", scopes: ["all", "paid", "pending", "overdue"] },
      { id: "receivables", group: "daily", scopes: ["all", "received", "pending", "overdue"] },
      { id: "subscriptions", group: "daily" },
      { id: "budgets", group: "planning" },
      { id: "goals", group: "planning" },
      { id: "savings", group: "planning" },
      { id: "investments", group: "planning" },
      { id: "cards", group: "others" },
      { id: "market", group: "others" },
      { id: "imports", group: "others" },
    ],
    [],
  );

  const handleToggleCategory = (id: string) => {
    setSelections((prev) => {
      const exists = prev.find((s) => s.category === id);
      if (exists) {
        return prev.filter((s) => s.category !== id);
      } else {
        return [...prev, { category: id, scope: "all" }];
      }
    });
  };

  const handleScopeChange = (id: string, scope: string) => {
    setSelections((prev) => prev.map((s) => (s.category === id ? { ...s, scope } : s)));
  };

  const handleSelectAll = () => {
    if (selections.length === categories.length) {
      setSelections([]);
    } else {
      setSelections(categories.map((c) => ({ category: c.id, scope: "all" })));
    }
  };

  const handleContinue = async () => {
    if (selections.length === 0) return;

    setIsLoadingPreview(true);
    try {
      const res = await getPreview({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tipagem do input do server fn não é inferida no cliente
        data: { selections: selections as DeletionSelection[] } as any,
      });
      setPreviewData(res.stats);
      setDependencies(res.dependencies || []);
      setStep("review");
    } catch (err) {
      toast.error("Erro ao carregar prévia dos dados");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // For legacy reasons we send "EXCLUIR" to the server but we don't ask the user to type it
      await deleteFn({
        data: {
          selections: selections as DeletionSelection[],
          confirmationText: "EXCLUIR",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tipagem do input do server fn não é inferida no cliente
        } as any,
      });
      setStep("success");
      setIsModalOpen(false);
      toast.success(t("manageData.success.title"));
    } catch (err) {
      toast.error("Erro ao excluir dados");
    } finally {
      setIsDeleting(false);
    }
  };

  const renderChooseStep = () => (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 pb-2">
        <Checkbox
          id="select-all"
          checked={selections.length === categories.length}
          onCheckedChange={handleSelectAll}
        />
        <label htmlFor="select-all" className="text-sm font-medium leading-none cursor-pointer">
          {t("manageData.selection.selectAll")}
        </label>
      </div>

      <div className="space-y-8">
        {["daily", "planning", "others"].map((group) => (
          <div key={group} className="space-y-4">
            <h3 className="text-xs font-bold tracking-wider text-muted-foreground uppercase px-1">
              {t(`manageData.categories.${group}`)}
            </h3>
            <div className="grid gap-3 sm:grid-cols-1">
              {categories
                .filter((c) => c.group === group)
                .map((cat) => {
                  const isSelected = selections.some((s) => s.category === cat.id);

                  return (
                    <div key={cat.id} className="space-y-2">
                      <div
                        onClick={() => handleToggleCategory(cat.id)}
                        className={cn(
                          "relative flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all hover:bg-accent/50",
                          isSelected
                            ? "border-brand bg-brand/5 ring-1 ring-brand"
                            : "border-border bg-card",
                        )}
                      >
                        <div className="flex items-start space-x-3">
                          <Checkbox checked={isSelected} className="mt-1" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium leading-none">
                              {t(`manageData.categories.${cat.id}.title`)}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {t(`manageData.categories.${cat.id}.description`)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 bg-background/80 py-4 backdrop-blur-sm border-t mt-8">
        <Button
          className="w-full h-12 text-base font-semibold"
          disabled={selections.length === 0 || isLoadingPreview}
          onClick={handleContinue}
        >
          {isLoadingPreview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {String(t("manageData.selection.continue", { count: selections.length }))}
        </Button>
      </div>
    </div>
  );

  const renderReviewStep = () => {
    const totalRecords = Object.values(previewData).reduce((a, b) => a + b, 0);

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-4">
          <div className="flex items-center space-x-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-bold uppercase tracking-tight text-sm">ATENÇÃO</span>
          </div>

          <p className="text-sm font-medium text-destructive">
            Esta ação remove permanentemente os dados selecionados.
          </p>

          <div className="space-y-3 pt-2">
            {selections.map((sel) => (
              <div
                key={sel.category}
                className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0"
              >
                <span className="text-muted-foreground">
                  {t(`manageData.categories.${sel.category}.title`)}
                </span>
                <span className="font-mono font-medium text-destructive">
                  {previewData[sel.category] || 0}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 font-bold text-lg border-t border-destructive/20">
              <span>Total</span>
              <span className="text-destructive">{totalRecords}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border p-4 bg-muted/30">
          <div className="flex items-center space-x-2 text-brand">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-semibold text-sm text-foreground">Isso será preservado</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center">
              <CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> Sua conta e login
            </li>
            <li className="flex items-center">
              <CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> Seu plano
            </li>
            <li className="flex items-center">
              <CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> Suas configurações básicas
            </li>
            <li className="flex items-center">
              <CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> Dados necessários para a
              manutenção da sua conta e cobrança não fazem parte desta exclusão
            </li>
          </ul>
        </div>

        <div className="space-y-4 pt-4">
          <div className="flex items-center space-x-2 bg-muted/20 p-4 rounded-xl border border-border/50">
            <Checkbox
              id="confirm-deletion"
              checked={isConfirmChecked}
              onCheckedChange={(checked) => setIsConfirmChecked(!!checked)}
            />
            <label
              htmlFor="confirm-deletion"
              className="text-sm font-medium leading-tight cursor-pointer"
            >
              Entendo que os dados selecionados serão excluídos permanentemente.
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setStep("choose")} disabled={isDeleting}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              className="font-bold"
              disabled={!isConfirmChecked || isDeleting}
              onClick={() => setIsModalOpen(true)}
            >
              Excluir {totalRecords} registros
            </Button>
          </div>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="rounded-3xl">
            <DialogHeader>
              <DialogTitle>Excluir dados selecionados?</DialogTitle>
              <DialogDescription>
                {totalRecords} registros serão removidos permanentemente da sua conta. Esta ação não
                pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="grid grid-cols-2 gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isDeleting}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Excluir dados
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderSuccessStep = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
      <div className="rounded-full bg-green-500/10 p-6">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">{t("manageData.success.title")}</h2>
        <p className="text-muted-foreground">{t("manageData.success.description")}</p>
      </div>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/app/ajustes">{t("manageData.success.back")}</Link>
      </Button>
    </div>
  );

  const headerTitle = step === "review" ? "Revise o que será excluído" : t("title");
  const headerDesc = step === "review" ? undefined : t("manageData.description");
  const backTo = step === "review" ? undefined : "/app/ajustes";

  return (
    <MobileShell data-testid="privacy-page">
      <div className="container max-w-2xl mx-auto px-0 py-2">
        <SettingsPageHeader
          title={headerTitle}
          description={headerDesc}
          backTo={backTo}
          className="px-4"
        />

        <div className="mt-4 px-4">
          <div className="bg-card rounded-3xl border border-border/50 p-6 shadow-sm">
            {step === "choose" && renderChooseStep()}
            {step === "review" && renderReviewStep()}
            {step === "success" && renderSuccessStep()}
          </div>
        </div>
      </div>
    </MobileShell>
  );
}
