import { describe, expect, it } from "bun:test";
import { detectAgendaIntent, tituloFromBody } from "@/lib/agenda/intent";
import { resolveWhen, localParts } from "@/lib/agenda/datetime";
import { nextOccurrence } from "@/lib/agenda/recurrence";

const TZ = "America/Sao_Paulo";
const now = new Date("2026-10-12T18:00:00Z"); // 15:00 em SP

function criar(t: string) {
  const i = detectAgendaIntent(t);
  if (i?.type !== "criar") throw new Error("not criar");
  const { titulo, when } = tituloFromBody(i.when.rest, now, TZ);
  return { i, titulo, at: resolveWhen(when, now, TZ) };
}

describe("agenda — recorrência e consultas (2026-10-12)", () => {
  it("'todo dia 5' é mensal ancorado no dia 5, não diário", () => {
    const { i, titulo, at } = criar("me lembra todo dia 5 de pagar o aluguel");
    expect(i.recurrence).toBe("mensal");
    expect(titulo).toBe("pagar o aluguel");
    expect(localParts(at!, TZ).d).toBe(5);
    expect(localParts(at!, TZ).m).toBe(11);
  });

  it("'todo dia 31' cai no último dia em meses curtos", () => {
    const { i, at } = criar("me lembra todo dia 31 de pagar o condominio");
    expect(i.recurrence).toBe("mensal");
    expect(localParts(at!, TZ).d).toBe(31);
    const nov = nextOccurrence(at!, { freq: "mensal" }, at!, TZ)!;
    expect(localParts(nov, TZ)).toMatchObject({ m: 11, d: 30 });
  });

  it("'toda segunda às 7h' é semanal na segunda com título limpo", () => {
    const { i, titulo, at } = criar("me lembra toda segunda de ir na academia às 7h");
    expect(i.recurrence).toBe("semanal");
    expect(titulo).toBe("ir na academia");
    expect(localParts(at!, TZ)).toMatchObject({ dow: 1, h: 7 });
  });

  it("'todo dia às 8h' continua diário", () => {
    expect(criar("me lembra todo dia às 8h de tomar remédio").i.recurrence).toBe("diaria");
  });

  it("'hoje às 10h' já passado resolve no passado (o handler recusa)", () => {
    const { at } = criar("me lembra de ligar hoje às 10h");
    expect(at!.getTime()).toBeLessThan(now.getTime());
  });

  it("'quais são meus lembretes?' consulta a agenda", () => {
    expect(detectAgendaIntent("quais são meus lembretes?")).toEqual({ type: "consultar", periodo: "proximos" });
  });

  it("'gastei 50 no mercado' não vira lembrete", () => {
    expect(detectAgendaIntent("gastei 50 no mercado")).toBeNull();
  });
});

describe("handler — não agenda no passado", () => {
  it("lembrete único com horário passado pede novo horário sem gravar", async () => {
    const { handleAgendaIntent } = await import("@/server/whatsapp-agenda.server");
    const i = detectAgendaIntent("me lembra de ligar hoje às 10h")!;
    let inserts = 0;
    const deps = { now: () => now, client: { from: () => { inserts++; throw new Error("no db"); } } } as never;
    const out = await handleAgendaIntent("user-ficticio", i, { now, tz: TZ, deps });
    expect(out.resposta).toContain("já passou");
    expect(inserts).toBe(0);
  });
});
