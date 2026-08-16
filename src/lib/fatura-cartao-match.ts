import type { Cartao } from "@/lib/types";

/**
 * Sugestão de qual cartão cadastrado corresponde à fatura importada.
 * Usa pistas textuais do arquivo: nome do arquivo, observação da leitura e
 * banco identificado. Nunca decide sozinho — apenas sugere para o usuário.
 */

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai os finais de cartão citados no texto (ex.: "•••• 1234", "final 1234"). */
export function extrairFinaisCartao(texto: string): string[] {
  const out = new Set<string>();
  const t = texto || "";
  for (const m of t.matchAll(
    /(?:final|term(?:ina|inado)?(?:\s+em)?|[*•·x]{2,})[\s:.-]*(\d{4})\b/gi,
  )) {

    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

export type SugestaoCartao = {
  cartaoId: string;
  motivo: string;
};

export function sugerirCartaoDaFatura(
  cartoes: Cartao[],
  pistas: Array<string | null | undefined>,
): SugestaoCartao | null {
  if (cartoes.length === 0) return null;
  if (cartoes.length === 1) {
    return { cartaoId: cartoes[0]!.id, motivo: "é o único cartão cadastrado" };
  }
  const texto = pistas.filter(Boolean).join(" ");
  const alvo = norm(texto);
  if (!alvo) return null;

  // 1) Final do cartão (sinal mais forte)
  const finais = extrairFinaisCartao(texto);
  if (finais.length > 0) {
    const porFinal = cartoes.filter((c) => finais.some((f) => (c.nome || "").includes(f)));
    if (porFinal.length === 1) {
      return { cartaoId: porFinal[0]!.id, motivo: `final ${finais[0]} bate com o cartão` };
    }
  }

  // 2) Banco / nome do cartão presente no texto
  const candidatos = cartoes.filter((c) => {
    const banco = norm(c.banco);
    const nome = norm(c.nome);
    return (
      (banco.length >= 3 && alvo.includes(banco)) || (nome.length >= 3 && alvo.includes(nome))
    );
  });
  if (candidatos.length === 1) {
    return { cartaoId: candidatos[0]!.id, motivo: "banco do arquivo bate com o cartão" };
  }
  return null;
}
