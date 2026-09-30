/**
 * Regra ÚNICA de progresso de meta financeira — usada pelo site (store) e
 * pelo WhatsApp. Não duplicar esta fórmula em outro lugar.
 *
 *  - direto:   valor_atual da meta + soma de movimentacoes_meta (legado)
 *  - guardado: soma de dinheiro_guardado vinculado à meta (meta_id)
 *  - total:    direto + guardado
 *  - restante: max(0, objetivo - total)
 */
export type MetaProgressoInput = {
  valorAtual: number | string | null | undefined;
  valorObjetivo: number | string | null | undefined;
  guardados: Array<{ valor: number | string | null | undefined }>;
  movimentacoes: Array<{ valor: number | string | null | undefined }>;
};

export type MetaProgresso = {
  total: number;
  guardado: number;
  direto: number;
  restante: number;
  objetivo: number;
  percentual: number;
};

const num = (v: unknown) => Number(v) || 0;

export function calcMetaProgresso(input: MetaProgressoInput): MetaProgresso {
  const baseline = num(input.valorAtual);
  const guardado = input.guardados.reduce((s, g) => s + num(g.valor), 0);
  const movs = input.movimentacoes.reduce((s, m) => s + num(m.valor), 0);
  const direto = baseline + movs;
  const total = direto + guardado;
  const objetivo = num(input.valorObjetivo);
  const restante = Math.max(0, objetivo - total);
  const percentual = objetivo > 0 ? Math.min(100, Math.round((total / objetivo) * 100)) : 0;
  return { total, guardado, direto, restante, objetivo, percentual };
}
