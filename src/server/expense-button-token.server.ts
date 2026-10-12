/**
 * IDs assinados dos botões Confirmar / Ajustar / Cancelar de GASTO.
 *
 * Formato: exp1:<c|a|x>:<whatsapp_messages.id>:<mac22>. O id é a linha de
 * sessão criada pela MESMA mensagem que gerou a pergunta de confirmação; o
 * MAC prende ação + usuário + telefone + linha. Na volta, o pipeline só
 * aceita se essa linha ainda for a sessão ativa em aguardando_confirmacao —
 * qualquer gasto novo, consumido ou expirado recusa o botão.
 *
 * Chave: subchave HKDF (domínio "gi-expense-button-v1", separado da Agenda)
 * do segredo server-side existente WHATSAPP_BOLETO_FINGERPRINT_SECRET.
 * Sem segredo → não assina (o webhook envia só texto) e recusa botões.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export type ExpenseAction = "confirm" | "adjust" | "cancel";
const CODE: Record<ExpenseAction, string> = { confirm: "c", adjust: "a", cancel: "x" };
const FROM_CODE: Record<string, ExpenseAction> = { c: "confirm", a: "adjust", x: "cancel" };
/** Texto equivalente digitado (mesmo pipeline). */
export const EXPENSE_ACTION_TEXT: Record<ExpenseAction, string> = {
  confirm: "sim",
  adjust: "ajustar",
  cancel: "não",
};
export const EXPENSE_TOKEN_RE = /^exp1:([cax]):([0-9a-f-]{36}):([A-Za-z0-9_-]{22})$/;
export const LEGACY_EXPENSE_RE = /^expense_(?:confirm|adjust|cancel)$/;

function key(): Buffer | null {
  const master = process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
  if (!master || master.length < 16) return null;
  return Buffer.from(hkdfSync("sha256", master, "gi-expense", "gi-expense-button-v1", 32));
}

function mac(k: Buffer, a: string, userId: string, telefone: string, rowId: string): string {
  return createHmac("sha256", k)
    .update(`exp1|${a}|${userId}|${telefone}|${rowId}`)
    .digest("base64url")
    .slice(0, 22);
}

export function signExpenseButton(
  action: ExpenseAction,
  userId: string,
  telefone: string,
  rowId: string,
): string | null {
  const k = key();
  if (!k) return null;
  const a = CODE[action];
  return `exp1:${a}:${rowId}:${mac(k, a, userId, telefone, rowId)}`;
}

export type ExpenseTokenCheck =
  | { ok: true; action: ExpenseAction; rowId: string }
  | { ok: false };

export function verifyExpenseButton(id: string, userId: string, telefone: string): ExpenseTokenCheck {
  const m = EXPENSE_TOKEN_RE.exec(id ?? "");
  const k = key();
  if (!m || !k) return { ok: false };
  const want = Buffer.from(mac(k, m[1], userId, telefone, m[2]));
  const got = Buffer.from(m[3]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false };
  return { ok: true, action: FROM_CODE[m[1]], rowId: m[2] };
}

/** Texto do botão (antes da validação de sessão, que ocorre no pipeline). */
export function expenseTokenToTexto(id: string): string | null {
  const m = EXPENSE_TOKEN_RE.exec(id ?? "");
  return m ? EXPENSE_ACTION_TEXT[FROM_CODE[m[1]]] : null;
}
