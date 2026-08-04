/**
 * Fail-closed até uma CMP ser implementada. Anúncios diretos não consultam
 * este helper porque não usam scripts, cookies, pixels ou tracking.
 */
export function hasAdvertisingConsent(): boolean {
  return false;
}
