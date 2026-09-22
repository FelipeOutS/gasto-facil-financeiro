import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/components/ui/button";

/** Falha de consulta não é uma decisão comercial de bloqueio. */
export function SubscriptionPending({
  error,
  retry,
}: {
  error: string | null;
  retry: () => Promise<void>;
}) {
  if (!error) return <BrandLoader message="Verificando assinatura…" />;
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <p>{error}</p>
      <Button onClick={() => void retry()}>Tentar novamente</Button>
    </div>
  );
}
