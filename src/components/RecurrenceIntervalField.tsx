import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { IntegerInput } from "@/components/ui/integer-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RECURRENCE_UNITS, type RecurrenceUnit } from "@/lib/recurrence-date";
import { cn } from "@/lib/utils";

/**
 * Configuração dinâmica de recorrência: "a cada [N] [unidade]".
 *
 * Não existe regra hardcoded por intervalo — os atalhos apenas preenchem
 * `interval` + `unit`. Intervalo (quando acontece) é independente da
 * duração (quantas ocorrências), configurada separadamente.
 */
export type RecurrenceIntervalValue = {
  interval: number;
  unit: RecurrenceUnit;
};

const SHORTCUTS: { interval: number; unit: RecurrenceUnit }[] = [
  { interval: 1, unit: "mes" },
  { interval: 2, unit: "mes" },
  { interval: 3, unit: "mes" },
  { interval: 6, unit: "mes" },
  { interval: 1, unit: "ano" },
];

export function RecurrenceIntervalField({
  value,
  onChange,
  className,
}: {
  value: RecurrenceIntervalValue;
  onChange: (v: RecurrenceIntervalValue) => void;
  className?: string;
}) {
  const { t } = useTranslation("common");

  const unitLabel = (unit: RecurrenceUnit, n: number) =>
    t(`recurrence.unit.${unit}`, { count: n });

  return (
    <div className={cn("space-y-2", className)}>
      <Label className="text-xs text-muted-foreground">{t("recurrence.everyLabel")}</Label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("recurrence.every")}</span>
        <IntegerInput
          aria-label={t("recurrence.intervalAria")}
          min={1}
          max={999}
          fallback={1}
          value={value.interval}
          onValueChange={(interval) => onChange({ ...value, interval })}
          className="h-11 w-20 bg-card-elevated text-center"
        />
        <Select
          value={value.unit}
          onValueChange={(unit) => onChange({ ...value, unit: unit as RecurrenceUnit })}
        >
          <SelectTrigger className="h-11 flex-1 bg-card-elevated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECURRENCE_UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {unitLabel(u, value.interval)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SHORTCUTS.map((s) => {
          const active = s.interval === value.interval && s.unit === value.unit;
          return (
            <button
              key={`${s.interval}-${s.unit}`}
              type="button"
              onClick={() => onChange({ interval: s.interval, unit: s.unit })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-foreground/40 bg-card-elevated"
                  : "border-border text-muted-foreground hover:bg-card-elevated",
              )}
            >
              {t("recurrence.every")} {s.interval} {unitLabel(s.unit, s.interval)}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("recurrence.hint", {
          n: value.interval,
          unit: unitLabel(value.unit, value.interval),
        })}
      </p>
    </div>
  );
}
