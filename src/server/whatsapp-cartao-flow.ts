/**
 * WhatsApp Flow de cadastro de cartão — sem Data Exchange.
 *
 * O Flow é estático (modo "navigate"): abre já com os valores conhecidos
 * pré-preenchidos e devolve o formulário na conclusão como mensagem
 * `interactive.nfm_reply`. Não há endpoint, criptografia nem chave privada.
 * O conteúdo recebido é sempre revalidado no servidor.
 */
import { z } from "zod";

export const CARD_FLOW_SCREEN = "CADASTRO_CARTAO";

/** JSON do Flow para importar no WhatsApp Manager (ver docs/whatsapp-flow-cadastro-cartao.json). */
export const CARD_FLOW_JSON = {
  version: "6.0",
  screens: [
    {
      id: CARD_FLOW_SCREEN,
      title: "Cadastrar cartão",
      terminal: true,
      success: true,
      data: {
        nome: { type: "string", __example__: "Nubank" },
        limite: { type: "string", __example__: "5.000,00" },
        fechamento: { type: "string", __example__: "25" },
        vencimento: { type: "string", __example__: "5" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "TextBody",
            text: "Só o necessário para acompanhar sua fatura. Não pedimos número do cartão, CVV nem senha.",
          },
          {
            type: "TextInput",
            name: "nome",
            label: "Nome do cartão",
            "input-type": "text",
            required: true,
            "max-chars": 40,
            "helper-text": "Ex.: Nubank, Mercado Pago, Itaú Visa",
            "init-value": "${data.nome}",
          },
          {
            type: "TextInput",
            name: "limite",
            label: "Limite total (R$)",
            "input-type": "text",
            required: true,
            "max-chars": 20,
            "helper-text": "Ex.: 5.000,00",
            "init-value": "${data.limite}",
          },
          {
            type: "TextInput",
            name: "fechamento",
            label: "Dia de fechamento",
            "input-type": "number",
            required: true,
            "max-chars": 2,
            "helper-text": "De 1 a 31",
            "init-value": "${data.fechamento}",
          },
          {
            type: "TextInput",
            name: "vencimento",
            label: "Dia de vencimento",
            "input-type": "number",
            required: true,
            "max-chars": 2,
            "helper-text": "De 1 a 31",
            "init-value": "${data.vencimento}",
          },
          {
            type: "Footer",
            label: "Continuar",
            "on-click-action": {
              name: "complete",
              payload: {
                nome: "${form.nome}",
                limite: "${form.limite}",
                fechamento: "${form.fechamento}",
                vencimento: "${form.vencimento}",
              },
            },
          },
        ],
      },
    },
  ],
} as const;

export type CardFlowPrefill = {
  nome?: string;
  limite?: number;
  fechamento?: number;
  vencimento?: number;
};

function limiteParaCampo(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Objeto `interactive` (Graph API) que abre o Flow. Só dados do cartão. */
export function buildCardFlowInteractive(args: {
  flowId: string;
  flowToken: string;
  body: string;
  prefill: CardFlowPrefill;
  draft?: boolean;
}): Record<string, unknown> {
  const p = args.prefill;
  return {
    type: "flow",
    body: { text: args.body.slice(0, 1024) },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_token: args.flowToken,
        flow_id: args.flowId,
        flow_cta: "Cadastrar cartão",
        flow_action: "navigate",
        ...(args.draft ? { mode: "draft" } : {}),
        flow_action_payload: {
          screen: CARD_FLOW_SCREEN,
          data: {
            nome: p.nome ?? "",
            limite: limiteParaCampo(p.limite),
            fechamento: p.fechamento ? String(p.fechamento) : "",
            vencimento: p.vencimento ? String(p.vencimento) : "",
          },
        },
      },
    },
  };
}

/** flow_id configurado (só dígitos). Sem ele, cadastro conversacional. */
export function cardFlowConfig(): { flowId: string; draft: boolean } | null {
  const id = (process.env.WHATSAPP_CARD_FLOW_ID ?? "").trim();
  if (!/^\d{6,30}$/.test(id)) return null;
  const draft = (process.env.WHATSAPP_CARD_FLOW_MODE ?? "").trim().toLowerCase() === "draft";
  return { flowId: id, draft };
}

const FlowResponse = z.object({
  flow_token: z.string().min(8).max(200),
  nome: z.string().max(200).optional(),
  limite: z.string().max(60).optional(),
  fechamento: z.union([z.string().max(10), z.number()]).optional(),
  vencimento: z.union([z.string().max(10), z.number()]).optional(),
});
export type CardFlowResponse = z.infer<typeof FlowResponse>;

/** Lê `nfm_reply.response_json`. Inválido → null (nunca lança). */
export function parseCardFlowResponse(responseJson: string): CardFlowResponse | null {
  try {
    const parsed = FlowResponse.safeParse(JSON.parse(responseJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
