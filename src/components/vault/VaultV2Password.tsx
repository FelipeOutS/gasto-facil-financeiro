import { useRef, useState } from "react";
import { Eye, EyeOff, Fingerprint, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import * as V from "@/lib/vault/v2/service";
import { deviceLabel, evaluate, passkeyAvailable } from "@/lib/vault/v2/passkey";
import { vaultEmailFn } from "@/lib/vault/v2/email.functions";

/** Both enrollment and email recovery require NEW cryptographic proof. No cached DEK. */
export function VaultV2Password({
  store,
  vault,
  slots,
  recovery = false,
  onDone,
}: {
  store: V.VaultStore;
  vault: V.Vault;
  slots: V.Slot[];
  recovery?: boolean;
  onDone: () => void | Promise<void>;
}) {
  const [nonce, setNonce] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const hasPassword = V.activeSlots(slots).some((s) => s.kind === "password");
  const pks = V.activeSlots(slots).filter((s) => s.kind === "passkey_prf");
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(
        "Não foi possível concluir. Confira os dados. Códigos expiram em 10 minutos; após 5 tentativas, aguarde um novo envio.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      setKey("");
    }
  }
  async function change(bio: boolean, disable = false) {
    if (!disable && (password.length < 12 || password !== confirm)) {
      toast.error("Use pelo menos 12 caracteres e confirme a mesma senha.");
      return;
    }
    await run(async () => {
      const dek = bio
        ? await V.unlockWithPasskey(
            store,
            vault,
            await evaluate(
              pks.map((s) => ({ credentialId: s.credential_id!, prfSalt: s.prf_salt! })),
            ),
            deviceLabel(),
          )
        : await V.unlockWithRecovery(store, vault, key, deviceLabel());
      await V.setPassword(
        store,
        vault,
        dek,
        disable ? null : password,
        recovery ? nonce : undefined,
      );
      setPassword("");
      setConfirm("");
      if (recovery) toast.info("O aviso da alteração foi colocado na fila de e-mails.");
      toast.success(
        disable
          ? "Desbloqueio por senha desativado."
          : "Senha do Cofre definida. Use-a no próximo desbloqueio.",
      );
      await onDone();
    });
  }
  return (
    <section className="space-y-4 text-left">
      <p className="text-sm text-muted-foreground">
        Esta senha pertence apenas ao Cofre novo. Para cadastrar, alterar ou desativar, confirme
        novamente um dispositivo autorizado ou a chave de recuperação.
      </p>
      {recovery && !verified ? (
        <>
          <p className="text-sm">
            O código vai para o e-mail verificado da sua conta. Além dele, você precisará da chave
            de recuperação ou de um dispositivo autorizado.
          </p>
          {!nonce ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await vaultEmailFn({ data: { action: "begin", vault: vault.id } });
                  if ("nonce" in r) setNonce(r.nonce);
                })
              }
            >
              Enviar código por e-mail
            </Button>
          ) : (
            <>
              <Label htmlFor="vault-code">Código de 6 dígitos</Label>
              <Input
                id="vault-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <Button
                disabled={busy || code.length !== 6}
                onClick={() =>
                  run(async () => {
                    await vaultEmailFn({
                      data: { action: "verify", vault: vault.id, nonce, code },
                    });
                    setVerified(true);
                    setCode("");
                  })
                }
              >
                Verificar código
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setNonce(undefined);
                  setCode("");
                }}
              >
                Solicitar outro código
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="v2-password">
              {hasPassword ? "Nova senha do Cofre" : "Cadastrar senha do Cofre"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="v2-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                maxLength={1024}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Label htmlFor="v2-confirm">Confirmar nova senha</Label>
            <Input
              id="v2-confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              maxLength={1024}
            />
            <p className="text-xs text-muted-foreground">
              Pelo menos 12 caracteres. Prefira uma frase longa e exclusiva.
            </p>
          </div>
          {pks.length > 0 && (
            <Button
              className="w-full"
              disabled={busy || !passkeyAvailable()}
              onClick={() => change(true)}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              Confirmar com Face ID / Touch ID
            </Button>
          )}
          <Label htmlFor="v2-proof">Chave de recuperação</Label>
          <Input
            id="v2-proof"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={busy}
          />
          <Button
            className="w-full"
            variant="outline"
            disabled={busy || !key}
            onClick={() => change(false)}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Confirmar com chave de recuperação
          </Button>
          {!recovery && hasPassword && (
            <Button
              variant="destructive"
              disabled={busy || !key}
              onClick={() => change(false, true)}
            >
              Desativar senha usando chave de recuperação
            </Button>
          )}
        </>
      )}
    </section>
  );
}
