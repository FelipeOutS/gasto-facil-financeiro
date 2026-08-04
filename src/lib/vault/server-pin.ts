// Server-side PIN do Cofre Pessoal — GLOBAL POR CONTA (zero-knowledge).
//
// Modelo: o servidor guarda apenas o salt, os parâmetros PBKDF2 e a
// chave-mestra do cofre cifrada (AES-GCM) por uma chave derivada do PIN.
// Servidor NUNCA enxerga o PIN nem a chave-mestra. O mesmo PIN funciona
// em qualquer dispositivo do usuário (desktop, mobile, Android/WebView).
//
// Limite de tentativas é aplicado no servidor pela RPC vault_pin_record_attempt,
// sem depender do cliente. Bloqueio: 5 erros => 15 min bloqueado.

import { supabase } from "@/integrations/supabase/client";
import {
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64decode,
  vaultB64encode,
  vaultRandomBytes,
} from "./crypto";

const PIN_ITERATIONS = 600_000;

type ServerPinRow = {
  user_id: string;
  salt: string;
  iterations: number;
  wrapped_key: string;
  wrap_iv: string;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
};

export type ServerPinStatus = {
  configured: boolean;
  lockedUntil: number | null; // epoch ms se bloqueado
  failedAttempts: number;
  updatedAt: number | null;
};

async function derivePinKey(pin: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(pin);
  const buf = new Uint8Array(new ArrayBuffer(enc.byteLength));
  buf.set(enc);
  const base = await crypto.subtle.importKey("raw", buf, { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: vaultB64decode(saltB64), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function fetchPinRow(userId: string): Promise<ServerPinRow | null> {
  const { data, error } = await supabase
    .from("vault_pin_settings" as never)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ServerPinRow | null) ?? null;
}

export async function getServerPinStatus(userId: string): Promise<ServerPinStatus> {
  const row = await fetchPinRow(userId);
  if (!row) {
    return { configured: false, lockedUntil: null, failedAttempts: 0, updatedAt: null };
  }
  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : null;
  return {
    configured: true,
    lockedUntil: lockedUntil && lockedUntil > Date.now() ? lockedUntil : null,
    failedAttempts: row.failed_attempts ?? 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
  };
}

/** Cria ou substitui o PIN da conta. Requer a chave-mestra desbloqueada. */
export async function enableServerPin(pin: string, masterKey: CryptoKey): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("O PIN deve ter de 4 a 8 dígitos numéricos.");
  }
  const salt = vaultB64encode(vaultRandomBytes(16));
  const wrapKey = await derivePinKey(pin, salt, PIN_ITERATIONS);
  const iv = vaultRandomBytes(12);
  const raw = await exportMasterKeyRaw(masterKey);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);

  const { error } = await supabase.rpc(
    "vault_pin_set" as never,
    {
      p_salt: salt,
      p_iterations: PIN_ITERATIONS,
      p_wrapped_key: vaultB64encode(new Uint8Array(ct)),
      p_wrap_iv: vaultB64encode(iv),
    } as never,
  );
  if (error) throw new Error("Falha ao salvar o PIN. Tente novamente.");
}

/** Remove o PIN da conta (afeta todos os dispositivos). */
export async function disableServerPin(): Promise<void> {
  const { error } = await supabase.rpc("vault_pin_delete" as never);
  if (error) throw new Error("Falha ao remover o PIN. Tente novamente.");
}

/** Desbloqueia a chave-mestra usando o PIN global da conta. */
export async function unlockWithServerPin(userId: string, pin: string): Promise<CryptoKey> {
  const row = await fetchPinRow(userId);
  if (!row) throw new Error("Nenhum PIN configurado nesta conta.");

  if (row.locked_until) {
    const until = new Date(row.locked_until).getTime();
    if (until > Date.now()) {
      const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      throw new Error(
        `Muitas tentativas. PIN bloqueado por ${mins} min. Use a senha mestra para desbloquear.`,
      );
    }
  }

  let plain: ArrayBuffer | null = null;
  try {
    const wrapKey = await derivePinKey(pin, row.salt, row.iterations);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: vaultB64decode(row.wrap_iv) },
      wrapKey,
      vaultB64decode(row.wrapped_key),
    );
  } catch {
    // PIN incorreto — registra a tentativa no servidor
    const { data } = await supabase.rpc(
      "vault_pin_record_attempt" as never,
      {
        p_success: false,
      } as never,
    );
    const row2 = Array.isArray(data)
      ? (data[0] as { failed_attempts: number; locked_until: string | null } | undefined)
      : undefined;
    const lockedUntil = row2?.locked_until ? new Date(row2.locked_until).getTime() : null;
    if (lockedUntil && lockedUntil > Date.now()) {
      const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000));
      throw new Error(`PIN incorreto. Bloqueado por ${mins} min — use sua senha mestra.`);
    }
    const left = Math.max(0, 5 - (row2?.failed_attempts ?? 0));
    throw new Error(
      left > 0
        ? `PIN incorreto. ${left} tentativa(s) restante(s) antes do bloqueio.`
        : "PIN incorreto.",
    );
  }

  // PIN correto — reseta contador
  try {
    await supabase.rpc("vault_pin_record_attempt" as never, { p_success: true } as never);
  } catch {
    // best-effort: se falhar, segue desbloqueando
  }
  return importMasterKeyRaw(new Uint8Array(plain));
}
