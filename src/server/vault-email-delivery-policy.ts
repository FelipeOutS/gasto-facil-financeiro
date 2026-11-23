/** Strict per-message expiry for vault codes, including malformed payloads. */
export function vaultCodeExpired(
  payload: { label?: string; expires_at?: string },
  now = Date.now(),
) {
  if (payload.label !== "vault-recovery-code") return false;
  const expires = Date.parse(payload.expires_at ?? "");
  return !Number.isFinite(expires) || expires <= now;
}
