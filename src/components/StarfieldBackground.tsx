import "@/styles/starfield.css";

/**
 * Fundo animado de céu estrelado.
 *
 * Inspiração visual: efeito de estrelas estilo Uiverse.io por amir_6539.
 * Implementação própria, sem bibliotecas externas, com lista fixa de
 * estrelas (sem Math.random / window.* / Date.now) para evitar problemas
 * de hidratação e manter desempenho estável em mobile.
 *
 * Uso: posicione dentro de um container `relative` e o componente cobre
 * 100% via position:absolute inset:0. Não recebe pointer events.
 */
export function StarfieldBackground({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`starfield ${className}`.trim()}>
      <div className="starfield__layer starfield__layer--sm" />
      <div className="starfield__layer starfield__layer--md" />
      <div className="starfield__layer starfield__layer--lg" />
      <div className="starfield__glow" />
    </div>
  );
}

export default StarfieldBackground;
