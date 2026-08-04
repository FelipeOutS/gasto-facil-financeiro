// Gera "drafts" de alertas a partir dos dados do usuário.
// Não escreve no banco — apenas calcula. O sync com a tabela é feito em service.ts.

import type { Cartao, ContaAPagar, Gasto, Categoria, Limite } from "@/lib/types";
import type { Recorrencia } from "@/lib/recorrencias";
import type { ContaReceber } from "@/lib/contas-receber";
import type { Ativo } from "@/lib/investimentos";
import {
  mesEfetivoGasto,
  resumoFaturaCartao,
  statusContaEfetivo,
  statusEfetivoFatura,
  faturaCorrente,
  mesReferenciaFaturaLabel,
} from "@/lib/store";
import { buildLinhasOrcamento, buildAlertasOrcamento } from "@/lib/orcamento";
import { todayLocalISO } from "@/lib/alertas-contas";
import { statusEfetivo as statusContaReceber } from "@/lib/contas-receber";
import type { DraftAlert } from "./types";

function todayLocal(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function diffDaysLocal(iso: string): number {
  const today = todayLocal();
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const ms = target.getTime() - today.getTime();
  return Math.floor(ms / 86_400_000);
}

function ymKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type GeneratorSources = {
  gastos: Gasto[];
  categorias: Categoria[];
  limites: Limite[];
  contas: ContaAPagar[];
  cartoes: Cartao[];
  recorrencias: Recorrencia[];
  contasReceber?: ContaReceber[];
  investimentos?: Ativo[];
  /** Plano efetivo do usuário (status agregado vindo de usePlan). */
  planoStatus?: "ativo" | "teste" | "expirado" | "cancelado" | "pendente" | "free" | string;
  trialDaysLeft?: number;
};

export function generateAlertDrafts(src: GeneratorSources): DraftAlert[] {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const period = ymKey(now);
  const drafts: DraftAlert[] = [];

  // ============= Cartões / faturas =============
  for (const cartao of src.cartoes) {
    // Resumo de fatura corrente
    try {
      const resumo = resumoFaturaCartao(cartao.id);
      const totalFatura = resumo.usadoMes ?? 0;
      const limite = cartao.limiteTotal ?? 0;
      const usoPct = limite > 0 ? (totalFatura / limite) * 100 : 0;

      if (limite > 0 && usoPct >= 90) {
        drafts.push({
          type: "cartao_limite_critico",
          title: `Cartão ${cartao.nome} quase no limite`,
          description: `Você já usou ${usoPct.toFixed(0)}% do limite disponível.`,
          priority: "critica",
          related_entity_type: "cartao",
          related_entity_id: cartao.id,
          action_label: "Ver cartão",
          action_url: "/cartoes",
          dedupe_key: `cartao_limite_critico:${cartao.id}`,
          period_key: period,
          metadata: { usoPct, totalFatura, limite },
        });
      } else if (limite > 0 && usoPct >= 70) {
        drafts.push({
          type: "cartao_limite_alto",
          title: `Cartão ${cartao.nome} acima de 70% do limite`,
          description: `Uso atual em ${usoPct.toFixed(0)}% do limite.`,
          priority: "media",
          related_entity_type: "cartao",
          related_entity_id: cartao.id,
          action_label: "Ver cartão",
          action_url: "/cartoes",
          dedupe_key: `cartao_limite_alto:${cartao.id}`,
          period_key: period,
          metadata: { usoPct, totalFatura, limite },
        });
      }

      // Vencimento de fatura (dia do mês) — usa fatura corrente e checa se já foi paga
      if (cartao.diaVencimento && totalFatura > 0) {
        const ref = faturaCorrente(cartao);
        const statusFat = statusEfetivoFatura(cartao, ref.mes, ref.ano);
        // Fatura aberta nunca gera alerta de vencimento — só após fechar.
        if (statusFat !== "paga" && statusFat !== "aberta") {
          // Vencimento da fatura "ref" (mês de referência). Vencimento real
          // ocorre no mês seguinte (ou no mês de fechamento se diaVenc>=diaFech).
          const diaFechRef = cartao.diaFechamento ?? 1;
          let venc = new Date(ref.ano, ref.mes, cartao.diaVencimento);
          const fech = new Date(ref.ano, ref.mes, diaFechRef);
          if (venc.getTime() < fech.getTime()) {
            venc = new Date(ref.ano, ref.mes + 1, cartao.diaVencimento);
          }
          const isoVenc = `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, "0")}-${String(venc.getDate()).padStart(2, "0")}`;
          const dias = diffDaysLocal(isoVenc);
          const refLabel = mesReferenciaFaturaLabel(cartao, ref.mes, ref.ano);
          if (dias < 0 && dias >= -10) {
            drafts.push({
              type: "fatura_vencida",
              title: `Fatura de ${refLabel} (${cartao.nome}) vencida`,
              description: `A fatura de ${refLabel} venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}.`,
              priority: "critica",
              related_entity_type: "cartao",
              related_entity_id: cartao.id,
              action_label: "Ver cartão",
              action_url: "/cartoes",
              dedupe_key: `fatura_vencida:${cartao.id}:${ref.ano}-${String(ref.mes).padStart(2, "0")}`,
              period_key: period,
              metadata: { dias, totalFatura, mes: ref.mes, ano: ref.ano, refLabel },
            });
          } else if (dias >= 0 && dias <= 5) {
            drafts.push({
              type: "fatura_vencendo",
              title: `Fatura de ${refLabel} (${cartao.nome}) vence em breve`,
              description:
                dias === 0
                  ? `A fatura de ${refLabel} vence hoje.`
                  : dias === 1
                    ? `A fatura de ${refLabel} vence amanhã.`
                    : `A fatura de ${refLabel} vence em ${dias} dias.`,
              priority: dias <= 1 ? "alta" : "media",
              related_entity_type: "cartao",
              related_entity_id: cartao.id,
              action_label: "Ver cartão",
              action_url: "/cartoes",
              dedupe_key: `fatura_vencendo:${cartao.id}:${ref.ano}-${String(ref.mes).padStart(2, "0")}`,
              period_key: period,
              metadata: { dias, totalFatura, mes: ref.mes, ano: ref.ano, refLabel },
            });
          }
        }
      }
    } catch {
      /* ignora cartão problemático */
    }
  }

  // ============= Contas a pagar =============
  const hojeISO = todayLocalISO();
  for (const c of src.contas) {
    const status = statusContaEfetivo(c, hojeISO);
    if (status === "pago") continue;
    const dias = diffDaysLocal(c.dataVencimento);
    if (dias < 0 && dias >= -30) {
      drafts.push({
        type: "conta_pagar_vencida",
        title: `Conta vencida: ${c.nome}`,
        description: `Venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}.`,
        priority: "critica",
        related_entity_type: "conta_a_pagar",
        related_entity_id: c.id,
        action_label: "Ver conta",
        action_url: "/contas-a-pagar",
        dedupe_key: `conta_pagar_vencida:${c.id}`,
        period_key: c.dataVencimento,
        metadata: { valor: c.valor, dias },
      });
    } else if (dias === 0) {
      drafts.push({
        type: "conta_pagar_hoje",
        title: `${c.nome} vence hoje`,
        description: "Vale conferir antes do fim do dia.",
        priority: "alta",
        related_entity_type: "conta_a_pagar",
        related_entity_id: c.id,
        action_label: "Ver conta",
        action_url: "/contas-a-pagar",
        dedupe_key: `conta_pagar_hoje:${c.id}`,
        period_key: c.dataVencimento,
        metadata: { valor: c.valor },
      });
    } else if (dias === 1) {
      drafts.push({
        type: "conta_pagar_amanha",
        title: `${c.nome} vence amanhã`,
        description: "Boa hora de programar o pagamento.",
        priority: "alta",
        related_entity_type: "conta_a_pagar",
        related_entity_id: c.id,
        action_label: "Ver conta",
        action_url: "/contas-a-pagar",
        dedupe_key: `conta_pagar_amanha:${c.id}`,
        period_key: c.dataVencimento,
        metadata: { valor: c.valor },
      });
    } else if (dias > 1 && dias <= 5) {
      drafts.push({
        type: "conta_pagar_em5",
        title: `${c.nome} vence em ${dias} dias`,
        description: "Anote no radar para não esquecer.",
        priority: "media",
        related_entity_type: "conta_a_pagar",
        related_entity_id: c.id,
        action_label: "Ver conta",
        action_url: "/contas-a-pagar",
        dedupe_key: `conta_pagar_em5:${c.id}`,
        period_key: c.dataVencimento,
        metadata: { valor: c.valor, dias },
      });
    }
  }

  // Valor alto a pagar no mês — prioriza mês de referência (competência)
  // quando disponível. Fallback: mês do vencimento (campo `mes`/`ano` legado).
  const totalAPagarMes = src.contas
    .filter((c) => {
      if (c.status === "pago") return false;
      const mref = (c as ContaAPagar & { mesReferencia?: string }).mesReferencia;
      if (mref && /^\d{4}-\d{2}$/.test(mref)) {
        const [y, m] = mref.split("-").map(Number);
        return m === month && y === year;
      }
      return c.mes === month && c.ano === year;
    })
    .reduce((s, c) => s + (c.valor ?? 0), 0);
  if (totalAPagarMes >= 5000) {
    drafts.push({
      type: "contas_pagar_valor_alto",
      title: "Valor alto a pagar este mês",
      description: `Você tem cerca de R$ ${totalAPagarMes.toFixed(2).replace(".", ",")} em contas no mês.`,
      priority: "media",
      action_label: "Ver contas",
      action_url: "/contas-a-pagar",
      dedupe_key: "contas_pagar_valor_alto",
      period_key: period,
      metadata: { total: totalAPagarMes },
    });
  }

  // ============= Contas a receber =============
  if (src.contasReceber) {
    let totalReceberMes = 0;
    for (const r of src.contasReceber) {
      const st = statusContaReceber(r);
      if (st === "recebido" || st === "cancelado") continue;
      const dias = diffDaysLocal(r.data_prevista);
      const dPrev = new Date(r.data_prevista + "T00:00:00");
      if (dPrev.getMonth() + 1 === month && dPrev.getFullYear() === year) {
        totalReceberMes += r.valor_restante ?? 0;
      }
      if (dias < 0 && dias >= -60) {
        drafts.push({
          type: "conta_receber_atrasado",
          title: `Recebimento atrasado: ${r.titulo}`,
          description: `Estava previsto há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}.`,
          priority: "alta",
          related_entity_type: "conta_a_receber",
          related_entity_id: r.id,
          action_label: "Ver recebimento",
          action_url: "/contas-a-receber",
          dedupe_key: `conta_receber_atrasado:${r.id}`,
          period_key: r.data_prevista,
          metadata: { valor: r.valor_restante, pagador: r.pagador_nome },
        });
      } else if (dias === 0) {
        drafts.push({
          type: "conta_receber_hoje",
          title: `${r.titulo} previsto para hoje`,
          description: r.pagador_nome ? `De ${r.pagador_nome}.` : "Confirme o recebimento.",
          priority: "alta",
          related_entity_type: "conta_a_receber",
          related_entity_id: r.id,
          action_label: "Ver recebimento",
          action_url: "/contas-a-receber",
          dedupe_key: `conta_receber_hoje:${r.id}`,
          period_key: r.data_prevista,
          metadata: { valor: r.valor_restante },
        });
      }
    }
    if (totalReceberMes >= 5000) {
      drafts.push({
        type: "contas_receber_valor_alto",
        title: "Valor alto a receber este mês",
        description: `Cerca de R$ ${totalReceberMes.toFixed(2).replace(".", ",")} previstos.`,
        priority: "baixa",
        action_label: "Ver recebimentos",
        action_url: "/contas-a-receber",
        dedupe_key: "contas_receber_valor_alto",
        period_key: period,
        metadata: { total: totalReceberMes },
      });
    }
  }

  // ============= Recorrências / assinaturas =============
  for (const r of src.recorrencias) {
    if (r.status !== "ativa") continue;
    if (r.proximaCobranca) {
      const dias = diffDaysLocal(r.proximaCobranca);
      if (dias >= 0 && dias <= 3) {
        drafts.push({
          type: "assinatura_vencendo",
          title: `Assinatura ${r.nome}`,
          description:
            dias === 0
              ? "Cobrança prevista para hoje."
              : `Cobrança prevista em ${dias} ${dias === 1 ? "dia" : "dias"}.`,
          priority: "media",
          related_entity_type: "recorrencia",
          related_entity_id: r.id,
          action_label: "Ver assinaturas",
          action_url: "/assinaturas",
          dedupe_key: `assinatura_vencendo:${r.id}`,
          period_key: r.proximaCobranca,
          metadata: { valor: r.valor },
        });
      }
    }
    // Aumento de valor
    if (r.ultimoValor && r.valor && r.ultimoValor > 0) {
      const delta = (r.valor - r.ultimoValor) / r.ultimoValor;
      if (delta >= 0.15) {
        drafts.push({
          type: "assinatura_aumento",
          title: `Aumento em ${r.nome}`,
          description: `Subiu ${(delta * 100).toFixed(0)}% em relação à cobrança anterior.`,
          priority: "media",
          related_entity_type: "recorrencia",
          related_entity_id: r.id,
          action_label: "Ver assinaturas",
          action_url: "/assinaturas",
          dedupe_key: `assinatura_aumento:${r.id}:${r.valor}`,
          period_key: period,
          metadata: { valorAtual: r.valor, valorAnterior: r.ultimoValor },
        });
      }
    }
  }

  // ============= Orçamento =============
  const linhasOrc = buildLinhasOrcamento(
    src.categorias,
    src.gastos.filter((g) => g.confirmado !== false),
    month,
    year,
    (catId) =>
      src.limites.find((l) => l.tipo === catId && l.mes === month && l.ano === year)?.valor,
    mesEfetivoGasto,
  );
  const alertasOrc = buildAlertasOrcamento(linhasOrc);
  for (const a of alertasOrc) {
    if (a.status === "estouro") {
      drafts.push({
        type: "orcamento_estouro",
        title: `Orçamento de ${a.nome} estourou`,
        description: `Você passou em R$ ${(a.realizado - a.planejado).toFixed(2).replace(".", ",")}.`,
        priority: "alta",
        related_entity_type: "categoria",
        related_entity_id: a.catId,
        action_label: "Ver orçamento",
        action_url: "/orcamento",
        dedupe_key: `orcamento_estouro:${a.catId}`,
        period_key: period,
        metadata: { realizado: a.realizado, planejado: a.planejado },
      });
    } else if (a.status === "atencao") {
      const pct = a.planejado > 0 ? (a.realizado / a.planejado) * 100 : 0;
      drafts.push({
        type: "orcamento_atencao",
        title: `Atenção no orçamento de ${a.nome}`,
        description: `Você já usou ${pct.toFixed(0)}% do limite.`,
        priority: "media",
        related_entity_type: "categoria",
        related_entity_id: a.catId,
        action_label: "Ver orçamento",
        action_url: "/orcamento",
        dedupe_key: `orcamento_atencao:${a.catId}`,
        period_key: period,
        metadata: { realizado: a.realizado, planejado: a.planejado, pct },
      });
    }
  }

  // ============= Gastos — média e duplicados =============
  // Aumento de gastos vs mês anterior — usa MÊS DE REFERÊNCIA (competência),
  // não a data civil do lançamento. Sem isso, uma compra de Abril paga em
  // Maio aparece como "subiu em Maio".
  const gastosConfirmados = src.gastos.filter((g) => g.confirmado !== false);
  const ref = new Date(year, month - 2, 1);
  const mAnt = ref.getMonth() + 1;
  const aAnt = ref.getFullYear();
  let totalMes = 0;
  let totalAnt = 0;
  for (const g of gastosConfirmados) {
    const ef = mesEfetivoGasto(g);
    if (ef.mes === month && ef.ano === year) totalMes += g.valor;
    else if (ef.mes === mAnt && ef.ano === aAnt) totalAnt += g.valor;
  }
  if (totalAnt > 0 && totalMes > totalAnt * 1.3) {
    drafts.push({
      type: "gastos_aumento",
      title: "Seus gastos subiram este mês",
      description: `Estão ${(((totalMes - totalAnt) / totalAnt) * 100).toFixed(0)}% acima do mês anterior.`,
      priority: "media",
      action_label: "Ver gastos",
      action_url: "/gastos",
      dedupe_key: "gastos_aumento",
      period_key: period,
      metadata: { totalMes, totalAnt },
    });
  }

  // ---- Gasto fora do padrão POR CATEGORIA ----
  // Compara o total do mês atual de cada categoria com a média dos 3 meses
  // anteriores (usando o mesmo mês de competência via mesEfetivoGasto).
  // Dispara alerta quando a categoria gastou pelo menos 2x a média e tem
  // pelo menos R$ 50 de excesso — evita falso positivo em categorias minúsculas.
  {
    const totaisPorMes = new Map<string, Map<string, number>>(); // ym -> catId -> valor
    function bump(ym: string, catId: string, v: number) {
      let m = totaisPorMes.get(ym);
      if (!m) {
        m = new Map();
        totaisPorMes.set(ym, m);
      }
      m.set(catId, (m.get(catId) ?? 0) + v);
    }
    for (const g of gastosConfirmados) {
      const ef = mesEfetivoGasto(g);
      const ym = `${ef.ano}-${String(ef.mes).padStart(2, "0")}`;
      const cat = g.categoriaId ?? "_sem";
      bump(ym, cat, Number(g.valor || 0));
    }
    const ymAtual = `${year}-${String(month).padStart(2, "0")}`;
    const mapAtual = totaisPorMes.get(ymAtual);
    if (mapAtual) {
      const meses3: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const r = new Date(year, month - 1 - i, 1);
        meses3.push(`${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, "0")}`);
      }
      const catNomes = new Map(src.categorias.map((c) => [c.id, c.nome]));
      for (const [catId, atual] of mapAtual) {
        if (catId === "_sem") continue;
        if (atual < 50) continue;
        const valores = meses3.map((ym) => totaisPorMes.get(ym)?.get(catId) ?? 0);
        const mesesComDados = valores.filter((v) => v > 0).length;
        if (mesesComDados < 2) continue; // precisa de histórico mínimo
        const media = valores.reduce((s, v) => s + v, 0) / 3;
        if (media <= 0) continue;
        const ratio = atual / media;
        const excesso = atual - media;
        if (ratio >= 2 && excesso >= 50) {
          const nome = catNomes.get(catId) ?? "Outros";
          const vezes = ratio.toFixed(1).replace(".", ",");
          drafts.push({
            type: "gasto_fora_padrao_categoria",
            title: `Gasto fora do padrão em ${nome}`,
            description: `Você gastou ${vezes}x a sua média dos últimos 3 meses em ${nome} (R$ ${atual.toFixed(2).replace(".", ",")} vs média R$ ${media.toFixed(2).replace(".", ",")}).`,
            priority: ratio >= 3 ? "alta" : "media",
            related_entity_type: "categoria",
            related_entity_id: catId,
            action_label: "Ver gastos",
            action_url: "/gastos",
            dedupe_key: `gasto_fora_padrao_categoria:${catId}`,
            period_key: period,
            metadata: { categoria: nome, atual, media, ratio, mesesComDados },
          });
        }
      }
    }
  }

  // Possível duplicado: mesma descrição+valor+data nos últimos 7 dias
  const recentes = gastosConfirmados.filter((g) => {
    const dias = diffDaysLocal(g.data);
    return dias <= 0 && dias >= -7;
  });
  const map = new Map<string, Gasto[]>();
  for (const g of recentes) {
    const k = `${g.data}|${g.valor}|${(g.descricao || "").toLowerCase().trim()}`;
    const arr = map.get(k) ?? [];
    arr.push(g);
    map.set(k, arr);
  }
  for (const [k, arr] of map.entries()) {
    if (arr.length >= 2) {
      const g0 = arr[0]!;
      drafts.push({
        type: "gasto_duplicado",
        title: "Possível gasto duplicado",
        description: `${arr.length} lançamentos iguais em ${g0.data} (${g0.descricao}).`,
        priority: "media",
        related_entity_type: "gasto",
        related_entity_id: g0.id,
        action_label: "Ver gastos",
        action_url: "/gastos",
        dedupe_key: `gasto_duplicado:${k}`,
        period_key: period,
        metadata: { ids: arr.map((x) => x.id), valor: g0.valor },
      });
    }
  }

  // ============= Alertas inteligentes adicionais (Sprint 6) =============

  // ---- (1) Assinatura possivelmente esquecida / inativa ----
  // Recorrência ATIVA ou SUSPEITA cuja última ocorrência real em `gastos`
  // (via recorrenciaId) é > 60 dias, OU `proximaCobranca` venceu há > 60 dias.
  // Conservador: exige histórico (ultimoValor != null OU ao menos 1 gasto vinculado).
  {
    const ultimoPorRec = new Map<string, string>();
    for (const g of gastosConfirmados) {
      if (!g.recorrenciaId) continue;
      const atual = ultimoPorRec.get(g.recorrenciaId);
      if (!atual || g.data > atual) ultimoPorRec.set(g.recorrenciaId, g.data);
    }
    for (const r of src.recorrencias) {
      if (r.status !== "ativa" && r.status !== "suspeita") continue;
      const ultima = ultimoPorRec.get(r.id);
      const temHistorico = !!ultima || r.ultimoValor != null;
      if (!temHistorico) continue;

      let diasSemCobranca: number | null = null;
      if (ultima) {
        diasSemCobranca = Math.abs(diffDaysLocal(ultima));
      } else if (r.proximaCobranca) {
        const d = diffDaysLocal(r.proximaCobranca);
        if (d < 0) diasSemCobranca = Math.abs(d);
      }
      if (diasSemCobranca == null || diasSemCobranca < 60) continue;

      drafts.push({
        type: "assinatura_esquecida",
        title: `${r.nome} pode estar esquecida`,
        description: `Sem cobrança há ${diasSemCobranca} dias. Confira se ainda faz sentido mantê-la.`,
        priority: diasSemCobranca >= 90 ? "media" : "baixa",
        related_entity_type: "recorrencia",
        related_entity_id: r.id,
        action_label: "Ver assinaturas",
        action_url: "/assinaturas",
        dedupe_key: `assinatura_esquecida:${r.id}`,
        period_key: period,
        metadata: { diasSemCobranca, status: r.status, valor: r.valor },
      });
    }
  }

  // ---- (2) Gasto acima da média por ESTABELECIMENTO ----
  // Compara um gasto recente (últimos 30 dias) com a média histórica do mesmo
  // estabelecimento nos 90 dias anteriores. Conservador:
  //   - precisa de >= 3 ocorrências históricas (excluindo o atual)
  //   - razão >= 2x sobre a média histórica
  //   - excesso absoluto >= R$ 50
  //   - valor mínimo do gasto >= R$ 30 (evita ruído)
  // Dedupe por id do gasto (1 alerta por lançamento).
  {
    const historico = new Map<string, number[]>(); // estab norm -> valores históricos (>30 dias)
    const recentes: Gasto[] = [];
    const norm = (s: string) => (s || "").toLowerCase().trim();
    for (const g of gastosConfirmados) {
      const dias = diffDaysLocal(g.data);
      const estab = norm(g.estabelecimento);
      if (!estab) continue;
      if (dias <= 0 && dias >= -30) {
        recentes.push(g);
      } else if (dias < -30 && dias >= -120) {
        const arr = historico.get(estab) ?? [];
        arr.push(Number(g.valor || 0));
        historico.set(estab, arr);
      }
    }
    for (const g of recentes) {
      if (Number(g.valor || 0) < 30) continue;
      const estab = norm(g.estabelecimento);
      const valores = historico.get(estab);
      if (!valores || valores.length < 3) continue;
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      if (media <= 0) continue;
      const ratio = g.valor / media;
      const excesso = g.valor - media;
      if (ratio < 2 || excesso < 50) continue;
      drafts.push({
        type: "gasto_acima_media_estabelecimento",
        title: `Gasto acima do padrão em ${g.estabelecimento}`,
        description: `R$ ${g.valor.toFixed(2).replace(".", ",")} — cerca de ${ratio.toFixed(1).replace(".", ",")}x sua média recente (R$ ${media.toFixed(2).replace(".", ",")}). Vale revisar se foi algo pontual.`,
        priority: ratio >= 3 ? "media" : "baixa",
        related_entity_type: "gasto",
        related_entity_id: g.id,
        action_label: "Ver gastos",
        action_url: "/gastos",
        dedupe_key: `gasto_acima_media_estab:${g.id}`,
        period_key: period,
        metadata: {
          estabelecimento: g.estabelecimento,
          valor: g.valor,
          media,
          ratio,
          amostras: valores.length,
        },
      });
    }
  }

  // ---- (3) Possível cobrança ruim no cartão ----
  // Detecta no crédito:
  //   (a) palavras-chave de tarifas/anuidade/IOF/juros na descrição ou estab;
  //   (b) gasto isolado muito alto comparado à mediana do cartão (>= 3x e >= R$ 300),
  //       sem `recorrenciaId` vinculado (não é assinatura conhecida).
  // Considera apenas gastos dos últimos 45 dias. Dedupe por id do gasto.
  {
    const KEYWORDS = [
      "anuidade",
      "tarifa",
      "iof",
      "juros",
      "encargo",
      "multa",
      "rotativo",
      "atraso",
    ];
    const porCartao = new Map<string, number[]>();
    const recentesCred: Gasto[] = [];
    for (const g of gastosConfirmados) {
      if (g.formaPagamento !== "credito" || !g.cartaoId) continue;
      const dias = diffDaysLocal(g.data);
      if (dias > 0 || dias < -45) continue;
      recentesCred.push(g);
      const arr = porCartao.get(g.cartaoId) ?? [];
      arr.push(Number(g.valor || 0));
      porCartao.set(g.cartaoId, arr);
    }
    const medianas = new Map<string, number>();
    for (const [cid, arr] of porCartao) {
      if (arr.length < 5) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      medianas.set(cid, median);
    }
    for (const g of recentesCred) {
      const texto = `${g.descricao || ""} ${g.estabelecimento || ""}`.toLowerCase();
      const hitKeyword = KEYWORDS.some((k) => texto.includes(k));
      const med = medianas.get(g.cartaoId!) ?? 0;
      const valorAlto = !g.recorrenciaId && med > 0 && g.valor >= 300 && g.valor >= med * 3;
      if (!hitKeyword && !valorAlto) continue;
      const motivo = hitKeyword
        ? "Pode ser tarifa, anuidade ou encargo."
        : `Valor incomum: R$ ${g.valor.toFixed(2).replace(".", ",")} (mediana do cartão R$ ${med.toFixed(2).replace(".", ",")}).`;
      drafts.push({
        type: "cartao_cobranca_suspeita",
        title: `Cobrança no cartão pode merecer revisão`,
        description: `${g.estabelecimento || g.descricao}: ${motivo}`,
        priority: hitKeyword ? "media" : "baixa",
        related_entity_type: "gasto",
        related_entity_id: g.id,
        action_label: "Ver cartão",
        action_url: "/cartoes",
        dedupe_key: `cartao_cobranca_suspeita:${g.id}`,
        period_key: period,
        metadata: {
          valor: g.valor,
          cartaoId: g.cartaoId,
          motivo: hitKeyword ? "keyword" : "valor_alto",
          mediana: med,
        },
      });
    }
  }

  // ============= Investimentos =============
  if (src.investimentos) {
    for (const a of src.investimentos) {
      if (a.data_vencimento) {
        const dias = diffDaysLocal(a.data_vencimento);
        if (dias >= 0 && dias <= 30) {
          drafts.push({
            type: "investimento_vencendo",
            title: `Investimento ${a.nome} vencendo`,
            description:
              dias === 0 ? "Vence hoje." : `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}.`,
            priority: "media",
            related_entity_type: "investimento",
            related_entity_id: a.id,
            action_label: "Ver investimentos",
            action_url: "/investimentos",
            dedupe_key: `investimento_vencendo:${a.id}`,
            period_key: a.data_vencimento,
            metadata: { valor: a.valor_atual ?? a.valor_aplicado },
          });
        }
      }
      // Sem preço atual quando há quantidade
      if ((a.quantidade ?? 0) > 0 && !a.preco_atual && !a.valor_atual) {
        drafts.push({
          type: "investimento_sem_preco",
          title: `${a.nome} sem preço atual`,
          description: "Atualize para acompanhar a rentabilidade.",
          priority: "baixa",
          related_entity_type: "investimento",
          related_entity_id: a.id,
          action_label: "Ver investimentos",
          action_url: "/investimentos",
          dedupe_key: `investimento_sem_preco:${a.id}`,
          period_key: period,
          metadata: {},
        });
      }
      // Carteira sem atualização recente
      if (a.ultima_atualizacao) {
        const ms = Date.now() - new Date(a.ultima_atualizacao).getTime();
        const dias = Math.floor(ms / 86_400_000);
        if (dias >= 30) {
          drafts.push({
            type: "investimento_sem_atualizacao",
            title: `${a.nome} sem atualização há ${dias} dias`,
            description: "Atualize o valor atual para análise correta.",
            priority: "baixa",
            related_entity_type: "investimento",
            related_entity_id: a.id,
            action_label: "Ver investimentos",
            action_url: "/investimentos",
            dedupe_key: `investimento_sem_atualizacao:${a.id}`,
            period_key: period,
            metadata: { dias },
          });
        }
      }
    }
  }

  // ============= Plano do app =============
  if (src.planoStatus === "expirado") {
    drafts.push({
      type: "plano_expirado",
      title: "Plano expirado",
      description: "Renove para continuar com os recursos premium.",
      priority: "critica",
      action_label: "Ver meu plano",
      action_url: "/meu-plano",
      dedupe_key: "plano_expirado",
      period_key: period,
      metadata: {},
    });
  } else if (src.planoStatus === "pendente") {
    drafts.push({
      type: "plano_pagamento_pendente",
      title: "Pagamento pendente",
      description: "Conclua o pagamento para liberar seu plano.",
      priority: "alta",
      action_label: "Ver meu plano",
      action_url: "/meu-plano",
      dedupe_key: "plano_pagamento_pendente",
      period_key: period,
      metadata: {},
    });
  } else if (src.planoStatus === "teste" && (src.trialDaysLeft ?? 99) <= 3) {
    drafts.push({
      type: "plano_trial_acabando",
      title: "Seu teste grátis está acabando",
      description: `Restam ${src.trialDaysLeft} ${src.trialDaysLeft === 1 ? "dia" : "dias"}.`,
      priority: "alta",
      action_label: "Ver meu plano",
      action_url: "/meu-plano",
      dedupe_key: "plano_trial_acabando",
      period_key: period,
      metadata: { trialDaysLeft: src.trialDaysLeft },
    });
  }

  return drafts;
}
