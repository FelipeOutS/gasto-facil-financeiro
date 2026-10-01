import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMonthsYm, competenciaPorData, nomeMesYm } from "@/lib/fatura-competencia";
import type { Cartao } from "@/lib/types";

const AUTO = "__auto__";

/**
 * "Em qual fatura essa compra vai cair?" — competência da fatura (mês do
 * vencimento). Com cartão cadastrado sugere automaticamente; sem cartão,
 * deixa a pessoa escolher. No dia exato do fechamento avisa que pode variar.
 */
export function FaturaCompetenciaField({
  data,
  cartao,
  value,
  onChange,
}: {
  data: string;
  cartao?: Cartao;
  value: string;
  onChange: (v: string) => void;
}) {
  const auto = useMemo(
    () => (cartao ? competenciaPorData(data, cartao.diaFechamento, cartao.diaVencimento) : null),
    [data, cartao],
  );
  const base = auto?.competencia ?? (data ? data.slice(0, 7) : "");
  const opcoes = useMemo(
    () => (base ? [0, 1, 2, 3].map((i) => addMonthsYm(base, auto ? i - 1 : i)) : []),
    [base, auto],
  );
  if (!base) return null;

  return (
    <div className="mt-3">
      <Label className="text-xs text-muted-foreground">Em qual fatura essa compra vai cair?</Label>
      <Select value={value || AUTO} onValueChange={(v) => onChange(v === AUTO ? "" : v)}>
        <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>
            {auto ? `Automática — Fatura de ${nomeMesYm(auto.competencia)}` : "Não sei / decidir depois"}
          </SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o} value={o}>
              Fatura de {nomeMesYm(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {auto?.diaDoFechamento
          ? "Compra no dia do fechamento: algumas operadoras jogam para a fatura seguinte. Ajuste se precisar."
          : "A fatura é identificada pelo mês do vencimento. A compra continua no mês em que foi feita."}
      </p>
    </div>
  );
}
