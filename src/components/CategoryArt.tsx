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
type Art = (p: ArtProps) => React.ReactElement;

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
    <svg viewBox={vb} className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
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
    <path
      d="M8 24 L24 10 L40 24"
      fill="none"
      stroke="#f59e0b"
      strokeWidth="2"
      strokeLinejoin="round"
    />
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
    <path
      d="M6 12 H12 L16 30 H38 L40 18 H16"
      fill="none"
      stroke="#f97316"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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
    <path
      d="M10 18 Q14 14 22 14 T36 18"
      fill="none"
      stroke="#f472b6"
      strokeWidth="3"
      strokeLinecap="round"
    />
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
    <path
      d="M14 12 L20 8 Q24 12 28 8 L34 12 L42 18 L36 22 L34 20 V40 H14 V20 L12 22 L6 18 Z"
      fill="#22d3ee"
      stroke="#0e7490"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M20 8 Q24 14 28 8" fill="none" stroke="#0e7490" strokeWidth="1.5" />
  </Svg>
);

const Alimentacao: Art = ({ className }) => (
  <Svg className={className}>
    {/* prato com talheres */}
    <circle cx="24" cy="24" r="14" fill="#fef08a" stroke="#ca8a04" strokeWidth="1.5" />
    <circle cx="24" cy="24" r="9" fill="#fde047" />
    <path
      d="M8 8 V20 Q8 24 12 24 V40"
      stroke="#ef4444"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M40 8 V40 M36 8 V18 Q36 22 40 22"
      stroke="#10b981"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
    />
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
    <path
      d="M10 22 Q10 16 16 16 H32 Q38 16 38 22 V32 Q38 36 34 36 Q30 36 28 32 H20 Q18 36 14 36 Q10 36 10 32 Z"
      fill="#a855f7"
    />
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
    <path
      d="M14 22 V32 Q14 36 24 36 Q34 36 34 32 V22"
      fill="none"
      stroke="#1e40af"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <line x1="42" y1="18" x2="42" y2="30" stroke="#facc15" strokeWidth="2" />
    <circle cx="42" cy="32" r="2" fill="#facc15" />
  </Svg>
);

const Contas: Art = ({ className }) => (
  <Svg className={className}>
    {/* boleto */}
    <rect
      x="10"
      y="8"
      width="28"
      height="32"
      rx="2"
      fill="#fef3c7"
      stroke="#b45309"
      strokeWidth="1.5"
    />
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
    <circle
      cx="24"
      cy="24"
      r="16"
      fill="none"
      stroke="#f43f5e"
      strokeWidth="2"
      strokeDasharray="4 3"
    />
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
    <path
      d="M16 16 V12 Q16 8 24 8 Q32 8 32 12 V16"
      fill="none"
      stroke="#831843"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M18 24 L22 28 L30 20"
      stroke="#fff"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
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
    <rect
      x="18"
      y="10"
      width="12"
      height="8"
      rx="1.5"
      fill="none"
      stroke="#0f172a"
      strokeWidth="2.5"
    />
    <rect x="22" y="28" width="4" height="6" rx="0.5" fill="#fbbf24" />
  </Svg>
);

const Outros: Art = ({ className }) => (
  <Svg className={className}>
    {/* sparkle/diamond neutro */}
    <path
      d="M24 8 L28 20 L40 24 L28 28 L24 40 L20 28 L8 24 L20 20 Z"
      fill="#cbd5e1"
      stroke="#64748b"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="24" r="3" fill="#f8fafc" />
  </Svg>
);

const Combustivel: Art = ({ className }) => (
  <Svg className={className}>
    {/* bomba de gasolina */}
    <rect x="10" y="10" width="20" height="30" rx="2" fill="#ef4444" />
    <rect x="13" y="14" width="14" height="10" rx="1" fill="#fef2f2" />
    <path
      d="M30 16 L36 22 V36 Q36 40 32 40"
      fill="none"
      stroke="#7f1d1d"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <circle cx="36" cy="20" r="2.5" fill="#fbbf24" />
    <rect x="14" y="28" width="12" height="3" fill="#7f1d1d" rx="0.5" />
  </Svg>
);

const Internet: Art = ({ className }) => (
  <Svg className={className}>
    {/* wifi */}
    <path
      d="M8 22 Q24 8 40 22"
      fill="none"
      stroke="#06b6d4"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    <path
      d="M14 28 Q24 18 34 28"
      fill="none"
      stroke="#22d3ee"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    <path
      d="M18 34 Q24 28 30 34"
      fill="none"
      stroke="#67e8f9"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    <circle cx="24" cy="38" r="2.5" fill="#0e7490" />
  </Svg>
);

const Energia: Art = ({ className }) => (
  <Svg className={className}>
    {/* raio */}
    <path
      d="M26 6 L12 28 H22 L18 42 L36 20 H26 Z"
      fill="#facc15"
      stroke="#a16207"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </Svg>
);

const Agua: Art = ({ className }) => (
  <Svg className={className}>
    {/* gota */}
    <path
      d="M24 6 Q12 22 12 30 Q12 40 24 40 Q36 40 36 30 Q36 22 24 6 Z"
      fill="#38bdf8"
      stroke="#075985"
      strokeWidth="1.5"
    />
    <path
      d="M18 28 Q18 34 24 34"
      fill="none"
      stroke="#bae6fd"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </Svg>
);

const Pix: Art = ({ className }) => (
  <Svg className={className}>
    {/* losango Pix */}
    <path d="M24 6 L42 24 L24 42 L6 24 Z" fill="#0ea5e9" />
    <path d="M16 16 L24 16 L32 24 L24 32 L16 32 L24 24 Z" fill="#ecfeff" />
    <circle cx="24" cy="24" r="3" fill="#0ea5e9" />
  </Svg>
);

const Cartao: Art = ({ className }) => (
  <Svg className={className}>
    {/* cartão de crédito */}
    <rect x="6" y="12" width="36" height="24" rx="3" fill="#1e293b" />
    <rect x="6" y="18" width="36" height="5" fill="#0f172a" />
    <rect x="10" y="28" width="10" height="3" rx="0.5" fill="#fbbf24" />
    <circle cx="34" cy="30" r="2.5" fill="#ef4444" opacity="0.85" />
    <circle cx="38" cy="30" r="2.5" fill="#facc15" opacity="0.85" />
  </Svg>
);

const Transferencia: Art = ({ className }) => (
  <Svg className={className}>
    {/* setas circulares */}
    <path
      d="M10 18 H32 L28 14 M32 18 L28 22"
      fill="none"
      stroke="#22d3ee"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M38 30 H16 L20 26 M16 30 L20 34"
      fill="none"
      stroke="#a78bfa"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const Salario: Art = ({ className }) => (
  <Svg className={className}>
    {/* nota de dinheiro com seta pra cima */}
    <rect x="6" y="16" width="30" height="20" rx="2" fill="#22c55e" />
    <circle cx="21" cy="26" r="5" fill="none" stroke="#064e3b" strokeWidth="1.8" />
    <path
      d="M21 23 V29 M19 25 H23 M19 27 H23"
      stroke="#064e3b"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M38 32 V18 L34 22 M38 18 L42 22"
      fill="none"
      stroke="#16a34a"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const Cofrinho: Art = ({ className }) => (
  <Svg className={className}>
    {/* porquinho */}
    <ellipse cx="24" cy="26" rx="16" ry="12" fill="#f9a8d4" />
    <circle cx="34" cy="22" r="2" fill="#831843" />
    <path d="M14 18 L10 12 L18 16 Z" fill="#f9a8d4" />
    <rect x="20" y="20" width="6" height="2" rx="1" fill="#831843" />
    <rect x="14" y="36" width="3" height="6" fill="#ec4899" />
    <rect x="30" y="36" width="3" height="6" fill="#ec4899" />
    <circle cx="14" cy="24" r="1.2" fill="#831843" />
  </Svg>
);

const Meta: Art = ({ className }) => (
  <Svg className={className}>
    {/* alvo */}
    <circle cx="24" cy="24" r="16" fill="#fde68a" />
    <circle cx="24" cy="24" r="11" fill="#fb923c" />
    <circle cx="24" cy="24" r="6" fill="#ef4444" />
    <circle cx="24" cy="24" r="2" fill="#fef2f2" />
    <path
      d="M30 18 L40 8 M40 8 H34 M40 8 V14"
      stroke="#0f172a"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </Svg>
);

const Uber: Art = ({ className }) => (
  <Svg className={className}>
    {/* carro com pin de rota */}
    <path d="M6 32 V26 L10 20 H32 L36 26 V32 Q36 34 34 34 H8 Q6 34 6 32 Z" fill="#0f172a" />
    <path d="M12 26 L14 22 H28 L30 26 Z" fill="#94a3b8" />
    <circle cx="12" cy="34" r="3" fill="#0f172a" stroke="#cbd5e1" strokeWidth="1.2" />
    <circle cx="30" cy="34" r="3" fill="#0f172a" stroke="#cbd5e1" strokeWidth="1.2" />
    <path d="M40 8 Q44 12 40 18 Q36 12 40 8 Z" fill="#22c55e" />
    <circle cx="40" cy="12" r="1.5" fill="#fff" />
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
  combustivel: Combustivel,
  internet: Internet,
  energia: Energia,
  agua: Agua,
  pix: Pix,
  cartao: Cartao,
  transferencia: Transferencia,
  salario: Salario,
  cofrinho: Cofrinho,
  meta: Meta,
  uber: Uber,
};

/** Retorna o componente de arte para uma categoria, se existir. */
export function getCategoryArt(idOrLegacy?: string): Art | null {
  if (!idOrLegacy) return null;
  return CATEGORY_ART[idOrLegacy] ?? null;
}
