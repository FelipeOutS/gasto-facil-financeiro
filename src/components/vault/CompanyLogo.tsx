/**
 * CompanyLogo — wrapper legado mantido para compatibilidade com o Cofre Pessoal.
 * Delegado ao novo `BrandLogo` global em `@/components/brand/BrandLogo`.
 */
import { memo } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";

type Props = {
  site?: string | null;
  name: string;
  className?: string;
  rounded?: "lg" | "xl" | "2xl" | "full";
};

function CompanyLogoBase({ site, name, className, rounded = "xl" }: Props) {
  return (
    <BrandLogo
      name={name}
      domain={site ?? undefined}
      size="md"
      rounded={rounded}
      className={className}
    />
  );
}

export const CompanyLogo = memo(CompanyLogoBase);
