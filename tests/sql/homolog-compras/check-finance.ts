// Recebe as linhas lidas do PG ISOLADO (mesmos filtros do loader) e valida o snapshot.
import { readFileSync } from "node:fs";
import { buildFinanceSnapshot, type FinanceRows } from "../../../src/server/shopping/finance-snapshot";
import { estimarCapacidadeCompra, AVISO_APERTO } from "../../../src/server/shopping/capacidade-compra";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as FinanceRows;
let fail = 0;
const ok = (c: boolean, n: string) => { console.log(`${c ? "PASSOU" : "FALHOU"} ${n}`); if (!c) fail++; };
ok(!rows.gastos.some((g) => g.valor === 900), "H1 gasto soft-deleted pela F2 não é lido");
ok(!JSON.stringify(rows).includes("77777") && !JSON.stringify(rows).includes("99999"), "H2 nenhuma linha de outro usuário");
const s = buildFinanceSnapshot("2026-10-13", rows);
ok(JSON.stringify(s.rendaPorMes) === JSON.stringify({ "2026-07": 500000, "2026-08": 500000, "2026-09": 500000 }), "H3 renda 3 meses completos sem transferência/mês atual");
const ids = s.compromissos.map((c) => c.id.split(":")[0]).sort().join(",");
ok(ids === "conta,parc,rec,variaveis", `H4 sem dupla contagem fatura/recorrência/parcela (${ids})`);
const cap = estimarCapacidadeCompra({ ...s, precoCents: 800_000, guardadoCents: 99_000_000, limiteCartaoCents: 99_000_000 });
ok(cap.folgaCents === 500_000 - 150_000 - 20_000 - 5_000 - 10_000, `H5 folga ${cap.folgaCents} sem guardado/limite`);
ok(cap.mensagem.includes(AVISO_APERTO), "H6 alerta >30% da folga");
process.exit(fail ? 1 : 0);
