/**
 * MetaArt — Ilustrações vetoriais para Metas financeiras.
 *
 * Cada ilustração é um SVG inline construído com formas geométricas e
 * gradientes, otimizado para servir como cover do card de meta. Composições
 * são "16:9-ish" (viewBox 320x180) para encaixar bem no banner.
 *
 * Auto-match: dado o nome da meta, `getMetaArtKey` retorna a chave da
 * ilustração mais apropriada com base em palavras-chave. Sempre há um
 * fallback elegante (`objetivo`) para nunca deixar o card sem identidade.
 */

import * as React from "react";

export type MetaArtKey =
  | "viagem_internacional"
  | "viagem_nacional"
  | "viagem"
  | "gamer"
  | "celular"
  | "computador"
  | "casa"
  | "carro"
  | "moto"
  | "casamento"
  | "educacao"
  | "saude"
  | "investimento"
  | "objetivo";

type ArtProps = { className?: string };
type Art = (p: ArtProps) => React.ReactElement;

const VB = "0 0 320 180";

function Frame({
  children,
  bg,
  className,
}: {
  children: React.ReactNode;
  bg: [string, string];
  className?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg
      viewBox={VB}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={bg[0]} />
          <stop offset="100%" stopColor={bg[1]} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#bg-${id})`} />
      {children}
    </svg>
  );
}

/* ------------------------- Viagem internacional ------------------------- */
const ViagemInternacional: Art = ({ className }) => (
  <Frame bg={["#1e3a8a", "#0ea5e9"]} className={className}>
    {/* nuvens */}
    <ellipse cx="50" cy="60" rx="28" ry="9" fill="#ffffff" opacity="0.25" />
    <ellipse cx="260" cy="50" rx="34" ry="10" fill="#ffffff" opacity="0.22" />
    {/* Torre Eiffel estilizada */}
    <path
      d="M160 30 L172 70 L186 130 L196 160 H124 L134 130 L148 70 Z"
      fill="#0f172a"
      opacity="0.85"
    />
    <path d="M148 70 H172 M138 100 H182 M128 130 H192" stroke="#fbbf24" strokeWidth="2" />
    {/* avião */}
    <path d="M40 130 L80 120 L100 110 L120 118 L100 132 L80 138 Z" fill="#ffffff" />
    <path d="M88 122 L72 100 L80 100 L102 118 Z" fill="#e2e8f0" />
    {/* sol */}
    <circle cx="270" cy="40" r="14" fill="#fde047" />
  </Frame>
);

/* --------------------------- Viagem nacional --------------------------- */
const ViagemNacional: Art = ({ className }) => (
  <Frame bg={["#0e7490", "#22d3ee"]} className={className}>
    {/* Cristo Redentor estilizado */}
    <path d="M170 70 V120 M150 90 H190" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
    <circle cx="170" cy="64" r="6" fill="#f8fafc" />
    <path d="M120 130 Q170 100 220 130 L240 160 H100 Z" fill="#065f46" />
    {/* praia / ondas */}
    <path d="M0 150 Q80 140 160 150 T 320 150 V180 H0 Z" fill="#0e7490" />
    <path d="M0 165 Q80 158 160 165 T 320 165" stroke="#22d3ee" strokeWidth="2" fill="none" />
    {/* sol */}
    <circle cx="60" cy="50" r="18" fill="#fbbf24" />
  </Frame>
);

/* ----------------------------- Viagem genérica ----------------------------- */
const Viagem: Art = ({ className }) => (
  <Frame bg={["#0f766e", "#fbbf24"]} className={className}>
    {/* mala */}
    <rect x="110" y="80" width="100" height="70" rx="8" fill="#7c2d12" />
    <rect x="110" y="100" width="100" height="6" fill="#fde68a" />
    <rect
      x="150"
      y="60"
      width="20"
      height="20"
      rx="3"
      fill="none"
      stroke="#7c2d12"
      strokeWidth="4"
    />
    <circle cx="130" cy="150" r="6" fill="#1f2937" />
    <circle cx="190" cy="150" r="6" fill="#1f2937" />
    {/* sol */}
    <circle cx="260" cy="40" r="16" fill="#fde047" />
  </Frame>
);

/* ---------------------------------- Gamer --------------------------------- */
const Gamer: Art = ({ className }) => (
  <Frame bg={["#0b1220", "#7c3aed"]} className={className}>
    {/* monitor */}
    <rect
      x="80"
      y="40"
      width="160"
      height="90"
      rx="6"
      fill="#0f172a"
      stroke="#a78bfa"
      strokeWidth="2"
    />
    <rect x="90" y="50" width="140" height="70" rx="3" fill="#1e1b4b" />
    <path d="M110 110 L150 70 L170 90 L210 60" stroke="#22d3ee" strokeWidth="3" fill="none" />
    <rect x="150" y="130" width="20" height="10" fill="#a78bfa" />
    <rect x="120" y="140" width="80" height="6" rx="3" fill="#a78bfa" />
    {/* RGB ambient */}
    <circle cx="40" cy="150" r="10" fill="#22d3ee" opacity="0.6" />
    <circle cx="280" cy="150" r="10" fill="#f472b6" opacity="0.6" />
  </Frame>
);

/* --------------------------------- Celular -------------------------------- */
const Celular: Art = ({ className }) => (
  <Frame bg={["#1e293b", "#0ea5e9"]} className={className}>
    <rect
      x="125"
      y="30"
      width="70"
      height="120"
      rx="12"
      fill="#0f172a"
      stroke="#38bdf8"
      strokeWidth="2"
    />
    <rect x="132" y="42" width="56" height="92" rx="3" fill="#0ea5e9" />
    <circle cx="160" cy="142" r="3" fill="#94a3b8" />
    <path
      d="M145 70 L155 80 L175 60"
      stroke="#fff"
      strokeWidth="3"
      fill="none"
      strokeLinecap="round"
    />
    <rect x="142" y="92" width="36" height="6" rx="2" fill="#fff" opacity="0.7" />
    <rect x="142" y="104" width="26" height="6" rx="2" fill="#fff" opacity="0.5" />
  </Frame>
);

/* ------------------------------- Computador ------------------------------- */
const Computador: Art = ({ className }) => (
  <Frame bg={["#0f172a", "#475569"]} className={className}>
    <path d="M70 130 L100 50 H220 L250 130 Z" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
    <rect x="108" y="58" width="104" height="62" rx="3" fill="#1e293b" />
    <path d="M120 110 L145 80 L165 95 L195 70" stroke="#22d3ee" strokeWidth="3" fill="none" />
    <rect x="60" y="130" width="200" height="10" rx="3" fill="#475569" />
    <circle cx="160" cy="135" r="3" fill="#94a3b8" />
  </Frame>
);

/* ---------------------------------- Casa ---------------------------------- */
const Casa: Art = ({ className }) => (
  <Frame bg={["#7c2d12", "#fbbf24"]} className={className}>
    {/* sol */}
    <circle cx="270" cy="40" r="18" fill="#fde047" />
    {/* casa */}
    <path d="M70 100 L160 40 L250 100 V160 H70 Z" fill="#fef3c7" />
    <path d="M70 100 L160 40 L250 100" fill="#dc2626" />
    <rect x="140" y="115" width="40" height="45" fill="#7c2d12" />
    <rect x="90" y="115" width="30" height="25" fill="#fbbf24" stroke="#7c2d12" strokeWidth="2" />
    <rect x="200" y="115" width="30" height="25" fill="#fbbf24" stroke="#7c2d12" strokeWidth="2" />
    <circle cx="170" cy="138" r="2" fill="#fbbf24" />
  </Frame>
);

/* ---------------------------------- Carro --------------------------------- */
const Carro: Art = ({ className }) => (
  <Frame bg={["#0f172a", "#ef4444"]} className={className}>
    <path
      d="M40 120 V100 L80 70 H230 L260 100 H280 V125 Q280 135 270 135 H50 Q40 135 40 125 Z"
      fill="#dc2626"
    />
    <path d="M90 75 L100 95 H220 L210 75 Z" fill="#fde68a" opacity="0.85" />
    <line x1="160" y1="78" x2="160" y2="93" stroke="#dc2626" strokeWidth="3" />
    <circle cx="90" cy="135" r="14" fill="#0f172a" stroke="#94a3b8" strokeWidth="3" />
    <circle cx="230" cy="135" r="14" fill="#0f172a" stroke="#94a3b8" strokeWidth="3" />
    <circle cx="90" cy="135" r="5" fill="#94a3b8" />
    <circle cx="230" cy="135" r="5" fill="#94a3b8" />
  </Frame>
);

/* ---------------------------------- Moto ---------------------------------- */
const Moto: Art = ({ className }) => (
  <Frame bg={["#0b1220", "#0ea5e9"]} className={className}>
    <circle cx="80" cy="130" r="22" fill="none" stroke="#f8fafc" strokeWidth="5" />
    <circle cx="240" cy="130" r="22" fill="none" stroke="#f8fafc" strokeWidth="5" />
    <path
      d="M80 130 L130 100 L180 100 L210 70 L240 130"
      stroke="#0ea5e9"
      strokeWidth="6"
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M170 100 L200 100 L210 88"
      stroke="#0ea5e9"
      strokeWidth="6"
      fill="none"
      strokeLinecap="round"
    />
    <circle cx="210" cy="70" r="6" fill="#fbbf24" />
  </Frame>
);

/* -------------------------------- Casamento ------------------------------- */
const Casamento: Art = ({ className }) => (
  <Frame bg={["#831843", "#fb7185"]} className={className}>
    {/* alianças */}
    <circle cx="135" cy="100" r="34" fill="none" stroke="#fde047" strokeWidth="6" />
    <circle cx="185" cy="100" r="34" fill="none" stroke="#fef3c7" strokeWidth="6" />
    {/* coração */}
    <path
      d="M160 60 C150 45 130 50 130 65 C130 78 160 92 160 92 C160 92 190 78 190 65 C190 50 170 45 160 60 Z"
      fill="#f43f5e"
    />
    {/* sparkles */}
    <circle cx="60" cy="50" r="2.5" fill="#fde047" />
    <circle cx="270" cy="40" r="2.5" fill="#fde047" />
    <circle cx="40" cy="140" r="2" fill="#fde047" />
    <circle cx="290" cy="140" r="2" fill="#fde047" />
  </Frame>
);

/* -------------------------------- Educação -------------------------------- */
const Educacao: Art = ({ className }) => (
  <Frame bg={["#1e3a8a", "#60a5fa"]} className={className}>
    {/* livros */}
    <rect x="60" y="80" width="40" height="80" fill="#dc2626" />
    <rect x="100" y="70" width="40" height="90" fill="#facc15" />
    <rect x="140" y="90" width="40" height="70" fill="#10b981" />
    {/* chapéu de formatura */}
    <path d="M160 30 L240 60 L160 90 L100 60 Z" fill="#0f172a" />
    <rect x="220" y="60" width="3" height="40" fill="#facc15" />
    <circle cx="222" cy="105" r="5" fill="#facc15" />
  </Frame>
);

/* ---------------------------------- Saúde --------------------------------- */
const Saude: Art = ({ className }) => (
  <Frame bg={["#7f1d1d", "#fb7185"]} className={className}>
    <circle cx="160" cy="90" r="55" fill="#fee2e2" />
    <path d="M150 60 H170 V80 H190 V100 H170 V120 H150 V100 H130 V80 H150 Z" fill="#ef4444" />
    <path
      d="M40 150 Q80 130 120 150 T 200 150 T 280 150"
      stroke="#fee2e2"
      strokeWidth="3"
      fill="none"
    />
  </Frame>
);

/* ------------------------------ Investimento ------------------------------ */
const Investimento: Art = ({ className }) => (
  <Frame bg={["#064e3b", "#34d399"]} className={className}>
    {/* gráfico subindo */}
    <path
      d="M30 140 L80 110 L120 125 L170 70 L220 90 L290 40"
      stroke="#fef3c7"
      strokeWidth="5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="80" cy="110" r="5" fill="#fde047" />
    <circle cx="170" cy="70" r="5" fill="#fde047" />
    <circle cx="290" cy="40" r="6" fill="#fde047" />
    {/* moedas */}
    <circle cx="60" cy="150" r="14" fill="#fbbf24" stroke="#92400e" strokeWidth="2" />
    <circle cx="90" cy="155" r="11" fill="#fbbf24" stroke="#92400e" strokeWidth="2" />
  </Frame>
);

/* ------------------------------- Fallback objetivo ------------------------------- */
const Objetivo: Art = ({ className }) => (
  <Frame bg={["#1e1b4b", "#a78bfa"]} className={className}>
    {/* alvo */}
    <circle cx="160" cy="90" r="60" fill="#312e81" />
    <circle cx="160" cy="90" r="42" fill="#a78bfa" />
    <circle cx="160" cy="90" r="24" fill="#fde047" />
    <circle cx="160" cy="90" r="8" fill="#dc2626" />
    {/* flecha */}
    <path d="M40 160 L160 90" stroke="#fef3c7" strokeWidth="4" strokeLinecap="round" />
    <path d="M150 84 L160 90 L156 100 Z" fill="#fef3c7" />
    {/* sparkles */}
    <circle cx="240" cy="40" r="3" fill="#fde047" />
    <circle cx="270" cy="60" r="2" fill="#fde047" />
    <circle cx="60" cy="50" r="2" fill="#fde047" />
  </Frame>
);

/* ------------------------------- Registry ------------------------------- */

export const META_ART: Record<MetaArtKey, Art> = {
  viagem_internacional: ViagemInternacional,
  viagem_nacional: ViagemNacional,
  viagem: Viagem,
  gamer: Gamer,
  celular: Celular,
  computador: Computador,
  casa: Casa,
  carro: Carro,
  moto: Moto,
  casamento: Casamento,
  educacao: Educacao,
  saude: Saude,
  investimento: Investimento,
  objetivo: Objetivo,
};

export const META_ART_OPTIONS: Array<{ key: MetaArtKey; label: string }> = [
  { key: "viagem_internacional", label: "Viagem internacional" },
  { key: "viagem_nacional", label: "Viagem pelo Brasil" },
  { key: "viagem", label: "Viagem (genérica)" },
  { key: "casa", label: "Casa / apartamento" },
  { key: "carro", label: "Carro" },
  { key: "moto", label: "Moto" },
  { key: "gamer", label: "Setup gamer" },
  { key: "computador", label: "Computador / notebook" },
  { key: "celular", label: "Celular" },
  { key: "casamento", label: "Casamento" },
  { key: "educacao", label: "Educação / curso" },
  { key: "saude", label: "Saúde" },
  { key: "investimento", label: "Investimento / reserva" },
  { key: "objetivo", label: "Objetivo (genérico)" },
];

/* ------------------------ Auto-match por palavra-chave ------------------------ */

const KEYWORDS: Array<{ key: MetaArtKey; terms: string[] }> = [
  {
    key: "viagem_internacional",
    terms: [
      "internacional",
      "exterior",
      "intercâmbio",
      "intercambio",
      "paris",
      "frança",
      "franca",
      "europa",
      "italia",
      "itália",
      "japão",
      "japao",
      "disney",
      "estados unidos",
      "eua",
      "usa",
      "miami",
      "orlando",
      "londres",
      "espanha",
    ],
  },
  {
    key: "viagem_nacional",
    terms: [
      "rio de janeiro",
      "rj ",
      "bahia",
      "nordeste",
      "brasil",
      "cristo",
      "praia",
      "fernando de noronha",
      "noronha",
      "fortaleza",
      "salvador",
      "porto seguro",
      "natal",
      "maceio",
      "maceió",
    ],
  },
  { key: "viagem", terms: ["viagem", "viajar", "trip", "férias", "ferias", "passeio", "turismo"] },
  {
    key: "gamer",
    terms: [
      "gamer",
      "setup",
      "pc gamer",
      "videogame",
      "console",
      "playstation",
      "ps5",
      "ps4",
      "xbox",
      "nintendo",
    ],
  },
  { key: "celular", terms: ["celular", "iphone", "smartphone", "samsung", "galaxy", "pixel"] },
  { key: "computador", terms: ["computador", "notebook", "macbook", "imac", " pc"] },
  {
    key: "casa",
    terms: [
      "casa",
      "apartamento",
      "apê",
      "ape",
      "moradia",
      "imóvel",
      "imovel",
      "entrada",
      "financiamento",
    ],
  },
  {
    key: "carro",
    terms: ["carro", "automóvel", "automovel", "veículo", "veiculo", "civic", "corolla", "hb20"],
  },
  { key: "moto", terms: ["moto", "motocicleta", "scooter"] },
  {
    key: "casamento",
    terms: ["casamento", "noivado", "cerimônia", "cerimonia", "festa", "lua de mel"],
  },
  {
    key: "educacao",
    terms: [
      "curso",
      "faculdade",
      "estudos",
      "educação",
      "educacao",
      "graduação",
      "graduacao",
      "pós",
      "pos",
      "mestrado",
      "mba",
    ],
  },
  {
    key: "saude",
    terms: [
      "saúde",
      "saude",
      "dentista",
      "tratamento",
      "cirurgia",
      "médico",
      "medico",
      "ortodontia",
    ],
  },
  {
    key: "investimento",
    terms: [
      "reserva",
      "emergência",
      "emergencia",
      "investimento",
      "aposentadoria",
      "guardar",
      "poupar",
    ],
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Retorna a melhor chave de arte para o nome+descrição da meta. */
export function getMetaArtKey(nome: string, descricao?: string): MetaArtKey {
  const text = normalize(`${nome ?? ""} ${descricao ?? ""}`);
  for (const { key, terms } of KEYWORDS) {
    if (terms.some((t) => text.includes(normalize(t)))) return key;
  }
  return "objetivo";
}

/** Componente público para renderizar a arte de uma meta. */
export function MetaArt({ artKey, className }: { artKey?: MetaArtKey | null; className?: string }) {
  const Art = META_ART[(artKey ?? "objetivo") as MetaArtKey] ?? META_ART.objetivo;
  return <Art className={className} />;
}
