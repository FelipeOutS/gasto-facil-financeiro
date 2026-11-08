import { useId } from "react";
import { Button } from "@/components/ui/button";

/** Guidance only. All choices return to the existing authenticated unlock flow. */
export function VaultUnlockHelp({ biometric, pin, busy, onChoose }: {
  biometric: boolean;
  pin: boolean;
  busy: boolean;
  onChoose: (method: "bio" | "pin" | "master") => void;
}) {
  const id = useId();
  return (
    <details className="mt-5 border-t border-border pt-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
        Esqueci meu PIN ou senha
      </summary>
      <div aria-labelledby={id} className="space-y-3 pt-2 text-sm text-muted-foreground">
        <p id={id} className="font-medium text-foreground">Como acessar seu Cofre</p>
        <p>O PIN e a senha mestra do Cofre são diferentes da senha de entrada no aplicativo.</p>
        <p>Se esqueceu um deles, tente outro método já configurado neste aparelho:</p>
        <div className="flex flex-col gap-2">
          {biometric && <Button type="button" variant="outline" disabled={busy} onClick={() => onChoose("bio")}>Entrar com biometria</Button>}
          {pin && <Button type="button" variant="outline" disabled={busy} onClick={() => onChoose("pin")}>Entrar com meu PIN</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => onChoose("master")}>Entrar com senha mestra</Button>
        </div>
        <p>Alterar a senha da sua conta não altera a senha mestra nem desbloqueia o Cofre.</p>
        <p>Se a biometria funcionar, entre no Cofre, abra Alterar senha mestra e escolha confirmar com biometria. Será solicitada uma nova confirmação antes da troca.</p>
        <p>Sem a senha mestra ou a biometria configurada funcionando, esta opção não recupera a senha. Não apague o Cofre para tentar recuperar o acesso.</p>
        <p>Não desinstale o app nem limpe seus dados enquanto verifica as opções: isso pode remover o desbloqueio rápido deste aparelho.</p>
      </div>
    </details>
  );
}
