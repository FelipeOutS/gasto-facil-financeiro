/** WhatsApp 1.2: receipts and short-lived edit/undo actions tied to real rows. */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { competenciaPorData } from "@/lib/fatura-competencia";
import { validateFinancialAmount } from "@/lib/financial-limits";
import { parseData, parseValor } from "@/lib/whatsappParser";
import { toGraphInteractive } from "./whatsapp-interactive.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _supabaseAdmin as any;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const dateBR = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
const TOKEN = /^wa12_(edit|edit_scope|undo|field|confirm|back|scope):([0-9a-f-]{36})(?::([a-z_]+))?$/i;
const expired = "Esse atalho já expirou. Você pode alterar o lançamento pelo app.";
const unavailable = "Não encontrei esse lançamento disponível para alteração. Confira seus lançamentos no app.";

type Kind = "expense" | "installment" | "income" | "recurring_income";
type Action = {
  id: string; user_id: string; telefone: string; entity_kind: Kind; entity_id: string;
  related_id: string | null; source_external_id: string; state: "active" | "undone";
  expires_at: string; edit_state: "idle" | "field" | "value" | "confirm";
  edit_field: string | null;
  pending_patch: { field: string; value: string; before: string; label: string; cardId?: string; competence?: string } | null;
};
export type PostlaunchReply = { resposta: string; graphInteractive?: Record<string, unknown> };
const buttons = (body: string, rows: Array<{ id: string; title: string }>) =>
  toGraphInteractive({ type: "button", body, buttons: rows });
const list = (body: string, rows: Array<{ id: string; title: string }>) =>
  toGraphInteractive({ type: "list", body, buttonText: "Escolher", rows });

async function actionById(userId: string, phone: string, id: string): Promise<Action | null> {
  const { data, error } = await db.from("whatsapp_recent_actions").select("*")
    .eq("id", id).eq("user_id", userId).eq("telefone", phone).maybeSingle();
  if (error) return null;
  return data as Action | null;
}

async function setEdit(action: Action, edit_state: Action["edit_state"], edit_field: string | null, pending_patch: Action["pending_patch"] = null): Promise<boolean> {
  const { data, error } = await db.from("whatsapp_recent_actions")
    .update({ edit_state, edit_field, pending_patch })
    .eq("id", action.id).eq("user_id", action.user_id).eq("telefone", action.telefone)
    .eq("state", "active").gt("expires_at", new Date().toISOString())
    .select("id").maybeSingle();
  return !error && !!data;
}

async function readFinancial(action: Action) {
  const table = action.entity_kind === "expense" || action.entity_kind === "installment" ? "gastos" : "receitas";
  let q = db.from(table).select("*").eq("id", action.entity_id).eq("user_id", action.user_id).eq("origem", "whatsapp");
  if (table === "receitas") q = q.is("deleted_at", null);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function receipt(action: Action, title = "✅ Lançamento registrado"): Promise<PostlaunchReply> {
  const row = await readFinancial(action);
  if (!row) return { resposta: "O lançamento foi salvo, mas não consegui mostrar os detalhes agora. Consulte o app para conferir." };
  const expense = action.entity_kind === "expense" || action.entity_kind === "installment";
  const lines = [title, String(row.descricao ?? "Lançamento"), brl(Number(row.valor ?? 0))];
  if (expense) {
    if (row.categoria_id) {
      const { data } = await db.from("categorias").select("nome")
        .eq("id", row.categoria_id).eq("user_id", action.user_id).maybeSingle();
      if (data?.nome) lines.push(String(data.nome));
    }
    if (row.cartao_id) {
      const { data } = await db.from("cartoes").select("nome")
        .eq("id", row.cartao_id).eq("user_id", action.user_id).maybeSingle();
      if (data?.nome) lines.push(`Cartão ${data.nome}`);
    } else if (row.forma_pagamento) lines.push(String(row.forma_pagamento));
    if (action.entity_kind === "installment" && action.related_id) {
      const { data } = await db.from("gastos").select("valor")
        .eq("user_id", action.user_id).eq("grupo_parcelamento_id", action.related_id);
      if (Array.isArray(data)) lines.push(`${data.length} parcelas · total ${brl(data.reduce((v: number, p: { valor: number }) => v + Number(p.valor), 0))}`);
    } else if (Number(row.total_parcelas ?? 0) > 1) lines.push(`${row.total_parcelas} parcelas`);
    if (row.fatura_competencia) lines.push(`Fatura ${String(row.fatura_competencia)}`);
  } else if (action.entity_kind === "recurring_income") lines.push("Receita recorrente");
  if (row.data) lines.push(dateBR(String(row.data)));
  const body = lines.join("\n");
  const canEdit = action.entity_kind !== "installment";
  const options = [
    ...(canEdit ? [{ id: `wa12_edit:${action.id}`, title: "Editar" }] : []),
    { id: `wa12_undo:${action.id}`, title: "Desfazer" },
  ];
  return { resposta: `${body}\n\n${canEdit ? "Editar ou Desfazer: use os botões abaixo." : "Desfazer: use o botão abaixo."}`, graphInteractive: buttons(body, options) };
}

export async function postlaunchReceipt(args: {
  userId: string; phone: string; externalId: string | null; kind: Kind;
  entityId: string; relatedId?: string | null;
}): Promise<PostlaunchReply | null> {
  try {
  if (!args.externalId || !args.entityId) return null;
  // The financial row must exist before the action reference or receipt.
  const draft: Action = { id: "", user_id: args.userId, telefone: args.phone, entity_kind: args.kind,
    entity_id: args.entityId, related_id: args.relatedId ?? null, source_external_id: args.externalId,
    state: "active", expires_at: "", edit_state: "idle", edit_field: null, pending_patch: null };
  const financial = await readFinancial(draft);
  if (!financial) return null;
  if (args.kind === "expense" && (financial.grupo_parcelamento_id || Number(financial.total_parcelas ?? 0) > 1 || financial.recorrencia_id)) return null;
  if (args.kind === "installment" && financial.grupo_parcelamento_id !== args.relatedId) return null;
  if (args.kind === "recurring_income" && financial.recorrencia_id !== args.relatedId) return null;
  const { data, error } = await db.from("whatsapp_recent_actions").insert({
    user_id: args.userId, telefone: args.phone, source_external_id: args.externalId,
    entity_kind: args.kind, entity_id: args.entityId, related_id: args.relatedId ?? null,
  }).select("*").maybeSingle();
  let action = data as Action | null;
  if (error?.code === "23505") {
    const { data: prior } = await db.from("whatsapp_recent_actions").select("*")
      .eq("user_id", args.userId).eq("entity_kind", args.kind).eq("entity_id", args.entityId)
      .eq("telefone", args.phone).maybeSingle();
    action = prior as Action | null;
  }
  if (!action || action.state !== "active" || Date.parse(action.expires_at) <= Date.now()) return null;
  return receipt(action, args.kind === "expense" || args.kind === "installment" ? "✅ Gasto registrado" : "✅ Receita registrada");
  } catch {
    // A experiência pós-save é opcional: nunca transformar um lançamento
    // já persistido em erro de gravação por falha de leitura do recibo.
    return null;
  }
}

export async function installmentReceipt(args: { userId: string; phone: string; externalId: string | null; expenseId: string }): Promise<PostlaunchReply | null> {
  try {
  const { data } = await db.from("gastos").select("grupo_parcelamento_id")
    .eq("id", args.expenseId).eq("user_id", args.userId).eq("origem", "whatsapp").maybeSingle();
  if (!data?.grupo_parcelamento_id) return null;
  return postlaunchReceipt({ ...args, kind: "installment", entityId: args.expenseId,
    relatedId: data.grupo_parcelamento_id });
  } catch {
    return null;
  }
}

function fieldMenu(action: Action): PostlaunchReply {
  const fields = action.entity_kind === "expense"
    ? [["valor", "Valor"], ["descricao", "Descrição"], ["categoria_id", "Categoria"], ["data", "Data"], ["forma_pagamento", "Pagamento"]]
    : [["valor", "Valor"], ["descricao", "Descrição"], ["data", "Data"]];
  const resposta = `O que você quer alterar?\n${fields.map(([_, label]) => `• ${label}`).join("\n")}`;
  return { resposta, graphInteractive: list(resposta, fields.map(([key, label]) => ({ id: `wa12_field:${action.id}:${key}`, title: label }))) };
}

function fieldFromText(text: string): string | null {
  const t = norm(text);
  if (/\b(valor|preco|quantia)\b/.test(t)) return "valor";
  if (/\b(descricao|nome)\b/.test(t)) return "descricao";
  if (/\b(categoria)\b/.test(t)) return "categoria_id";
  if (/\b(data|dia|ontem)\b/.test(t)) return "data";
  if (/\b(pagamento|cartao|pix|debito|dinheiro)\b/.test(t)) return "forma_pagamento";
  return null;
}

function valueFromNatural(text: string, field: string) {
  const t = text.trim();
  if (field === "valor") return t.replace(/^(?:muda|troca|altera|corrige)\s+(?:o\s+)?valor\s+(?:para|pra)\s+/i, "");
  if (field === "categoria_id") return t.replace(/^(?:muda|troca|altera)\s+(?:a\s+)?categoria\s+(?:para|pra)\s+/i, "");
  if (field === "data") return t.replace(/^(?:a\s+)?data\s+(?:foi|era|para)\s+/i, "");
  if (field === "forma_pagamento") return t.replace(/^(?:foi\s+no|paguei\s+no|muda\s+para)\s+/i, "");
  return t;
}

async function proposal(action: Action, field: string, raw: string): Promise<Action["pending_patch"] | null> {
  const row = await readFinancial(action);
  if (!row) return null;
  const value = valueFromNatural(raw, field);
  if (field === "descricao") {
    const clean = value.trim();
    if (clean.length < 2 || clean.length > 80) return null;
    return { field, value: clean, before: String(row.descricao ?? ""), label: clean };
  }
  if (field === "valor") {
    const parsed = parseValor(value);
    const validated = validateFinancialAmount(parsed);
    if (!validated.ok) return null;
    return { field, value: validated.value.toFixed(2), before: Number(row.valor).toFixed(2), label: brl(validated.value) };
  }
  if (field === "data") {
    const parsed = parseData(value);
    if (!parsed.matched || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.iso)) return null;
    const [y, m, d] = parsed.iso.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== parsed.iso) return null;
    const next = { field, value: parsed.iso, before: String(row.data), label: dateBR(parsed.iso) };
    if (action.entity_kind === "expense" && row.forma_pagamento === "credito") {
      if (!row.cartao_id) return null;
      const { data: card } = await db.from("cartoes").select("dia_fechamento, dia_vencimento")
        .eq("id", row.cartao_id).eq("user_id", action.user_id).maybeSingle();
      if (!card) return null;
      return { ...next, competence: competenciaPorData(parsed.iso, card.dia_fechamento, card.dia_vencimento)?.competencia ?? undefined };
    }
    return next;
  }
  if (field === "categoria_id" && action.entity_kind === "expense") {
    const { data } = await db.from("categorias").select("id, nome").eq("user_id", action.user_id);
    const matches = (Array.isArray(data) ? data : []).filter((c: { nome: string }) => norm(c.nome) === norm(value));
    if (matches.length !== 1) return null;
    return { field, value: matches[0].id, before: String(row.categoria_id ?? ""), label: matches[0].nome };
  }
  if (field === "forma_pagamento" && action.entity_kind === "expense") {
    const t = norm(value);
    const before = `${row.forma_pagamento}:${row.cartao_id ?? ""}`;
    const form = /\bpix\b/.test(t) ? "pix" : /\bdinheiro\b/.test(t) ? "dinheiro" : /\bdebito\b/.test(t) ? "debito" : /\b(cartao|credito|crédito)\b/.test(t) ? "credito" : null;
    if (!form) return null;
    if (form !== "credito") return { field, value: form, before, label: form };
    const { data } = await db.from("cartoes").select("id, nome, dia_fechamento, dia_vencimento").eq("user_id", action.user_id);
    const matches = (Array.isArray(data) ? data : []).filter((c: { nome: string }) => t.includes(norm(c.nome)));
    if (matches.length !== 1) return null;
    const card = matches[0];
    return { field, value: "credito", before, label: `cartão ${card.nome}`, cardId: card.id,
      competence: competenciaPorData(String(row.data), card.dia_fechamento, card.dia_vencimento)?.competencia ?? undefined };
  }
  return null;
}

async function saveActionMessage(userId: string, phone: string, externalId: string | null, text: string, resposta: string) {
  if (!externalId) return;
  await db.from("whatsapp_messages").insert({ user_id: userId, telefone: phone,
    external_id: externalId, texto: text, status: "sem_pendencia",
    parsed: { kind: "wa12_action" }, resposta_sugerida: resposta });
}

export async function handlePostlaunchInput(args: {
  userId: string; phone: string; externalId: string | null; text: string;
}): Promise<PostlaunchReply | null> {
  const token = TOKEN.exec(args.text);
  const lookup = token ? { data: null, error: null } : await db.from("whatsapp_recent_actions")
    .select("*").eq("user_id", args.userId).eq("telefone", args.phone)
    .eq("state", "active").neq("edit_state", "idle")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(2);
  if (lookup.error?.code === "42P01" && !token) return null; // migration 1.2 ainda não aplicada
  if (lookup.error) return { resposta: "Não consegui continuar essa ação agora. Tente novamente daqui a pouco." };
  const editingRows = lookup.data;
  if (Array.isArray(editingRows) && editingRows.length > 1) {
    return { resposta: "Encontrei mais de um ajuste em andamento. Toque em Editar no recibo que você quer alterar." };
  }
  const editing = Array.isArray(editingRows) ? editingRows[0] as Action | undefined : undefined;
  if (!token && !editing) return null;
  const action = token ? await actionById(args.userId, args.phone, token[2]) : editing as Action;
  const reply = await (async (): Promise<PostlaunchReply> => {
    if (!action) return { resposta: unavailable };
    if (action.state === "undone") return { resposta: "Esse lançamento já foi desfeito." };
    if (Date.parse(action.expires_at) <= Date.now()) {
      await db.from("whatsapp_recent_actions").update({ edit_state: "idle", edit_field: null, pending_patch: null })
        .eq("id", action.id).eq("user_id", args.userId).eq("telefone", args.phone);
      return { resposta: expired };
    }
    const command = token?.[1] ?? "text";
    if (command === "undo" && action.entity_kind === "recurring_income") {
      const body = "Quer desfazer só esta receita ou também cancelar a recorrência?";
      return { resposta: body, graphInteractive: buttons(body, [
        { id: `wa12_scope:${action.id}:occurrence`, title: "Só esta" },
        { id: `wa12_scope:${action.id}:series`, title: "Toda recorrência" },
      ]) };
    }
    if (command === "undo" || command === "scope") {
      const scope = command === "scope" ? token?.[3] : "single";
      if (action.entity_kind === "recurring_income" && scope !== "occurrence" && scope !== "series") return { resposta: "Escolha uma das opções de recorrência." };
      const { data, error } = await db.rpc("whatsapp_undo_recent_action", {
        p_user_id: args.userId, p_phone: args.phone, p_action_id: action.id, p_scope: scope,
      });
      if (error) return { resposta: "Não consegui desfazer agora. Confira o lançamento no app e tente novamente." };
      if (data === "undone") return { resposta: action.entity_kind === "recurring_income" && scope === "occurrence" ? "Pronto, removi só esta receita. A recorrência continua ativa." : "Pronto, desfiz esse lançamento." };
      if (data === "already_undone") return { resposta: "Esse lançamento já foi desfeito." };
      return { resposta: data === "expired" ? expired : unavailable };
    }
    if (command === "back" || (command === "text" && /^(?:voltar|cancelar|sair)$/.test(norm(args.text)))) {
      await setEdit(action, "idle", null);
      return { resposta: "Tudo bem, não alterei o lançamento." };
    }
    if (command === "edit") {
      if (action.entity_kind === "installment") return { resposta: "Para ajustar essa compra parcelada, use o app." };
      if (action.entity_kind === "recurring_income") {
        const body = "Posso editar só esta receita. As próximas da recorrência continuam iguais. Quer seguir?";
        return { resposta: body, graphInteractive: buttons(body, [
          { id: `wa12_edit_scope:${action.id}:occurrence`, title: "Só esta receita" },
          { id: `wa12_back:${action.id}`, title: "Voltar" },
        ]) };
      }
    }
    if (command === "edit" || command === "edit_scope") {
      if (command === "edit_scope" && (action.entity_kind !== "recurring_income" || token?.[3] !== "occurrence")) return { resposta: unavailable };
      const { error: closeError } = await db.from("whatsapp_recent_actions")
        .update({ edit_state: "idle", edit_field: null, pending_patch: null })
        .eq("user_id", args.userId).eq("telefone", args.phone).neq("id", action.id)
        .neq("edit_state", "idle");
      if (closeError) return { resposta: "Não consegui abrir o ajuste agora. Tente novamente." };
      if (!await setEdit(action, "field", null)) return { resposta: expired };
      return fieldMenu(action);
    }
    if (command === "field" || (command === "text" && action.edit_state === "field")) {
      const field = command === "field" ? token?.[3] : fieldFromText(args.text);
      const allowed = action.entity_kind === "expense"
        ? ["valor", "descricao", "categoria_id", "data", "forma_pagamento"]
        : ["valor", "descricao", "data"];
      if (!field || !allowed.includes(field)) return fieldMenu(action);
      const natural = command === "text" && /\b(?:para|pra|foi|era)\b/.test(norm(args.text)) ? await proposal(action, field, args.text) : null;
      if (natural) {
        if (!await setEdit(action, "confirm", field, natural)) return { resposta: expired };
        const body = `Alterar para ${natural.label}?`;
        return { resposta: body, graphInteractive: buttons(body, [{ id: `wa12_confirm:${action.id}`, title: "Confirmar" }, { id: `wa12_back:${action.id}`, title: "Voltar" }]) };
      }
      if (!await setEdit(action, "value", field)) return { resposta: expired };
      return { resposta: `Qual é o novo ${field === "categoria_id" ? "nome da categoria" : field === "forma_pagamento" ? "pagamento (ou cartão)" : field === "descricao" ? "nome" : field}?` };
    }
    if (command === "text" && action.edit_state === "value" && action.edit_field) {
      const patch = await proposal(action, action.edit_field, args.text);
      if (!patch) return { resposta: "Não consegui reconhecer essa alteração. Envie um valor válido ou toque em Voltar." };
      if (!await setEdit(action, "confirm", action.edit_field, patch)) return { resposta: expired };
      const body = `Alterar para ${patch.label}?`;
      return { resposta: body, graphInteractive: buttons(body, [{ id: `wa12_confirm:${action.id}`, title: "Confirmar" }, { id: `wa12_back:${action.id}`, title: "Voltar" }]) };
    }
    if ((command === "confirm" || (command === "text" && action.edit_state === "confirm" && /^(?:sim|confirmar|ok)$/.test(norm(args.text)))) && action.pending_patch) {
      const p = action.pending_patch;
      const { data, error } = await db.rpc("whatsapp_edit_recent_action", {
        p_user_id: args.userId, p_phone: args.phone, p_action_id: action.id,
        p_field: p.field, p_value: p.value, p_before: p.before,
        p_card_id: p.cardId ?? null, p_competence: p.competence ?? null,
        p_scope: action.entity_kind === "recurring_income" ? "occurrence" : "single",
      });
      if (error) return { resposta: "Não consegui alterar agora. Confira o lançamento no app." };
      if (data === "updated") return receipt(action, action.entity_kind === "expense" ? "✅ Gasto atualizado" : action.entity_kind === "recurring_income" ? "✅ Receita atualizada (só esta ocorrência)" : "✅ Receita atualizada");
      return { resposta: data === "expired" ? expired : data === "changed" ? "Esse lançamento mudou desde a confirmação. Confira no app antes de editar de novo." : unavailable };
    }
    return action.edit_state === "field" ? fieldMenu(action) : { resposta: "Use Confirmar ou Voltar para continuar." };
  })();
  await saveActionMessage(args.userId, args.phone, args.externalId, args.text, reply.resposta);
  return reply;
}
