/**
 * MetaCover — Banners com IMAGENS REAIS para Metas financeiras.
 *
 * Substitui os SVGs/vetores do MetaArt no card de meta. Cada chave mapeia
 * para uma URL pública (Unsplash) já dimensionada para uso como cover
 * (1200x600, qualidade média), com fallback elegante.
 *
 * Auto-match: `getMetaCoverKey(nome, descricao)` retorna a melhor chave por
 * palavras-chave. Sempre cai em "objetivo" como fallback bonito.
 *
 * NOTA: O tipo `MetaCoverKey` é um superset compatível com `MetaArtKey`
 * usado anteriormente (mesmas chaves), de forma que metas com `imagemKey`
 * persistido continuam válidas.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/** Prefixo para chaves customizadas (imagens enviadas pelo usuário ao bucket). */
export const CUSTOM_COVER_PREFIX = "custom:";

/** Verifica se a chave aponta para upload de usuário. */
export function isCustomCoverKey(key?: string | null): boolean {
  return typeof key === "string" && key.startsWith(CUSTOM_COVER_PREFIX);
}

/** Extrai o path do bucket a partir da chave customizada. */
export function getCustomCoverPath(key?: string | null): string | null {
  if (!isCustomCoverKey(key)) return null;
  return (key as string).slice(CUSTOM_COVER_PREFIX.length);
}

/** Cache em memória para signed URLs (evita re-fetch a cada render). */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function getCustomCoverSignedUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from("metas-covers")
    .createSignedUrl(path, 60 * 60); // 1h
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60_000 });
  return data.signedUrl;
}

export type MetaCoverKey =
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

/**
 * URLs Unsplash com parâmetros otimizados para cover (auto format, ~1200px,
 * crop centralizado). Source IDs estáveis (não usar /random).
 */
const UNSPLASH = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=70`;

export const META_COVER_URL: Record<MetaCoverKey, string> = {
  // Torre Eiffel / Paris
  viagem_internacional: UNSPLASH("photo-1502602898657-3e91760cbb34"),
  // Cristo Redentor / Rio
  viagem_nacional: UNSPLASH("photo-1483729558449-99ef09a8c325"),
  // Mala / aeroporto / passaporte
  viagem: UNSPLASH("photo-1488646953014-85cb44e25828"),
  // Setup gamer com RGB
  gamer: UNSPLASH("photo-1542751371-adc38448a05e"),
  // Mão segurando smartphone
  celular: UNSPLASH("photo-1512941937669-90a1b58e7e9c"),
  // Notebook moderno em mesa
  computador: UNSPLASH("photo-1517336714731-489689fd1ca8"),
  // Apartamento / fachada moderna
  casa: UNSPLASH("photo-1568605114967-8130f3a36994"),
  // Carro
  carro: UNSPLASH("photo-1503376780353-7e6692767b70"),
  // Moto
  moto: UNSPLASH("photo-1558981403-c5f9899a28bc"),
  // Casamento / alianças
  casamento: UNSPLASH("photo-1519741497674-611481863552"),
  // Estudos / livros / notebook
  educacao: UNSPLASH("photo-1513258496099-48168024aec0"),
  // Saúde / estetoscópio
  saude: UNSPLASH("photo-1505751172876-fa1923c5c528"),
  // Investimento / gráficos / dinheiro
  investimento: UNSPLASH("photo-1559526324-4b87b5e36e44"),
  // Fallback: planejamento / conquista
  objetivo: UNSPLASH("photo-1454165804606-c3d57bc86b40"),
};

export const META_COVER_OPTIONS: Array<{ key: MetaCoverKey; label: string }> = [
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

/* --------------------- Auto-match por palavra-chave --------------------- */

const KEYWORDS: Array<{ key: MetaCoverKey; terms: string[] }> = [
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
    terms: [
      "casamento",
      "noivado",
      "cerimônia",
      "cerimonia",
      "festa",
      "lua de mel",
      "aliança",
      "alianca",
    ],
  },
  {
    key: "educacao",
    terms: [
      "curso",
      "faculdade",
      "estudos",
      "estudar",
      "educação",
      "educacao",
      "graduação",
      "graduacao",
      "pós",
      " pos ",
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
  return ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")} `;
}

/** Retorna a melhor chave de cover para o nome+descrição da meta. */
export function getMetaCoverKey(nome: string, descricao?: string): MetaCoverKey {
  const text = normalize(`${nome ?? ""} ${descricao ?? ""}`);
  for (const { key, terms } of KEYWORDS) {
    if (terms.some((t) => text.includes(normalize(t).trim()))) return key;
  }
  return "objetivo";
}

/** URL pública da imagem da meta (com fallback). */
export function metaCoverUrl(key?: string | null): string {
  const k = (key as MetaCoverKey) ?? "objetivo";
  return META_COVER_URL[k] ?? META_COVER_URL.objetivo;
}

/** Componente cover: img real + overlay para legibilidade do texto. */
export function MetaCover({
  coverKey,
  alt,
  className,
}: {
  coverKey?: MetaCoverKey | string | null;
  alt?: string;
  className?: string;
}) {
  const isCustom = isCustomCoverKey(coverKey);
  const [customUrl, setCustomUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (isCustom) {
      const path = getCustomCoverPath(coverKey);
      if (path) {
        getCustomCoverSignedUrl(path).then((u) => {
          if (!cancelled) setCustomUrl(u);
        });
      }
    } else {
      setCustomUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [coverKey, isCustom]);

  const url = isCustom ? (customUrl ?? "") : metaCoverUrl(coverKey);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
      {url && (
        <img
          src={url}
          alt={alt ?? "Imagem da meta"}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={(e) => {
            const fb = META_COVER_URL.objetivo;
            if ((e.currentTarget as HTMLImageElement).src !== fb) {
              (e.currentTarget as HTMLImageElement).src = fb;
            }
          }}
        />
      )}
    </div>
  );
}
