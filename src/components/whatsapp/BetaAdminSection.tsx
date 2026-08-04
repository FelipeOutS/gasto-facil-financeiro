import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  whatsappBetaAdminCount,
  whatsappBetaAdminList,
  whatsappBetaAdminGrant,
  whatsappBetaAdminRevoke,
} from "@/lib/whatsapp-beta.functions";

type Counts = { ativos: number; revogados: number; expirados: number };
type Item = {
  id: string;
  status: "ativo" | "expirado" | "revogado" | "sem_acesso";
  granted_at: string | null;
  expires_at: string | null;
  observacao: string | null;
};

export function BetaAdminSection() {
  const countFn = useServerFn(whatsappBetaAdminCount);
  const listFn = useServerFn(whatsappBetaAdminList);
  const grantFn = useServerFn(whatsappBetaAdminGrant);
  const revokeFn = useServerFn(whatsappBetaAdminRevoke);

  const [counts, setCounts] = useState<Counts | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [obs, setObs] = useState("");
  const [granting, setGranting] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([countFn(), listFn()]);
      setCounts(c);
      setItens(l.itens);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar beta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function conceder() {
    const target = email.trim().toLowerCase();
    if (!target) {
      toast.error("Informe o e-mail do usuário.");
      return;
    }
    setGranting(true);
    try {
      const r = await grantFn({
        data: { email: target, observacao: obs.trim() || undefined },
      });
      if (r.ok) {
        toast.success("Acesso de beta concedido.");
        setEmail("");
        setObs("");
        void carregar();
      } else if (r.motivo === "usuario_nao_encontrado") {
        toast.error("Usuário não encontrado.");
      } else {
        toast.error("Não foi possível conceder o acesso.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setGranting(false);
    }
  }

  async function revogar(id: string) {
    try {
      const r = await revokeFn({ data: { id } });
      if (r.ok) {
        toast.success("Acesso revogado.");
        void carregar();
      } else {
        toast.error("Não foi possível revogar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro inesperado.");
    }
  }

  return (
    <section className="pt-3 border-t border-amber-500/20 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-amber-300">WA-F · Beta fechada do WhatsApp</h3>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar"}
        </Button>
      </div>

      {counts && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
            ativos: {counts.ativos}
          </Badge>
          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
            expirados: {counts.expirados}
          </Badge>
          <Badge variant="outline" className="border-rose-500/40 text-rose-300">
            revogados: {counts.revogados}
          </Badge>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-amber-500/20 bg-card-elevated p-3">
        <p className="text-[11px] text-muted-foreground">
          Conceder acesso pelo e-mail. Apenas Admin Master. Sem PII no painel.
        </p>
        <Input
          type="email"
          inputMode="email"
          placeholder="email@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <Textarea
          placeholder="Observação opcional (interno)"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
        />
        <Button onClick={conceder} disabled={granting} className="w-full sm:w-auto">
          {granting ? "Concedendo..." : "Conceder acesso de beta"}
        </Button>
      </div>

      <ul className="space-y-1 text-[11px] font-mono">
        {itens.length === 0 && (
          <li className="text-muted-foreground">Nenhum participante cadastrado.</li>
        )}
        {itens.map((it) => (
          <li
            key={it.id}
            className="flex items-center justify-between gap-2 rounded border border-border/60 bg-card-elevated px-2 py-1"
          >
            <span>
              status: {it.status}
              {it.expires_at
                ? ` · expira: ${new Date(it.expires_at).toLocaleDateString("pt-BR")}`
                : ""}
              {it.observacao ? ` · ${it.observacao.slice(0, 40)}` : ""}
            </span>
            {it.status !== "revogado" && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => revogar(it.id)}
              >
                revogar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
