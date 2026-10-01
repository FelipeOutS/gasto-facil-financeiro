/** GI Agenda — agrupamento por período (no fuso do item). */
import { DEFAULT_TZ, diffDaysYmd, localParts } from "./datetime";

export type AgendaBucket = "hoje" | "amanha" | "semana" | "proximos" | "concluidos" | "cancelados";

export function bucketOf(status: string, whenIso: string | null, now: Date, tz: string = DEFAULT_TZ): AgendaBucket {
  if (status === "concluido") return "concluidos";
  if (status === "cancelado") return "cancelados";
  if (!whenIso) return "proximos";
  const diff = diffDaysYmd(localParts(new Date(whenIso), tz), localParts(now, tz));
  if (diff <= 0) return "hoje"; // atrasados ficam visíveis em Hoje
  if (diff === 1) return "amanha";
  if (diff < 7) return "semana";
  return "proximos";
}

/** Contagem para o sininho/Alertas (só lê a Agenda). */
export function countToday(items: Array<{ status: string; starts_at: string | null; timezone?: string | null }>, now: Date): number {
  return items.filter((i) => i.status === "ativo" && i.starts_at && bucketOf(i.status, i.starts_at, now, i.timezone || DEFAULT_TZ) === "hoje").length;
}
