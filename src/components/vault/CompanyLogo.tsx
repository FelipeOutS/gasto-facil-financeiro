import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  colorFor,
  extractDomain,
  getCompanyLogoCandidates,
  initialOf,
} from "@/lib/vault/company-logo";

type Props = {
  /** Site/URL/domain saved for the entry — may be free-form. */
  site?: string | null;
  /** Name of the access — used for initial fallback and alt text. */
  name: string;
  /** Tailwind size classes for the square logo container. */
  className?: string;
  /** Tailwind size for the inner image (defaults to fill container). */
  rounded?: "lg" | "xl" | "2xl" | "full";
};

/**
 * Renders the company logo for a vault entry with graceful fallbacks:
 *   logo.dev → duckduckgo favicon → google s2 favicon → letter avatar.
 * Sends only the public domain to logo providers (never credentials).
 */
function CompanyLogoBase({ site, name, className, rounded = "xl" }: Props) {
  const domain = extractDomain(site ?? "");
  const candidates = getCompanyLogoCandidates(domain, name);
  const [idx, setIdx] = useState(0);

  // Reset cascade when the source changes.
  useEffect(() => {
    setIdx(0);
  }, [site, name]);

  const failed = idx >= candidates.length;
  const initial = initialOf(name);
  const radius =
    rounded === "full" ? "rounded-full" :
    rounded === "2xl" ? "rounded-2xl" :
    rounded === "lg" ? "rounded-lg" : "rounded-xl";

  if (failed || !candidates.length) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center text-white font-semibold",
          radius,
          "h-11 w-11 text-sm",
          className,
        )}
        style={{ background: colorFor(name || domain || "?") }}
      >
        {initial}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-white/95 ring-1 ring-border/60",
        radius,
        "h-11 w-11",
        className,
      )}
    >
      <img
        src={candidates[idx]}
        alt=""
        onError={() => setIdx((i) => i + 1)}
        className="h-full w-full object-contain p-1.5"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}

export const CompanyLogo = memo(CompanyLogoBase);
