/**
 * WA-C7 — Intents de Pix e pagamentos para pessoas (favorecidos).
 *
 * Três fluxos, todos isolados do parser genérico de gastos. Rota é decidida
 * pelo handler principal (whatsapp.server.ts) ANTES da extração genérica
 * de gasto, sem perturbar os fluxos WA-C1..C4 (contas a pagar) e WA-G5A
 * (comprovantes).
 *
 *  1) handleSavePixIntent   → cadastra/atualiza chave Pix de um favorecido
 *  2) handleQueryPixIntent  → consulta chave Pix por nome (com desambiguação)
 *  3) handlePagarPessoaIntent → registra gasto para pessoa, vinculando ao
 *                              `fornecedor_id` quando existe match único.
 *
 * Garantias de segurança/LGPD:
 *  - Logs NUNCA contêm chave Pix, CPF, CNPJ, telefone, email, nome do
 *    favorecido ou texto do usuário. Apenas: event, stage, result,
 *    favorecidosCount, pixKeyType.
 *  - Toda query SQL filtra por `user_id` explicitamente (RLS + defesa em
 *    profundidade), padrão estabelecido em WA-C5.1 / A-02.
 *  - O parser puro vive em `whatsapp-pix-parser.ts` e é trivialmente
 *    exercitável em testes unitários sem mocks.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProcessOutcome, WhatsAppMessageRow } from "./whatsapp.server";
import {
  detectSavePixIntent,
  parseSavePix,
  detectQueryPixIntent,
  parseQueryPix,
  detectPagarPessoaIntent,
  parsePagarPessoa,
} from "./whatsapp-pix-parser";
import {
  findFavorecidosByNome,
  createFavorecido,
  updateFavorecidoPix,
  rotuloTipoPix,
  type FavorecidoRow,
} from "./whatsapp-favorecidos.server";
import {
  recordFavorecido,
  getLastFavorecido,
} from "./whatsapp-short-context.server";
import { whatsappMessages as M } from "./whatsapp-messages";

// Live-binding para permitir mock.module() em testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, {
  get: (_t, prop) => (_supa.supabaseAdmin as never)[prop as never],
});

// Re-export para o roteador principal.
export {
  detectSavePixIntent,
  detectQueryPixIntent,
  detectPagarPessoaIntent,
} from "./whatsapp-pix-parser";

// ---------- formatação ----------

function formatBRL(centavos: number): string {
  const v = centavos / 100;
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function maskPixDisplay(chave: string, tipo: string): string {
  // Para exibição: não mascara aqui. Usuário pediu o Pix, queremos entregar
  // a chave. Mascaramento é apenas para LOGS (que jamais incluem a chave).
  return chave;
}

// ---------- 1) Cadastrar Pix ----------

export async function handleSavePixIntent(args: {
  userId: string;
  telefone: string;
  texto: string;
  _row: WhatsAppMessageRow;
}): Promise<ProcessOutcome> {
  const parsed = parseSavePix(args.texto);
  if (!parsed) {
    console.info({
      event: "wa_pix_save",
      stage: "parse_failed",
      result: "needs_format",
    });
    return { status: "sem_pendencia", resposta: M.pix.pedirFormato() };
  }

  // Procura favorecido existente para o user (sem expor nome em log).
  const existing = await findFavorecidosByNome(args.userId, parsed.nome);
  // Match exato (case-insensitive) → atualiza; senão, cria.
  const exato = existing.find(
    (f) => f.nome.trim().toLowerCase() === parsed.nome.trim().toLowerCase(),
  );

  if (exato) {
    const ok = await updateFavorecidoPix(
      args.userId,
      exato.id,
      parsed.pixKey,
      parsed.pixKeyType,
    );
    console.info({
      event: "wa_pix_save",
      stage: "update",
      result: ok ? "ok" : "fail",
      pixKeyType: parsed.pixKeyType,
    });
    if (!ok) {
      return {
        status: "erro",
        resposta:
          "Não consegui salvar agora. Tente de novo daqui a pouco, por favor.",
      };
    }
    recordFavorecido(args.telefone, exato.nome);
    return {
      status: "salva",
      resposta: M.pix.atualizado({
        nome: exato.nome,
        tipo: rotuloTipoPix(parsed.pixKeyType),
      }),
    };
  }

  const novo = await createFavorecido({
    userId: args.userId,
    nome: parsed.nome,
    pixKey: parsed.pixKey,
    pixKeyType: parsed.pixKeyType,
  });
  console.info({
    event: "wa_pix_save",
    stage: "create",
    result: novo ? "ok" : "fail",
    pixKeyType: parsed.pixKeyType,
  });
  if (!novo) {
    return {
      status: "erro",
      resposta:
        "Não consegui salvar agora. Tente de novo daqui a pouco, por favor.",
    };
  }
  recordFavorecido(args.telefone, novo.nome);
  return {
    status: "salva",
    resposta: M.pix.salvo({
      nome: novo.nome,
      tipo: rotuloTipoPix(parsed.pixKeyType),
    }),
  };
}

// ---------- 2) Consultar Pix ----------

export async function handleQueryPixIntent(args: {
  userId: string;
  telefone: string;
  texto: string;
  _row: WhatsAppMessageRow;
}): Promise<ProcessOutcome> {
  const parsed = parseQueryPix(args.texto);
  const termo = parsed?.nome ?? getLastFavorecido(args.telefone);
  if (!termo) {
    return {
      status: "sem_pendencia",
      resposta:
        'Me diga de quem você quer o Pix. Ex.: "qual o Pix do João?"',
    };
  }

  const matches = await findFavorecidosByNome(args.userId, termo);
  console.info({
    event: "wa_pix_query",
    stage: "lookup",
    favorecidosCount: matches.length,
  });

  if (matches.length === 0) {
    return {
      status: "sem_pendencia",
      resposta: M.pix.favorecidoNaoEncontrado(termo),
    };
  }
  if (matches.length > 1) {
    // Desambiguação por humano.
    return {
      status: "sem_pendencia",
      resposta: M.pix.ambiguidade({
        termo,
        nomes: matches.map((m) => m.nome),
      }),
    };
  }
  const f = matches[0];
  if (!f.pix_key || !f.pix_key_type) {
    recordFavorecido(args.telefone, f.nome);
    return {
      status: "sem_pendencia",
      resposta: M.pix.semPixCadastrado(f.nome),
    };
  }
  recordFavorecido(args.telefone, f.nome);
  return {
    status: "consulta",
    resposta: M.pix.consultaUnica({
      nome: f.nome,
      tipo: rotuloTipoPix(f.pix_key_type),
      chave: maskPixDisplay(f.pix_key, f.pix_key_type),
    }),
  };
}

// ---------- 3) Pagamento para pessoa ----------

const OUTROS_LEGACY = "outros";

async function resolveOutrosCategoriaId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (!Array.isArray(data) || data.length === 0) return null;
  const outros = data.find(
    (c: { legacy_id?: string | null; nome?: string }) =>
      c.legacy_id === OUTROS_LEGACY ||
      (c.nome ?? "").toLowerCase().trim() === "outros",
  );
  return (outros as { id: string } | undefined)?.id ?? null;
}

export async function handlePagarPessoaIntent(args: {
  userId: string;
  telefone: string;
  texto: string;
  _row: WhatsAppMessageRow;
}): Promise<ProcessOutcome> {
  const parsed = parsePagarPessoa(args.texto);
  if (!parsed || parsed.valorCentavos <= 0) {
    console.info({
      event: "wa_pix_payment",
      stage: "parse_failed",
      result: "needs_format",
    });
    return {
      status: "sem_pendencia",
      resposta:
        'Não entendi. Tente "paguei R$ 50 ao João" ou "paguei 50 para Maria do almoço".',
    };
  }

  const matches = await findFavorecidosByNome(args.userId, parsed.nome);
  const favorecido: FavorecidoRow | null =
    matches.length === 1 ? matches[0] : null;

  const catId = await resolveOutrosCategoriaId(args.userId);
  if (!catId) {
    console.error({
      event: "wa_pix_payment",
      stage: "categoria_outros_missing",
      result: "fail",
    });
    return {
      status: "erro",
      resposta:
        "Não encontrei a categoria padrão para salvar. Tente de novo em instantes.",
    };
  }

  const hoje = new Date();
  const data = hoje.toISOString().slice(0, 10);
  const y = hoje.getFullYear();
  const mo = hoje.getMonth() + 1;
  const descricao = parsed.descricao ?? `Pagamento para ${parsed.nome}`;
  const obs = `WhatsApp: pagamento para ${parsed.nome}${parsed.descricao ? ` — ${parsed.descricao}` : ""}`.slice(0, 240);

  const { data: row, error } = await supabaseAdmin
    .from("gastos")
    .insert({
      user_id: args.userId,
      categoria_id: catId,
      descricao: descricao.slice(0, 120),
      estabelecimento: parsed.nome.slice(0, 120),
      valor: parsed.valorCentavos,
      data,
      mes: mo,
      ano: y,
      forma_pagamento: parsed.formaPagamento,
      cartao_id: null,
      tipo_gasto: "unico",
      total_parcelas: null,
      observacao: obs,
      origem: "whatsapp",
      confirmado: true,
      fornecedor_id: favorecido?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error({
      event: "wa_pix_payment",
      stage: "insert_failed",
      result: "fail",
    });
    return {
      status: "erro",
      resposta:
        "Não consegui registrar agora. Tente de novo daqui a pouco, por favor.",
    };
  }

  recordFavorecido(args.telefone, parsed.nome);
  console.info({
    event: "wa_pix_payment",
    stage: "saved",
    result: "ok",
    favorecidoMatched: !!favorecido,
  });

  return {
    status: "salva",
    gastoId: row.id as string,
    resposta: M.pix.pagamentoSalvo({
      valor: formatBRL(parsed.valorCentavos),
      nome: parsed.nome,
      descricao: parsed.descricao,
    }),
  };
}
