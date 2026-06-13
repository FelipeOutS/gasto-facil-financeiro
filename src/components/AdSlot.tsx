/**
 * AdSlot — wrapper público de anúncios para o plano `free_ads`.
 *
 * Fase 1E-B2Q. Seleciona placeholder, anúncio direto ou AdSense por flags,
 * sempre com fallback seguro.
 *
 * Visibilidade:
 *  - Só aparece para usuário com `plan === "free_ads"` e
 *    `status === "ativo"`.
 *  - Não aparece para Admin Master, planos pagos, `sem_assinatura`,
 *    `expirado`, `cancelado` nem durante carregamento.
 */
import { usePlan } from "@/lib/use-plan";
import { AdSlotRenderer } from "@/components/AdSlotRenderer";

export interface AdSlotProps {
  /** Classes extras para alinhar o card ao layout da página. */
  className?: string;
  /** Para testes/analytics interno (não envia para fora). */
  slotId?: string;
}

export function AdSlot({ className, slotId }: AdSlotProps) {
  const { plan, status, isAdminMaster, loading } = usePlan();

  if (loading) return null;
  if (isAdminMaster) return null;
  if (plan !== "free_ads" || status !== "ativo") return null;

  return <AdSlotRenderer className={className} slotId={slotId ?? "generic"} />;
}

export default AdSlot;
