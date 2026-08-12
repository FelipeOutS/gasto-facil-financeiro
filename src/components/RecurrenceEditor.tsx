import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/integer-input";
import {
  RecurrenceIntervalField,
  type RecurrenceIntervalValue,
} from "@/components/RecurrenceIntervalField";
import {
  previewOccurrences,
  validateRecurrence,
  type RecurrenceEnd,
} from "@/lib/recurrence-date";
import { cn } from "@/lib/utils";

/**
 * Editor de recorrência compartilhado (Gastos, Receitas, Contas a pagar).
 *
 * Responsável por: intervalo + unidade (via RecurrenceIntervalField),
 * forma de término (ocorrências / data final / sem fim) e prévia.
 * A prévia usa `previewOccurrences`, o MESMO motor que gera os lançamentos.
 */
export type RecurrenceEditorProps = {
  startDate: string;
  rule: RecurrenceIntervalValue;
  onRuleChange: (v: RecurrenceIntervalValue) => void;
  end: RecurrenceEnd;
  onEndChange: (v: RecurrenceEnd) => void;
  className?: string;
  previewLimit?: number;
};

const MODES: RecurrenceEnd["mode"][] = ["count", "until", "forever"];

function formatBR(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function RecurrenceEditor({
  startDate,
  rule,
  onRuleChange,
  end,
  onEndChange,
  className,
  previewLimit = 4,
}: RecurrenceEditorProps) {
  const { t } = useTranslation("common");

  const preview = useMemo(
    () => previewOccurrences(startDate, rule, end, previewLimit),
    [startDate, rule, end, previewLimit],
  );
  const validation = useMemo(
    () => validateRecurrence(startDate, rule, end),
    [startDate, rule, end],
  );

  return (
    <div className={cn("space-y-3", className)}>
      <RecurrenceIntervalField value={rule} onChange={onRuleChange} />

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t("recurrence.end.label")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((mode) => {
            const active = end.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (mode === end.mode) return;
                  if (mode === "count") onEndChange({ mode: "count", count: 12 });
                  else if (mode === "until")
                    onEndChange({
                      mode: "until",
                      until: preview.dates.at(-1) ?? startDate,
                    });
                  else onEndChange({ mode: "forever" });
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-foreground/40 bg-card-elevated"
                    : "border-border text-muted-foreground hover:bg-card-elevated",
                )}
              >
                {t(`recurrence.end.mode.${mode}`)}
              </button>
            );
          })}
        </div>

        {end.mode === "count" && (
          <div>
            <Label className="text-xs text-muted-foreground" htmlFor="recorrencia-ocorrencias">
              {t("recurrence.end.countLabel")}
            </Label>
            <IntegerInput
              id="recorrencia-ocorrencias"
              min={1}
              max={240}
              fallback={12}
              value={end.count}
              onValueChange={(count) => onEndChange({ mode: "count", count })}
              className="mt-1 h-11 w-24 bg-card-elevated text-center"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("recurrence.end.countHint")}
            </p>
          </div>
        )}

        {end.mode === "until" && (
          <div>
            <Label className="text-xs text-muted-foreground" htmlFor="recorrencia-until">
              {t("recurrence.end.untilLabel")}
            </Label>
            <Input
              id="recorrencia-until"
              type="date"
              value={end.until}
              min={startDate}
              onChange={(e) => onEndChange({ mode: "until", until: e.target.value })}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>
        )}

        {end.mode === "forever" && (
          <p className="text-[11px] text-muted-foreground">{t("recurrence.end.foreverHint")}</p>
        )}

        {!validation.ok && (
          <p className="text-[11px] font-medium text-destructive">
            {t(`recurrence.errors.${validation.code}`)}
          </p>
        )}
      </div>

      {validation.ok && preview.dates.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("recurrence.preview.title")}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {preview.dates.map((d) => (
              <li
                key={d}
                className="num rounded-lg bg-card-elevated px-2 py-1 text-[12px] tabular-nums"
              >
                {formatBR(d)}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {preview.openEnded
              ? t("recurrence.preview.continues")
              : preview.remaining && preview.remaining > 0
                ? t("recurrence.preview.more", { count: preview.remaining })
                : t("recurrence.preview.total", { count: preview.dates.length })}
          </p>
        </div>
      )}
    </div>
  );
}
