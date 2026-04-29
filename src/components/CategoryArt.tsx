/**
 * CategoryArt — SVGs ilustrados premium por categoria.
 *
 * Cada arte é um SVG inline pequeno (sem dependência externa) com paleta
 * própria, otimizado para fundos escuros e claros. Usado dentro do badge
 * gradiente do `CategoryIcon` quando o `id` da categoria casa com uma das
 * artes abaixo. Categorias sem arte caem no ícone Lucide padrão.
 */

import * as React from "react";

type ArtProps = { className?: string };
type Art = (p: ArtProps) => JSX.Element;

/* ---------------------------------------------------------------- */
/* Helpers                                                          */
/* ---------------------------------------------------------------- */

function Svg({
  children,
  className,
  vb = "0 0 48 48",
}: {
  children: React.ReactNode;
  className?: string;
  vb?: string;
}) {
  return (
    <svg
      viewBox={vb}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Artes (mantidas pequenas, geométricas, com dois tons)            */
/* ---------------------------------------------------------------- */

const Aluguel: Art = ({ className }) => (
  <Svg className={className}>
    {/* casa com chave */}
    <path d="M8 24 L24 10 L40 24 V40 H8 Z" fill="#fbbf24" />
    <path d="M8 24 L24 10 L40 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" />
    <rect x="20" y="26" width="8" height="14" fill="#78350f" rx="1" />
    <circle cx="34" cy="20" r="3" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" />
    <rect x="34" y="20" width="6" height="1.5" fill="#92400e" />
  </Svg>
);

const Moradia: Art = ({ className }) => (
  <Svg className={className}>
    {/* prédio */}
    <rect x="10" y="12" width="28" height="30" fill="#60a5fa" rx="2" />
    <rect x="14" y="16" width="5" height="5" fill="#dbeafe" rx="0.5" />
    <rect x="22" y="16" width="5" height="5" fill="#dbeafe" rx="0.5" />
    <rect x="30" y="16" width="5" height="5" fill="#dbeafe" rx="0.5" />
    <rect x="14" y="24" width="5" height="5" fill="#dbeafe" rx="0.5" />
    <rect x="22" y="24" width="5" height="5" fill="#fef08a" rx="0.5" />
    <rect x="30" y="24" width="5" height="5" fill="#dbeafe" rx="0.5" />
    <rect x="20" y="32" width="8" height="10" fill="#1e3a8a" rx="0.5" />
  </Svg>
);

const Mercado: Art = ({ className }) => (
  <Svg className={className}>
    {/* carrinho de mercado */}
    <path d="M6 12 H12 L16 30 H38 L40 18 H16" fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="18" cy="38" r="3.5" fill="#fb923c" stroke="#7c2d12" strokeWidth="1.5" />
    <circle cx="34" cy="38" r="3.5" fill="#fb923c" stroke="#7c2d12" strokeWidth="1.5" />
    <rect x="20" y="20" width="4" height="6" fill="#f87171" rx="0.5" />
    <rect x="26" y="20" width="4" height="6" fill="#4ade80" rx="0.5" />
    <rect x="32" y="20" width="4" height="6" fill="#facc15" rx="0.5" />
  </Svg>
);

const Besteiras: Art = ({ className }) => (
  <Svg className={className}>
    {/* donut */}
    <circle cx="24" cy="24" r="16" fill="#fbcfe8" />
    <circle cx="24" cy="24" r="6" fill="#1f2937" />
    <circle cx="14" cy="20" r="1.2" fill="#ef4444" />
    <circle cx="34" cy="20" r="1.2" fill="#facc15" />
    <circle cx="18" cy="32" r="1.2" fill="#22d3ee" />
    <circle cx="32" cy="32" r="1.2" fill="#a78bfa" />
    <path d="M10 18 Q14 14 22 14 T36 18" fill="none" stroke="#f472b6" strokeWidth="3" strokeLinecap="round" />
  </Svg>
);

const Cabeleireiro: Art = ({ className }) => (
  <Svg className={className}>
    {/* tesoura */}
    <circle cx="14" cy="34" r="5" fill="none" stroke="#a78bfa" strokeWidth="2.5" />
    <circle cx="34" cy="34" r="5" fill="none" stroke="#a78bfa" strokeWidth="2.5" />
    <path d="M18 30 L36 12" stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round" />
    <path d="M30 30 L12 12" stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round" />
    <circle cx="24" cy="22" r="2" fill="#7c3aed" />
  </Svg>
);

const Roupas: Art = ({ className }) => (
  <Svg className={className}>
    {/* camiseta */}
    <path d="M14 12 L20 8 Q24 12 28 8 L34 12 L42 18 L36 22 L34 20 V40 H14 V20 L12 22 L6 18 Z"
      fill="#22d3ee" stroke="#0e7490" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M20 8 Q24 14 28 8" fill="none" stroke="#0e7490" strokeWidth="1.5" />
  </Svg>
);

const Alimentacao: Art = ({ className }) => (
  <Svg className={className}>
    {/* prato com talheres */}
    <circle cx="24" cy="24" r="14" fill="#fef08a" stroke="#ca8a04" strokeWidth="1.5" />
    <circle cx="24" cy="24" r="9" fill="#fde047" />
    <path d="M8 8 V20 Q8 24 12 24 V40" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    <path d="M40 8 V40 M36 8 V18 Q36 22 40 22" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </Svg>
);

const Transporte: Art = ({ className }) => (
  <Svg className={className}>
    {/* carro */}
    <path d="M6 30 V24 L10 18 H38 L42 24 V30 Q42 32 40 32 H8 Q6 32 6 30 Z" fill="#3b82f6" />
    <path d="M12 24 L14 20 H34 L36 24 Z" fill="#dbeafe" />
    <circle cx="14" cy="32" r="4" fill="#1f2937" stroke="#94a3b8" strokeWidth="1.5" />
    <circle cx="34" cy="32" r="4" fill="#1f2937" stroke="#94a3b8" strokeWidth="1.5" />
    <circle cx="14" cy="32" r="1.5" fill="#94a3b8" />
    <circle cx="34" cy="32" r="1.5" fill="#94a3b8" />
  </Svg>
);

const Casa: Art = ({ className }) => (
  <Svg className={className}>
    {/* sofá */}
    <rect x="6" y="22" width="36" height="14" rx="3" fill="#f87171" />
    <rect x="10" y="16" width="10" height="10" rx="2" fill="#fca5a5" />
    <rect x="28" y="16" width="10" height="10" rx="2" fill="#fca5a5" />
    <rect x="8" y="34" width="4" height="6" fill="#7f1d1d" />
    <rect x="36" y="34" width="4" height="6" fill="#7f1d1d" />
  </Svg>
);

const Saude: Art = ({ className }) => (
  <Svg className={className}>
    {/* cruz médica + coração */}
    <circle cx="24" cy="24" r="16" fill="#fecaca" />
    <path d="M20 12 H28 V20 H36 V28 H28 V36 H20 V28 H12 V20 H20 Z" fill="#ef4444" />
  </Svg>
);

const Lazer: Art = ({ className }) => (
  <Svg className={className}>
    {/* controle de videogame */}
    <path d="M10 22 Q10 16 16 16 H32 Q38 16 38 22 V32 Q38 36 34 36 Q30 36 28 32 H20 Q18 36 14 36 Q10 36 10 32 Z"
      fill="#a855f7" />
    <circle cx="18" cy="26" r="2.5" fill="#1f2937" />
    <circle cx="32" cy="24" r="1.5" fill="#fde047" />
    <circle cx="36" cy="28" r="1.5" fill="#22d3ee" />
    <circle cx="32" cy="32" r="1.5" fill="#f472b6" />
    <circle cx="28" cy="28" r="1.5" fill="#4ade80" />
  </Svg>
);

const Educacao: Art = ({ className }) => (
  <Svg className={className}>
    {/* chapéu de formatura + livro */}
    <path d="M6 18 L24 10 L42 18 L24 26 Z" fill="#1e40af" />
    <path d="M14 22 V32 Q14 36 24 36 Q34 36 34 32 V22" fill="none" stroke="#1e40af" strokeWidth="2.5" strokeLinejoin="round" />
    <line x1="42" y1="18" x2="42" y2="30" stroke="#facc15" strokeWidth="2" />
    <circle cx="42" cy="32" r="2" fill="#facc15" />
  </Svg>
);

const Contas: Art = ({ className }) => (
  <Svg className={className}>
    {/* boleto */}
    <rect x="10" y="8" width="28" height="32" rx="2" fill="#fef3c7" stroke="#b45309" strokeWidth="1.5" />
    <rect x="14" y="14" width="20" height="2" fill="#b45309" />
    <rect x="14" y="20" width="14" height="1.5" fill="#92400e" />
    <rect x="14" y="24" width="20" height="1.5" fill="#92400e" />
    <rect x="14" y="32" width="3" height="6" fill="#1f2937" />
    <rect x="18" y="32" width="1.5" height="6" fill="#1f2937" />
    <rect x="20.5" y="32" width="3" height="6" fill="#1f2937" />
    <rect x="25" y="32" width="1.5" height="6" fill="#1f2937" />
    <rect x="27.5" y="32" width="2.5" height="6" fill="#1f2937" />
    <rect x="31" y="32" width="3" height="6" fill="#1f2937" />
  </Svg>
);

const Assinaturas: Art = ({ className }) => (
  <Svg className={className}>
    {/* play em badge recorrente */}
    <circle cx="24" cy="24" r="16" fill="#1f2937" />
    <path d="M20 16 L34 24 L20 32 Z" fill="#f43f5e" />
    <circle cx="24" cy="24" r="16" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 3" />
  </Svg>
);

const Farmacia: Art = ({ className }) => (
  <Svg className={className}>
    {/* cápsula */}
    <rect x="8" y="20" width="32" height="10" rx="5" fill="#ef4444" />
    <rect x="8" y="20" width="16" height="10" rx="5" fill="#fef3c7" />
    <line x1="24" y1="20" x2="24" y2="30" stroke="#7f1d1d" strokeWidth="1.5" />
    <circle cx="14" cy="25" r="1.2" fill="#fbbf24" />
    <circle cx="20" cy="23" r="1" fill="#fbbf24" />
  </Svg>
);

const Online: Art = ({ className }) => (
  <Svg className={className}>
    {/* sacola de compras */}
    <path d="M10 16 H38 L36 40 H12 Z" fill="#ec4899" />
    <path d="M16 16 V12 Q16 8 24 8 Q32 8 32 12 V16" fill="none" stroke="#831843" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M18 24 L22 28 L30 20" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

const Presentes: Art = ({ className }) => (
  <Svg className={className}>
    {/* presente com laço */}
    <rect x="8" y="20" width="32" height="20" rx="2" fill="#f43f5e" />
    <rect x="8" y="20" width="32" height="6" fill="#fb7185" />
    <rect x="22" y="20" width="4" height="20" fill="#fde047" />
    <path d="M22 20 Q14 14 18 10 Q24 12 24 20" fill="#facc15" />
    <path d="M26 20 Q34 14 30 10 Q24 12 24 20" fill="#facc15" />
  </Svg>
);

const Pet: Art = ({ className }) => (
  <Svg className={className}>
    {/* patinha */}
    <ellipse cx="24" cy="32" rx="10" ry="8" fill="#a16207" />
    <circle cx="14" cy="20" r="4" fill="#a16207" />
    <circle cx="22" cy="14" r="4" fill="#a16207" />
    <circle cx="32" cy="14" r="4" fill="#a16207" />
    <circle cx="40" cy="22" r="4" fill="#a16207" />
  </Svg>
);

const Trabalho: Art = ({ className }) => (
  <Svg className={className}>
    {/* maleta */}
    <rect x="6" y="16" width="36" height="24" rx="2" fill="#0f172a" />
    <rect x="6" y="22" width="36" height="3" fill="#fbbf24" />
    <rect x="18" y="10" width="12" height="8" rx="1.5" fill="none" stroke="#0f172a" strokeWidth="2.5" />
    <rect x="22" y="28" width="4" height="6" rx="0.5" fill="#fbbf24" />
  </Svg>
);

const Outros: Art = ({ className }) => (
  <Svg className={className}>
    {/* três pontos com gradiente */}
    <circle cx="14" cy="24" r="4" fill="#94a3b8" />
    <circle cx="24" cy="24" r="4" fill="#cbd5e1" />
    <circle cx="34" cy="24" r="4" fill="#94a3b8" />
  </Svg>
);

/* ---------------------------------------------------------------- */
/* Mapa público                                                     */
/* ---------------------------------------------------------------- */

export const CATEGORY_ART: Record<string, Art> = {
  aluguel: Aluguel,
  moradia: Moradia,
  mercado: Mercado,
  besteiras: Besteiras,
  cabeleireiro: Cabeleireiro,
  roupas: Roupas,
  alimentacao: Alimentacao,
  transporte: Transporte,
  casa: Casa,
  saude: Saude,
  lazer: Lazer,
  educacao: Educacao,
  contas: Contas,
  assinaturas: Assinaturas,
  farmacia: Farmacia,
  online: Online,
  presentes: Presentes,
  pet: Pet,
  trabalho: Trabalho,
  outros: Outros,
};

/** Retorna o componente de arte para uma categoria, se existir. */
export function getCategoryArt(idOrLegacy?: string): Art | null {
  if (!idOrLegacy) return null;
  return CATEGORY_ART[idOrLegacy] ?? null;
}
