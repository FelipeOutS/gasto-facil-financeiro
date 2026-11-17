// WebAuthn PRF: a passkey só abre o Cofre se o aparelho devolver o segredo PRF.
// Uma passkey comum (sem PRF) nunca é tratada como capaz de descriptografar.
import { randomBytes } from "./keyslots";

type Bytes = Uint8Array<ArrayBuffer>;
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Bytes => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)) as Bytes;
};
type PrfExt = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

export function passkeyAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export function deviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const dev = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "Aparelho";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${dev} · ${br}`;
}

export type RegisteredPasskey = { credentialId: string; prfSalt: string; prf: Bytes };

export async function registerPasskey(userId: string, label: string): Promise<RegisteredPasskey> {
  if (!passkeyAvailable()) throw new Error("passkey_indisponivel");
  const salt = randomBytes(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Gasto Inteligente — Cofre" },
      user: { id: new TextEncoder().encode(`v2:${userId}`) as Bytes, name: label || "Cofre", displayName: label || "Cofre Pessoal" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      attestation: "none",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelado");
  const credentialId = b64u(new Uint8Array(cred.rawId));
  const ext = cred.getClientExtensionResults() as PrfExt;
  let first = ext.prf?.results?.first;
  if (!first) {
    if (ext.prf?.enabled === false) throw new Error("prf_nao_suportado");
    first = (await evaluate([{ credentialId, prfSalt: b64u(salt) }])).prf.buffer as ArrayBuffer;
  }
  const prf = new Uint8Array(first) as Bytes;
  if (prf.length < 32) throw new Error("prf_nao_suportado");
  return { credentialId, prfSalt: b64u(salt), prf };
}

/** Pede a biometria e devolve o PRF da passkey usada (entre as autorizadas). */
export async function evaluate(slots: { credentialId: string; prfSalt: string }[]): Promise<{ credentialId: string; prf: Bytes }> {
  if (!slots.length) throw new Error("sem_aparelho");
  const evalByCredential: Record<string, { first: Bytes }> = {};
  for (const s of slots) evalByCredential[s.credentialId] = { first: unb64u(s.prfSalt) };
  const a = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: slots.map((s) => ({ type: "public-key" as const, id: unb64u(s.credentialId) })),
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!a) throw new Error("cancelado");
  const first = (a.getClientExtensionResults() as PrfExt).prf?.results?.first;
  if (!first || first.byteLength < 32) throw new Error("prf_nao_suportado");
  return { credentialId: b64u(new Uint8Array(a.rawId)), prf: new Uint8Array(first) as Bytes };
}
