import { Link } from "@tanstack/react-router";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Cliente } from "@/lib/clientes";

/** Nome de exibição priorizado: apelido → nome fantasia → razão social → nome. */
export function nomeExibicaoCliente(
  c: Pick<Cliente, "apelido" | "nome_fantasia" | "razao_social" | "nome"> | null | undefined,
): string {
  if (!c) return "";
  return (
    c.apelido?.trim() || c.nome_fantasia?.trim() || c.razao_social?.trim() || c.nome?.trim() || ""
  );
}

const SEM_CLIENTE = "__sem_cliente__";

interface ClienteSelectProps {
  value: string | null | undefined;
  onChange: (clienteId: string | null) => void;
  clientesAtivos: Cliente[];
  label?: string;
  className?: string;
}

/**
 * Campo "Cliente (opcional)" reutilizável.
 * Mostra apenas clientes ativos, permite "Sem cliente"
 * e quando não há cadastro mostra link para /clientes.
 */
export function ClienteSelect({
  value,
  onChange,
  clientesAtivos,
  label = "Cliente (opcional)",
  className,
}: ClienteSelectProps) {
  const semClientes = clientesAtivos.length === 0;

  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {semClientes ? (
        <div className="mt-1 rounded-lg border border-dashed border-border bg-card-elevated px-3 py-2 text-xs text-muted-foreground">
          Você ainda não tem clientes cadastrados.{" "}
          <Link
            to="/clientes"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Cadastrar cliente
          </Link>
        </div>
      ) : (
        <Select
          value={value ?? SEM_CLIENTE}
          onValueChange={(v) => onChange(v === SEM_CLIENTE ? null : v)}
        >
          <SelectTrigger className="mt-1 h-11 bg-card-elevated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_CLIENTE}>Sem cliente</SelectItem>
            {clientesAtivos
              .slice()
              .sort((a, b) =>
                nomeExibicaoCliente(a).localeCompare(nomeExibicaoCliente(b), "pt-BR", {
                  sensitivity: "base",
                }),
              )
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {nomeExibicaoCliente(c) || "Cliente sem nome"}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
