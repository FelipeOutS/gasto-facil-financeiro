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
  maskPixKey,
  isValidPixKey,
  type PixKeyType,
} from "./whatsapp-pix-parser";
import {
  findFavorecidosByNome,
  createFavorecido,
  updateFavorecidoPix,
  rotuloTipoPix,
  type FavorecidoRow,
} from "./whatsapp-favorecidos.server";
// WA-C7.2.a (M-2 aviso): consulta de contas a pagar pendentes para
// detectar colisão entre "paguei <nome>" e uma conta pendente do mesmo
// favorecido. Reusa o mesmo lookup já validado em WA-C3.
import { findVencimentoByTerm } from "./contas-vencimento.server";
import {
  recordFavorecido,
  getLastFavorecido,
} from "./whatsapp-short-context.server";
import { whatsappMessages as M } from "./whatsapp-messages";
import { issueRevealToken } from "./whatsapp-pix-reveal-token.server";

// Direct import mocked por `mock.module(...)` nos testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = _supabaseAdmin;

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
  // WA-Q-PixInline-Mask: mascara para exibição em consultas por texto.
  // Até termos o botão "Copiar chave Pix" (WA-PIX-UX-01), nunca devolvemos
  // a chave completa em texto plano — orientamos o usuário a abrir o app.
  return maskPixKey(chave, tipo as PixKeyType);
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

  // WA-PIX-3.26 — Validação estrita da chave Pix antes de qualquer escrita.
  // Rejeita tipo "desconhecida", CPF/CNPJ com dígito inválido, telefone
  // fora do padrão celular BR, email malformado e UUID inválido. Zero
  // favorecido criado/atualizado, zero sessão, zero claim.
  if (
    parsed.pixKeyType === "desconhecida" ||
    !isValidPixKey(parsed.pixKeyType, parsed.pixKey)
  ) {
    console.info({
      event: "wa_pix_save",
      stage: "invalid_key_rejected",
      pixKeyType: parsed.pixKeyType,
    });
    return { status: "sem_pendencia", resposta: M.pix.chaveInvalida() };
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

  // WA-PIX-UX-01 — emite token opaco de curta duração para a página autenticada
  // "Copiar chave Pix". A chave NUNCA vai no texto, no parsed nem no log; o
  // link contém apenas o token opaco.
  let copiarUrl: string | null = null;
  try {
    const issued = await issueRevealToken({
      userId: args.userId,
      favorecidoId: f.id,
      pixKeyType: f.pix_key_type,
    });
    if (issued) {
      const base =
        process.env.PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
        "https://gastointeligente.com.br";
      copiarUrl = `${base}/pix/copiar/${issued.token}`;
    }
  } catch {
    copiarUrl = null;
  }

  // WA-PIX-UX-01.c — quando temos link seguro, respondemos com uma mensagem
  // `interactive` (botão CTA URL "Copiar chave Pix"). O CORPO da mensagem
  // NUNCA contém a URL — ela vai apenas no botão. O `resposta` textual
  // reflete o mesmo corpo curto e serve de fallback caso o envio interativo
  // falhe (o usuário volta a receber apenas a máscara, sem link cru).
  if (copiarUrl) {
    const body = M.pix.consultaUnicaBody({
      nome: f.nome,
      tipo: rotuloTipoPix(f.pix_key_type),
      chave: maskPixDisplay(f.pix_key, f.pix_key_type),
    });
    return {
      status: "consulta",
      resposta: body,
      interactive: {
        type: "cta_url",
        body,
        buttonText: "Copiar chave Pix",
        url: copiarUrl,
      },
    };
  }

  return {
    status: "consulta",
    resposta: M.pix.consultaUnica({
      nome: f.nome,
      tipo: rotuloTipoPix(f.pix_key_type),
      chave: maskPixDisplay(f.pix_key, f.pix_key_type),
      copiarUrl: null,
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

  // ----------------------------------------------------------------------
  // WA-C7.2.a — M-1 (idempotência): se este `external_id` já gravou um
  // pagamento para pessoa em uma chamada anterior (webhook reentregue,
  // retry do Meta, race com a mesma mensagem), devolve a resposta neutra
  // sem inserir um segundo gasto. Não dependemos do dedup top-level
  // porque ele só cobre `status = "salva" AND gasto_id existente`; aqui
  // garantimos a checagem pelo `parsed.kind = "pagar_pessoa"`, alinhado
  // ao padrão usado em WA-F3 (parc_persistindo) e WA-C2/C4 (conta_*).
  // ----------------------------------------------------------------------
  const externalId = (args._row?.external_id ?? "").trim();
  if (externalId.length > 0) {
    const { data: prev } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, parsed, status")
      .eq("external_id", externalId)
      .eq("status", "salva")
      .maybeSingle();
    const prevParsed =
      (prev?.parsed ?? null) as { kind?: string } | null;
    if (prev && prevParsed?.kind === "pagar_pessoa" && prev.gasto_id) {
      console.info({
        event: "wa_pix_payment",
        stage: "idempotent_replay",
        result: "ok",
      });
      return {
        status: "duplicada",
        gastoId: prev.gasto_id as string,
        resposta:
          "Esse pagamento já tinha sido registrado. Está tudo certo. ✅",
      };
    }
  }

  // ----------------------------------------------------------------------
  // WA-C7.2.a — M-2 (aviso de colisão com Contas a Pagar):
  // Se existir ao menos uma conta PENDENTE compatível com o nome do
  // favorecido, NÃO criamos um gasto solto — orientamos o usuário a usar
  // "paguei <nome>" (fluxo de baixa de conta, WA-C3) ou a confirmar
  // explicitamente que quer registrar um gasto novo. O fluxo de baixa
  // automática ficará para WA-C7.2.b (state machine completo); aqui o
  // objetivo é simplesmente evitar duplicidade contábil silenciosa.
  // ----------------------------------------------------------------------
  const contasPendentes = await findVencimentoByTerm(
    args.userId,
    parsed.nome,
  );
  if (contasPendentes.length > 0) {
    console.info({
      event: "wa_pix_payment",
      stage: "payable_collision_detected",
      result: "not_found",
      candidatesCount: contasPendentes.length,
    });
    const nomesDistintos = Array.from(
      new Set(contasPendentes.map((c) => c.nome)),
    ).slice(0, 5);
    const lista = nomesDistintos.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const linhas = [
      contasPendentes.length === 1
        ? `Encontrei uma conta pendente com esse nome:`
        : `Encontrei ${contasPendentes.length} contas pendentes com esse nome:`,
      ``,
      lista,
      ``,
      `• Se foi essa conta que você pagou, responda "paguei ${parsed.nome}" para eu marcar como paga.`,
      `• Se foi um pagamento avulso para a pessoa, responda "novo gasto" e eu registro como gasto separado.`,
    ];
    return {
      status: "consulta",
      resposta: linhas.join("\n"),
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
