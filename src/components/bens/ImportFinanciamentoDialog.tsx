import { useState, useCallback } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Upload, 
  FileText, 
  ImageIcon, 
  Loader2, 
  AlertTriangle,
  CheckCircle2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { processarDocumentoFinanciamento } from "@/lib/bens.functions";
import { ImportFinanciamentoReview } from "./ImportFinanciamentoReview";

interface ImportFinanciamentoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bemId: string;
  financiamentoId?: string;
  onSuccess: () => void;
}

export function ImportFinanciamentoDialog({
  open,
  onOpenChange,
  bemId,
  financiamentoId,
  onSuccess
}: ImportFinanciamentoDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"upload" | "analyzing" | "review">("upload");
  const [result, setResult] = useState<any>(null);
  
  const processarDoc = useServerFn(processarDocumentoFinanciamento);

  const reset = useCallback(() => {
    setFile(null);
    setLoading(false);
    setStep("upload");
    setResult(null);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > 15 * 1024 * 1024) {
        toast.error("O arquivo deve ter no máximo 15MB.");
        return;
      }
      setFile(selected);
    }
  };

  const startAnalysis = async () => {
    if (!file) return;
    setLoading(true);
    setStep("analyzing");
    
    try {
      const reader = new FileReader();
      const fileData = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const res = await processarDoc({
        bemId,
        financiamentoId,
        fileData,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type.includes("pdf") ? "pdf" : "imagem"
      });

      setResult(res);
      setStep("review");
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar documento.");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className={cn("sm:max-w-[600px]", step === "review" && "sm:max-w-[900px]")}>
        <DialogHeader>
          <DialogTitle>Importar Financiamento</DialogTitle>
          <DialogDescription>
            Envie um documento para identificarmos informações que podem ser utilizadas na atualização.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 py-4">
            <div 
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors",
                file ? "border-primary/50 bg-primary/5" : "border-muted-foreground/20 hover:border-primary/30"
              )}
            >
              <input
                type="file"
                id="fin-upload"
                className="hidden"
                accept=".pdf,image/png,image/jpeg,image/jpg"
                onChange={handleFileChange}
              />
              <Label 
                htmlFor="fin-upload" 
                className="flex cursor-pointer flex-col items-center gap-2"
              >
                <div className="rounded-full bg-primary/10 p-3 text-primary">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Clique para enviar ou arraste o arquivo</p>
                  <p className="text-xs text-muted-foreground">PDF, JPG ou PNG (Máx 15MB)</p>
                </div>
              </Label>
            </div>

            {file && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-3">
                  {file.type.includes("pdf") ? (
                    <FileText className="h-5 w-5 text-rose-500" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-blue-500" />
                  )}
                  <div className="overflow-hidden">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setFile(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            
            <DialogFooter>
              <Button 
                className="w-full gap-2" 
                disabled={!file || loading}
                onClick={startAnalysis}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Analisar Documento
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <h3 className="mt-4 text-lg font-medium">Analisando documento...</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              A Lovable AI está identificando saldos, taxas e parcelas.
            </p>
          </div>
        )}

        {step === "review" && result && (
          <ImportFinanciamentoReview 
            bemId={bemId}
            financiamentoId={financiamentoId}
            data={result}
            onClose={() => handleClose(false)}
            onConfirm={() => {
              onSuccess();
              handleClose(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
