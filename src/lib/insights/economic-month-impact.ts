/**
 * Tradução prática (leiga) do cenário macroeconômico do mês,
 * cruzando indicadores do BCB (Selic, CDI, IPCA) com dados financeiros
 * já calculados no Dashboard. Função pura — sem fetch, sem storage.
 *
 * Não recomenda produto específico, não promete rendimento e não duplica
 * o Radar BCB, o Diagnóstico Mensal nem a Saúde Financeira.
 */

export type EconomicImpactTone = "success" | "warning" | "destructive" | "info" | "muted";

export interface EconomicMonthImpactInput {
  selic?: number | null;
  cdi?: number | null;
  ipca?: number | null;
  saldo: number;
  receitas: number;
  despesas: number;
  contasVencidas?: number;
  cartaoUsoPercentual?: number;
  recorrenciasTotal?: number;
}

export interface EconomicMonthImpact {
  title: string;
  description: string;
  tone: EconomicImpactTone;
  actionLabel?: string;
  actionHref?: string;
}

const JUROS_ALTOS = 12; // % a.a.
const IPCA_ALTO = 0.6; // % mês

function maiorJuros(selic?: number | null, cdi?: number | null): number | null {
  const vals = [selic, cdi].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

export function buildEconomicMonthImpact(
  input: EconomicMonthImpactInput,
): EconomicMonthImpact | null {
  const juros = maiorJuros(input.selic, input.cdi);
  const ipca = typeof input.ipca === "number" && Number.isFinite(input.ipca) ? input.ipca : null;

  // Precisamos de ao menos um indicador BCB.
  if (juros === null && ipca === null) return null;

  const { saldo, receitas, despesas, contasVencidas } = input;
  const despesasAltas = receitas > 0 && despesas >= receitas * 0.9;
  const jurosAltos = juros !== null && juros >= JUROS_ALTOS;
  const ipcaAlto = ipca !== null && ipca >= IPCA_ALTO;

  // Cenário 2 — contas vencidas + juros altos (prioridade sobre saldo negativo)
  if (jurosAltos && (contasVencidas ?? 0) > 0) {
    return {
      title: "Atenção às contas vencidas",
      description:
        "Com juros altos por aí, atrasos podem pesar mais no próximo mês. Vale priorizar quitar o que está vencido.",
      tone: "destructive",
      actionLabel: "Ver contas",
      actionHref: "/contas-a-pagar",
    };
  }

  // Cenário 1 — saldo negativo + juros altos
  if (jurosAltos && saldo < 0) {
    return {
      title: "Cuidado com juros e dívidas",
      description:
        "O cenário é de juros altos: parcelamentos, atrasos e crédito ficam mais caros. Reveja gastos e evite novas dívidas agora.",
      tone: "destructive",
      actionLabel: "Revisar gastos",
      actionHref: "/gastos",
    };
  }

  // Cenário 3 — IPCA alto + despesas altas
  if (ipcaAlto && despesasAltas) {
    return {
      title: "Inflação pode apertar seu mês",
      description:
        "Com a inflação mais forte, gastos variáveis e recorrentes tendem a subir. Vale dar uma olhada nas categorias que mais consomem o seu mês.",
      tone: "warning",
      actionLabel: "Ver categorias",
      actionHref: "/gastos",
    };
  }

  // Cenário 4 — saldo positivo + juros altos
  if (jurosAltos && saldo > 0) {
    return {
      title: "Bom momento para reforçar sua reserva",
      description:
        "Você terminou o mês no positivo e os juros estão altos. É uma boa hora para manter a disciplina e fortalecer sua reserva pouco a pouco.",
      tone: "success",
      actionLabel: "Guardar dinheiro",
      actionHref: "/guardado",
    };
  }

  // Cenário 5 — cenário estável
  if (!jurosAltos && (ipca === null || ipca < IPCA_ALTO)) {
    return {
      title: "Cenário mais previsível",
      description:
        "Os juros e a inflação não estão pressionando agora. É uma boa hora para manter o orçamento em dia e seguir com suas metas.",
      tone: "info",
      actionLabel: "Ver orçamento",
      actionHref: "/orcamento",
    };
  }

  // Cenário 6 — fallback (há dados BCB mas nenhum cenário forte)
  return {
    title: "Acompanhe o cenário do mês",
    description:
      "Juros e inflação podem influenciar compras, parcelas e planejamento. Vale acompanhar o orçamento de perto neste mês.",
    tone: "muted",
    actionLabel: "Ver orçamento",
    actionHref: "/orcamento",
  };
}
