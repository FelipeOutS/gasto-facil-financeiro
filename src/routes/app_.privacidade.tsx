import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { 
  ShieldCheck, 
  ChevronLeft, 
  Trash2, 
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Lock
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { getDeletionPreview, executeDataDeletion } from "@/lib/privacy.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app_/privacidade")({
  component: PrivacyPage,
});

type Step = "choose" | "review" | "success";

function PrivacyPage() {
  const { t } = useTranslation("privacy");
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choose");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, number>>({});
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const getPreview = useServerFn(getDeletionPreview);
  const deleteFn = useServerFn(executeDataDeletion);

  const categories = [
    { id: "expenses", group: "daily" },
    { id: "income", group: "daily" },
    { id: "payables", group: "daily" },
    { id: "receivables", group: "daily" },
    { id: "subscriptions", group: "daily" },
    { id: "budgets", group: "planning" },
    { id: "goals", group: "planning" },
    { id: "savings", group: "planning" },
    { id: "investments", group: "planning" },
    { id: "cards", group: "others" },
    { id: "market", group: "others" },
    { id: "imports", group: "others" },
  ];

  const handleToggleCategory = (id: string) => {
    setSelectedCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedCategories.length === categories.length) {
      setSelectedCategories([]);
    } else {
      setSelectedCategories(categories.map(c => c.id));
    }
  };

  const handleContinue = async () => {
    if (selectedCategories.length === 0) return;
    
    setIsLoadingPreview(true);
    try {
      const res = await getPreview({ data: { categories: selectedCategories } });
      setPreviewData(res.stats);
      setStep("review");
    } catch (err) {
      toast.error("Erro ao carregar prévia dos dados");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDelete = async () => {
    if (confirmationInput !== "EXCLUIR") return;
    
    setIsDeleting(true);
    try {
      await deleteFn({ data: { categories: selectedCategories, confirmationText: confirmationInput } });
      setStep("success");
      toast.success(t("manageData.success.title"));
    } catch (err) {
      toast.error("Erro ao excluir dados");
    } finally {
      setIsDeleting(false);
    }
  };

  const renderChooseStep = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">{t("manageData.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("manageData.description")}</p>
      </div>

      <div className="flex items-center space-x-2 pb-2">
        <Checkbox 
          id="select-all" 
          checked={selectedCategories.length === categories.length}
          onCheckedChange={handleSelectAll}
        />
        <label htmlFor="select-all" className="text-sm font-medium leading-none cursor-pointer">
          {t("manageData.selection.selectAll")}
        </label>
      </div>

      <div className="space-y-8">
        {["daily", "planning", "others"].map(group => (
          <div key={group} className="space-y-4">
            <h3 className="text-xs font-bold tracking-wider text-muted-foreground uppercase px-1">
              {t(`manageData.categories.${group}`)}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.filter(c => c.group === group).map(cat => (
                <div 
                  key={cat.id}
                  onClick={() => handleToggleCategory(cat.id)}
                  className={cn(
                    "relative flex cursor-pointer items-start space-x-3 rounded-xl border p-4 transition-all hover:bg-accent/50",
                    selectedCategories.includes(cat.id) ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"
                  )}
                >
                  <Checkbox 
                    checked={selectedCategories.includes(cat.id)}
                    className="mt-1"
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{t(`manageData.categories.${cat.id}.title`)}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {t(`manageData.categories.${cat.id}.description`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 bg-background/80 py-4 backdrop-blur-sm">
        <Button 
          className="w-full h-12 text-base font-semibold"
          disabled={selectedCategories.length === 0 || isLoadingPreview}
          onClick={handleContinue}
        >
          {isLoadingPreview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("manageData.selection.continue")}
        </Button>
      </div>
    </div>
  );

  const renderReviewStep = () => {
    const totalRecords = Object.values(previewData).reduce((a, b) => a + b, 0);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon" onClick={() => setStep("choose")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">{t("manageData.review.title")}</h2>
        </div>

        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-4">
          <div className="flex items-center space-x-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-bold uppercase tracking-tight text-sm">Atenção Crítica</span>
          </div>
          
          <div className="space-y-3">
            {selectedCategories.map(cat => (
              <div key={cat} className="flex justify-between items-center text-sm border-b border-destructive/10 pb-2 last:border-0">
                <span className="text-muted-foreground">{t(`manageData.categories.${cat}.title`)}</span>
                <span className="font-mono font-medium text-destructive">
                  {previewData[cat] || 0} {t("manageData.review.willBeRemoved")}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 font-bold text-lg">
              <span>{t("manageData.review.total")}</span>
              <span className="text-destructive">{totalRecords} registros</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border p-4 bg-muted/30">
          <div className="flex items-center space-x-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-semibold text-sm">{t("manageData.review.wontBeDeleted")}</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center"><CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> {t("manageData.review.accountSafe")}</li>
            <li className="flex items-center"><CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> {t("manageData.review.settingsSafe")}</li>
            <li className="flex items-center"><CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> {t("manageData.review.billingSafe")}</li>
          </ul>
        </div>

        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">{t("manageData.review.irreversible")}</p>
            <p className="text-xs text-muted-foreground">{t("manageData.review.confirmLarge")}</p>
            <Input 
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value.toUpperCase())}
              placeholder="EXCLUIR"
              className="h-12 text-center font-mono font-bold tracking-widest uppercase border-destructive/30 focus-visible:ring-destructive"
            />
          </div>
          
          <Button 
            variant="destructive" 
            className="w-full h-12 text-base font-bold shadow-lg shadow-destructive/20"
            disabled={confirmationInput !== "EXCLUIR" || isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {t("manageData.review.confirm")}
          </Button>
        </div>
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
        <Link to="/app/perfil">{t("manageData.success.back")}</Link>
      </Button>
    </div>
  );

  return (
    <div className="container max-w-2xl mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        </div>
        {step === "choose" && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/app/perfil" className="text-muted-foreground">
              {t("back")}
            </Link>
          </Button>
        )}
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
        {step === "choose" && renderChooseStep()}
        {step === "review" && renderReviewStep()}
        {step === "success" && renderSuccessStep()}
      </div>

      <div className="flex items-center justify-center space-x-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        <span>GI Privacy Engine v1.0 • Operação Irreversível</span>
      </div>
    </div>
  );
}
