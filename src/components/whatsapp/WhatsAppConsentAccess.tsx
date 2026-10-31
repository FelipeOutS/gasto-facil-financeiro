import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listOwnWhatsAppConsents, deleteWhatsAppLink } from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ConfirmDialog";
import { toastFromError } from "@/lib/premium-error";

/** Privacy-only access; never exposes financial history or activates a link. */
export function WhatsAppConsentAccess() {
  const list = useServerFn(listOwnWhatsAppConsents);
  const revoke = useServerFn(deleteWhatsAppLink);
  const [links, setLinks] = useState<Array<{ id: string; telefone: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    list().then(result => { if (!cancelled) setLinks(result.links); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt, list]);
  async function remove(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      if (!await confirmAsync({ title: "Revogar WhatsApp", description: "Seu número deixará de autorizar o assistente. O histórico será preservado.", confirmText: "Revogar consentimento" })) return;
      await revoke({ data: { id } });
      setLinks(current => current.filter(link => link.id !== id));
    } catch (e) { toastFromError(e); }
    finally { setBusy(null); }
  }
  return <section className="mx-auto w-full max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">Seu consentimento no WhatsApp</h1>
    <p className="text-sm text-muted-foreground">O assistente exige um plano elegível. Mesmo sem acesso ao recurso, você pode revogar seus vínculos aqui.</p>
    {loading ? <p role="status">Carregando vínculos…</p> : error ? <div role="alert">Não foi possível consultar seus vínculos. <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</Button></div> : links.length === 0 ? <p>Nenhum vínculo para revogar.</p> : links.map(link => <div key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <span>Número terminado em {link.telefone.slice(-4)}</span>
      <Button variant="outline" disabled={!!busy} onClick={() => void remove(link.id)}>{busy === link.id ? "Aguarde…" : "Revogar consentimento"}</Button>
    </div>)}
    <Link to="/meu-plano" className="inline-block underline">Ver meu plano</Link>
  </section>;
}
