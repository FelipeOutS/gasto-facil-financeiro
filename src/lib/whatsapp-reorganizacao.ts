import { parseValor } from "./whatsappParser";
import { parseOpeningBalance, type OpeningBalanceRequest } from "./account-opening-balance";

export const REORGANIZACAO_TTL_MS = 5 * 60 * 1000;
export const REORGANIZACAO_MAX = 500;
export type FinancialScope = { tables: Array<"gastos" | "receitas">; start: string | null; end: string | null };
export type NewIncome = { descricao: string; valor: number; data: string; tipo: string };
export type ReorganizationIntent =
  | { kind: "ignore" }
  | { kind: "clarify"; question: string }
  | { kind: "unsupported_balance"; balance?: OpeningBalanceRequest | null }
  | { kind: "request"; scope: FinancialScope; income: NewIncome | null };

export function normalizeReorganization(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const isoMonth = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
const nextMonth = (year: number, month: number) => isoMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

/** Local date is supplied by the user's existing timezone resolver, not machine UTC. */
export function interpretReorganization(text: string, localDate: string): ReorganizationIntent {
  const t = normalizeReorganization(text);
  if (/\bsaldo inicial\b/.test(t)) return { kind: "unsupported_balance", balance: parseOpeningBalance(text, localDate) };
  const verb = /\b(apag\w*|exclu\w*|limp\w*|zer\w*|reinici\w*|comec\w*)\b/.test(t);
  const bulk = /\b(todos?|todas?|tudo|inteir\w*|historico|financas|despesas|gastos|receitas|meses|em massa)\b/.test(t);
  if (!verb || !bulk) return { kind: "ignore" };
  if (/\b(pagamentos|faturas|cartoes|recorrencias|metas|investimentos|bens|integracoes|assinatura)\b/.test(t)) {
    return { kind: "clarify", question: "Preciso esclarecer os vínculos e o alcance. Você quer limpar gastos, receitas ou ambos? Cartões, faturas e demais módulos não serão alterados automaticamente." };
  }
  const parts = t.split(/\b(?:e depois|depois|e adicione|e adiciona|e cadastre|e cadastra)\b/);
  const deletion = parts[0];
  if (/\b(nao|exceto|menos|salvo)\b/.test(deletion)) return { kind: "clarify", question: "Confirme o que deve ser preservado e o período exato. Nenhuma exceção será ignorada." };
  const tables: FinancialScope["tables"] = [];
  if (/\b(gastos|despesas)\b/.test(deletion)) tables.push("gastos");
  if (/\b(receitas|rendas)\b/.test(deletion)) tables.push("receitas");
  if (!tables.length) return { kind: "clarify", question: "Quais dados deseja excluir reversivelmente: gastos, receitas ou ambos? Nada foi alterado." };
  let start: string | null = null; let end: string | null = null;
  const explicitPeriod = months.some((m) => new RegExp(`\\b${m}\\b`).test(deletion)) || /\b\d{1,2}\/20\d{2}\b/.test(deletion);
  if (/\b(meses anteriores|anteriores|antigas|antigos)\b/.test(deletion) && explicitPeriod) return { kind: "clarify", question: "Você citou meses anteriores e um período específico. Confirme as datas exatas da limpeza." };
  if (/\b(meses anteriores|anteriores|antigas|antigos)\b/.test(deletion)) {
    end = `${localDate.slice(0, 7)}-01`;
  } else if (explicitPeriod || !/\b(todos os meses|todo o historico|historico inteiro|todos os meus gastos|todas as minhas despesas|todas as minhas receitas)\b/.test(deletion)) {
    const yearMatch = deletion.match(/\b(20\d{2})\b/);
    const named = [...deletion.matchAll(new RegExp(`\\b(${months.join("|")})\\b`, "g"))];
    const numeric = deletion.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
    if (new Set(deletion.match(/\b20\d{2}\b/g) ?? []).size > 1 || (deletion.match(/\b\d{1,2}\/20\d{2}\b/g) ?? []).length > 1) return { kind: "clarify", question: "Confirme um intervalo fechado com datas inicial e final completas." };
    if (numeric) { start = isoMonth(Number(numeric[2]), Number(numeric[1])); end = nextMonth(Number(numeric[2]), Number(numeric[1])); }
    else if (yearMatch && named.length >= 1 && named.length <= 2) {
      const y = Number(yearMatch[1]); const m1 = months.indexOf(named[0][1]) + 1;
      const m2 = months.indexOf(named[named.length - 1][1]) + 1;
      if (m2 < m1 || (named.length === 2 && !/\b(ate|a)\b/.test(deletion))) return { kind: "clarify", question: "Confirme as datas inicial e final do período, incluindo o ano." };
      start = isoMonth(y, m1); end = nextMonth(y, m2);
    } else return { kind: "clarify", question: "Confirme o período e o ano, ou diga explicitamente todo o histórico. Nada foi alterado." };
  }
  if (/\b(mantenha|manter|preserve)\b/.test(deletion) && !/\b(mes atual|deste mes|desse mes)\b/.test(deletion)) return { kind: "clarify", question: "Quais informações devem ser preservadas? Confirme o alcance antes de continuar." };
  if (/\b(mes atual|deste mes|desse mes)\b/.test(deletion)) {
    if (!/\b(mantenha|manter|preserve)\b/.test(deletion)) return { kind: "clarify", question: "Deseja excluir o mês atual ou preservá-lo? Confirme as datas exatas." };
    if (explicitPeriod) return { kind: "clarify", question: "Confirme como o período solicitado se combina com a preservação do mês atual." };
    end = `${localDate.slice(0, 7)}-01`;
  }
  if (parts.length > 2) return { kind: "clarify", question: "Vamos confirmar uma limpeza e no máximo uma nova receita por solicitação." };
  let income: NewIncome | null = null;
  if (parts.length === 2) {
    const addition = parts[1];
    if (!/\b(receita|salario|renda)\b/.test(addition)) return { kind: "clarify", question: "O valor adicional é uma receita ou um saldo inicial? Saldo inicial não será registrado como receita." };
    // Extract only the monetary clause: a year or confirmation code is never an amount.
    const monetary = addition.match(/(?:r\$\s*\d[\d.,]*|\d[\d.,]*\s*reais)/i);
    const valor = monetary ? parseValor(monetary[0]) : null;
    if (!valor) return { kind: "clarify", question: "Qual é o valor exato da nova receita em reais?" };
    const named = months.filter((m) => new RegExp(`\\b${m}\\b`).test(addition));
    if (!/\b(deste mes|mes atual)\b/.test(addition) || named.length) return { kind: "clarify", question: "Confirme a data completa e a descrição da nova receita; nenhum valor foi cadastrado." };
    income = { descricao: /\bsalario\b/.test(addition) ? "Salário" : "Receita", valor, data: localDate, tipo: /\bsalario\b/.test(addition) ? "salario" : "outros" };
  }
  // Any additional creation verb not split safely must not be discarded.
  if (parts.length === 1 && /\b(adicion\w*|cadastr\w*|registr\w*)\b/.test(t)) return { kind: "clarify", question: "Confirme separadamente a limpeza e a nova receita, com valor, descrição e data." };
  return { kind: "request", scope: { tables, start, end }, income };
}

export function confirmationCode(text: string): string | null {
  const match = /^APAGAR\s+(?:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\s+)?(\d{6})$/i.exec(text.trim());
  return match?.[1] ?? null;
}
export function operationConfirmation(text: string, action: "APAGAR" | "RESTAURAR"): { operationId: string; code: string } | null {
  const m = new RegExp(`^${action}\\s+([\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{12})\\s+(\\d{6})$`, "i").exec(text.trim());
  return m ? { operationId: m[1], code: m[2] } : null;
}
export function randomConfirmationCode(): string {
  const data = new Uint32Array(1);
  // Rejection sampling avoids biased modulus distribution.
  do { crypto.getRandomValues(data); } while (data[0] >= 4294000000);
  return String(data[0] % 1000000).padStart(6, "0");
}
export function offlineWriteDecision(queuedGeneration: number | null, currentGeneration: number): "allow" | "review" {
  return (queuedGeneration ?? 0) === currentGeneration ? "allow" : "review";
}