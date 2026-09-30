import { describe, expect, it } from "vitest";
import { filtrarContasAtivas, isStatusContaCancelado, listaDaAba } from "@/lib/contas-status";

type C = { id: string; venc: string; mesRef: string; status: string; valor: number };
const serie: C[] = [
  { id: "out", venc: "2026-10-03", mesRef: "2026-10", status: "cancelado", valor: 23.9 }, // individual
  { id: "nov", venc: "2026-11-03", mesRef: "2026-11", status: "cancelado", valor: 23.9 }, // massa
  { id: "dez", venc: "2026-12-03", mesRef: "2026-12", status: "cancelado", valor: 23.9 }, // massa
  { id: "jan", venc: "2027-01-03", mesRef: "2027-01", status: "cancelado", valor: 23.9 }, // massa
];
const ativas = filtrarContasAtivas(serie);
const canceladas = serie.filter((c) => isStatusContaCancelado(c.status));
const doMes = (l: C[], ym: string) => l.filter((c) => c.mesRef === ym);

describe("canceladas aparecem no mês do vencimento", () => {
  it.each([["2026-10", "out"], ["2026-11", "nov"], ["2026-12", "dez"], ["2027-01", "jan"]])(
    "%s",
    (ym, id) => {
      const a = doMes(ativas, ym);
      const c = doMes(canceladas, ym);
      expect(listaDaAba("canceladas", a, c, () => true).map((x) => x.id)).toEqual([id]);
      expect(listaDaAba("todas", a, c, () => true).map((x) => x.id)).toEqual([id]);
      for (const aba of ["pendentes", "proximas", "atrasadas", "pagas"] as const)
        expect(listaDaAba(aba, a, c, () => true)).toEqual([]);
      expect(a.reduce((s, x) => s + x.valor, 0)).toBe(0);
    },
  );
  it("individual e em massa são tratadas igual", () => {
    expect(canceladas).toHaveLength(4);
    expect(ativas).toHaveLength(0);
  });
});

import { mesSemNenhumaConta } from "@/lib/contas-status";

describe("caso real: mês só com canceladas não cai no estado vazio", () => {
  const rec = "8cab293c";
  const reais = [
    { id: "pago-out", mesRef: "2026-10", status: "pago", rec: null },
    { id: "out", mesRef: "2026-10", status: "cancelado", rec },
    { id: "nov", mesRef: "2026-11", status: "cancelado", rec },
    { id: "dez", mesRef: "2026-12", status: "cancelado", rec },
  ];
  const at = filtrarContasAtivas(reais);
  const ca = reais.filter((c) => isStatusContaCancelado(c.status));
  const ver = (ym: string, aba: "canceladas" | "todas") => {
    const a = at.filter((c) => c.mesRef === ym);
    const c = ca.filter((x) => x.mesRef === ym);
    if (mesSemNenhumaConta(a, c)) return null; // tela vazia
    return listaDaAba(aba, a, c, () => true).map((x) => x.id);
  };
  it("navegação Out → Nov → Dez → Out", () => {
    expect(ver("2026-10", "canceladas")).toEqual(["out"]);
    expect(ver("2026-11", "canceladas")).toEqual(["nov"]);
    expect(ver("2026-12", "canceladas")).toEqual(["dez"]);
    expect(ver("2026-10", "canceladas")).toEqual(["out"]);
    expect(ver("2026-11", "todas")).toEqual(["nov"]);
  });
  it("mês sem nada continua vazio", () => {
    expect(ver("2028-01", "todas")).toBeNull();
  });
});
