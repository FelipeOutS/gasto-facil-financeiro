import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * Campo de inteiro com separação clara entre DIGITAÇÃO e VALIDAÇÃO.
 *
 * Problema que este componente resolve (causa raiz do bug de campos numéricos):
 * formulários faziam `Math.max(min, Math.min(max, Number(e.target.value) || fallback))`
 * dentro do `onChange`, ou seja, a cada tecla. Isso:
 *  - impedia o campo de ficar temporariamente vazio (virava 1/12/31 sozinho);
 *  - reescrevia o valor no meio da digitação de números de 2 dígitos.
 *
 * Aqui o rascunho é uma string livre de dígitos; o clamp acontece só no blur.
 * A faixa (`min`/`max`) é sempre informada por quem usa o campo — nunca há
 * regra genérica de "dia do mês" aplicada a meses/parcelas/quantidades.
 */
export type IntegerInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "min" | "max"
> & {
  value: number;
  min: number;
  max: number;
  /** Valor usado quando o campo é deixado vazio no blur. Padrão: `min`. */
  fallback?: number;
  onValueChange: (value: number) => void;
  maxLength?: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function IntegerInput({
  value,
  min,
  max,
  fallback,
  onValueChange,
  onBlur,
  inputMode = "numeric",
  ...rest
}: IntegerInputProps) {
  const [draft, setDraft] = React.useState<string>(String(value ?? ""));
  const focused = React.useRef(false);

  // Sincroniza quando o valor muda de fora (ex.: abrir o form em modo edição).
  React.useEffect(() => {
    if (!focused.current) setDraft(String(value ?? ""));
  }, [value]);

  const digitsMax = String(max).length;

  return (
    <Input
      {...rest}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D+/g, "").slice(0, digitsMax);
        setDraft(digits);
        if (digits === "") return; // estado temporário permitido
        const n = Number(digits);
        // Só propaga quando já é um valor válido; nunca corrige o rascunho.
        if (Number.isFinite(n) && n >= min && n <= max) onValueChange(n);
      }}
      onBlur={(e) => {
        focused.current = false;
        const digits = draft.replace(/\D+/g, "");
        const finalValue = digits === "" ? (fallback ?? min) : clamp(Number(digits), min, max);
        setDraft(String(finalValue));
        if (finalValue !== value) onValueChange(finalValue);
        onBlur?.(e);
      }}
    />
  );
}
