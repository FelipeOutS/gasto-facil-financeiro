/** Separa movimentações Pluggy por instituição e origem (fictícia x real) para exibição. */
export type OriginItem = { item_id: string; connector_name: string; is_sandbox: boolean };
export type OriginTx = { item_id?: string | null; is_sandbox?: boolean | null; classification: string; review_status?: string | null };

export type OriginGroup<T> = {
  key: string;
  institution: string;
  sandbox: boolean;
  gastos: T[];
  receitas: T[];
  revisao: T[];
  ignorados: T[];
};

export function groupByOrigin<T extends OriginTx>(items: OriginItem[], txs: T[]): OriginGroup<T>[] {
  const byItem = new Map(items.map((i) => [i.item_id, i]));
  const groups = new Map<string, OriginGroup<T>>();
  for (const t of txs) {
    const item = t.item_id ? byItem.get(t.item_id) : undefined;
    // Sem prova de que é fictícia, trata como real (nunca rotula dado real como teste).
    const sandbox = t.is_sandbox === true && (item ? item.is_sandbox === true : true);
    const institution = item?.connector_name ?? "Instituição não informada";
    const key = `${sandbox ? "sb" : "real"}:${t.item_id ?? institution}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, institution, sandbox, gastos: [], receitas: [], revisao: [], ignorados: [] };
      groups.set(key, g);
    }
    if (t.classification === "gasto") g.gastos.push(t);
    else if (t.classification === "receita") g.receitas.push(t);
    else if (t.classification === "revisao") { if (!t.review_status) g.revisao.push(t); }
    else g.ignorados.push(t);
  }
  // Reais primeiro, depois fictícias.
  return [...groups.values()].sort((a, b) => Number(a.sandbox) - Number(b.sandbox) || a.institution.localeCompare(b.institution));
}
