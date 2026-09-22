import { enqueueExpense, listExpenses } from "./offline-expense-queue";
import { readOfflineSnapshot } from "./offline-snapshot";
import { isValidOfflineDate } from "./offline-validation";
import type { FormaPagamento } from "../types";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let userId: string | null = null;
let saving = false;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function message(text: string) {
  el("message").textContent = text;
}
function row(description: string, value: number, date: string, status: string) {
  const item = document.createElement("li");
  const title = document.createElement("strong");
  title.textContent = description;
  const detail = document.createElement("p");
  detail.textContent = `${money.format(value)} · ${date} · ${status}`;
  item.append(title, detail);
  return item;
}
async function refresh() {
  if (!userId) return;
  const pending = await listExpenses(userId);
  el("pending").replaceChildren(
    ...pending.map((item) =>
      row(
        item.descricao,
        item.valor,
        item.data,
        item.status === "failed"
          ? "Envio pendente: confira no modo online"
          : "Salvo no aparelho — pendente",
      ),
    ),
  );
  el("count").textContent = `${pending.length} lançamento(s) aguardando envio`;
}
el<HTMLInputElement>("date").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);
el("unlock").onclick = () => {
  if (!window.AndroidSecureSession?.unlockSession) {
    message("Entre no aplicativo com internet e cadastre a biometria primeiro.");
    return;
  }
  el<HTMLButtonElement>("unlock").disabled = true;
  message("Confirme sua biometria.");
  window.AndroidSecureSession.unlockSession();
};
window.addEventListener("AndroidSecureSessionResult", async (event) => {
  el<HTMLButtonElement>("unlock").disabled = false;
  const detail = event.detail as {
    success?: boolean;
    user_id?: string;
    email?: string;
    error?: string;
  };
  if (!detail.success || !detail.user_id) {
    message(detail.error || "Não há acesso offline salvo. Entre com internet primeiro.");
    return;
  }
  userId = detail.user_id;
  el("account").textContent = detail.email || "Conta desbloqueada";
  const snapshot = readOfflineSnapshot(userId);
  const categories = snapshot?.categories.length
    ? snapshot.categories
    : [{ id: "outros", nome: "Outros" }];
  el("category").replaceChildren(
    ...categories.map((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.nome;
      return option;
    }),
  );
  el("saved").replaceChildren(
    ...(snapshot?.expenses ?? []).map((expense) =>
      row(expense.descricao, expense.valor, expense.data, "Última cópia local"),
    ),
  );
  el("snapshot").textContent = snapshot
    ? `Até 150 gastos. Cópia de ${new Date(snapshot.savedAt).toLocaleString("pt-BR")}; pode estar desatualizada.`
    : "Ainda não há gastos do site disponíveis neste aparelho.";
  el("content").hidden = false;
  el("unlock").hidden = true;
  message("Os gastos serão enviados quando você voltar ao modo online e entrar nesta mesma conta.");
  try {
    await refresh();
  } catch {
    message("Não foi possível ler os gastos locais. Não limpe os dados do aplicativo.");
  }
});
el<HTMLFormElement>("expense").onsubmit = async (event) => {
  event.preventDefault();
  if (!userId || saving) return;
  const raw = el<HTMLInputElement>("amount").value.trim();
  const description = el<HTMLInputElement>("description").value.trim();
  const date = el<HTMLInputElement>("date").value;
  if (!/^\d+([.,]\d{1,2})?$/.test(raw) || !description || !isValidOfflineDate(date)) {
    message("Confira a descrição, a data e o valor (ex.: 12,50).");
    return;
  }
  saving = true;
  el<HTMLButtonElement>("save").disabled = true;
  try {
    await enqueueExpense(userId, {
      descricao: description,
      valor: Number(raw.replace(",", ".")),
      data: date,
      categoriaId: el<HTMLSelectElement>("category").value,
      formaPagamento: el<HTMLSelectElement>("payment").value as FormaPagamento,
      tipoGasto: "unico",
      origem: "manual",
      observacao: el<HTMLInputElement>("note").value.trim() || undefined,
    });
    el<HTMLInputElement>("description").value = "";
    el<HTMLInputElement>("amount").value = "";
    el<HTMLInputElement>("note").value = "";
    message("Gasto salvo no aparelho. Pendente de envio.");
    await refresh();
  } catch {
    message("Não foi possível salvar. Verifique o armazenamento e tente novamente.");
  } finally {
    saving = false;
    el<HTMLButtonElement>("save").disabled = false;
  }
};
window.addEventListener("online", () => {
  if (
    userId &&
    !saving &&
    !el<HTMLInputElement>("description").value &&
    !el<HTMLInputElement>("amount").value
  ) {
    window.location.replace("https://gastointeligente.com.br/app");
  } else
    message(
      "A conexão voltou. Termine seu lançamento e use Voltar ao modo online para entrar e sincronizar.",
    );
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  userId = null;
  el("content").hidden = true;
  el("unlock").hidden = false;
  el<HTMLButtonElement>("unlock").disabled = false;
  el("account").textContent = "Desbloqueie sua conta para continuar.";
  message("Seus gastos permanecem salvos no aparelho.");
});
