/**
 * AdSlot — wrapper público de anúncios para o plano `free_ads`.
 *
 * Fase 1E-B2L. Sem rede externa, sem script, sem iframe, sem pixel,
 * sem cookie, sem tracking. Renderiza apenas um card estático interno.
 *
 * Visibilidade:
 *  - Só aparece para usuário com `plan === "free_ads"` e
 *    `status === "ativo"`.
 *  - Não aparece para Admin Master, planos pagos, `sem_assinatura`,
 *    `expirado`, `cancelado` nem durante carregamento.
 *  - Controlado pela flag `VITE_ENABLE_AD_PLACEHOLDERS` (default: ligada
 *    — o slot já depende do plano para aparecer, então a flag é um
 *    kill-switch global; defina como `"false"` para desligar em todos
 *    os usuários sem precisar fazer deploy de código).
 */
import { usePlan } from "@/lib/use-plan";
import { AdSlotRenderer } from "@/components/AdSlotRenderer";

const FLAG = (import.meta.env.VITE_ENABLE_AD_PLACEHOLDERS ?? "true") !== "false";

export interface AdSlotProps {
  /** Classes extras para alinhar o card ao layout da página. */
  className?: string;
  /** Para testes/analytics interno (não envia para fora). */
  slotId?: string;
}

export function AdSlot({ className, slotId }: AdSlotProps) {
  const { plan, status, isAdminMaster, loading } = usePlan();

  if (!FLAG) return null;
  if (loading) return null;
  if (isAdminMaster) return null;
  if (plan !== "free_ads" || status !== "ativo") return null;

  return <AdSlotRenderer className={className} slotId={slotId ?? "generic"} />;
}

export default AdSlot;
