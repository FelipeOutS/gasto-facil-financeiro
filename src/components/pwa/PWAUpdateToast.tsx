import { useState, useEffect } from "react";
import { X, RefreshCw, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export function PWAUpdateToast() {
  const [show, setShow] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const reg = (e as CustomEvent).detail;
      setRegistration(reg);
      setShow(true);
    };

    window.addEventListener("pwa-update-available", onUpdate);
    return () => window.removeEventListener("pwa-update-available", onUpdate);
  }, []);

  const handleUpdate = () => {
    if (!registration || !registration.waiting) {
      window.location.reload();
      return;
    }

    // Send the skip waiting message to the waiting worker
    registration.waiting.postMessage("SKIP_WAITING");

    // Listen for the new worker taking control to reload
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-20 left-4 right-4 z-[100] mx-auto max-w-sm sm:bottom-6 sm:right-6 sm:left-auto"
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Nova versão disponível
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Uma nova versão do Gasto Inteligente está pronta. Atualize agora para as melhorias
                  mais recentes.
                </p>
              </div>
              <button
                onClick={() => setShow(false)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleUpdate}
                size="sm"
                className="w-full gap-2 rounded-xl bg-slate-900 font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar agora
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
