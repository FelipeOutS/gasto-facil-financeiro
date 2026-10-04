import { getBankLogo, getExactBankSlug, normalizeName } from "@/lib/logos";

/** Identidade de apresentação; não modifica o nome nem o banco salvos. */
export function getCardIdentity(name: string | undefined | null, bank: string | undefined | null) {
  const cardName = name?.trim() ?? "";
  const rawBank = bank?.trim() ?? "";
  const nameSlug = getExactBankSlug(cardName);
  const bankSlug = getExactBankSlug(rawBank);
  const bankName = bankSlug === "mercadopago-branco" ? "Mercado Pago" : rawBank;
  const sameInstitution = Boolean(
    cardName && rawBank && (
      normalizeName(cardName) === normalizeName(rawBank) ||
      (nameSlug && bankSlug && nameSlug === bankSlug)
    ),
  );
  const hasCustomName = Boolean(cardName && rawBank && !sameInstitution);
  const wordmarkOnly = Boolean(
    sameInstitution && getBankLogo(rawBank).cardMark?.shape === "wordmark",
  );

  return {
    primary: wordmarkOnly ? null : cardName || bankName || null,
    secondary: hasCustomName ? bankName : null,
    accessibleName: hasCustomName ? `${cardName}, ${bankName}` : bankName || cardName,
    hasCustomName,
    wordmarkOnly,
  };
}
