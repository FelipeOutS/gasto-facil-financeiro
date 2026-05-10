import { cn } from "@/lib/utils";

function getInitials(name?: string | null, email?: string | null) {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "U";
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserAvatar({
  url,
  name,
  email,
  size = 40,
  className,
}: {
  url?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = getInitials(name, email);
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/20 to-primary/40 text-primary-foreground font-semibold ring-1 ring-border/60",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
    >
      {url ? (
        <img
          src={url}
          alt={name ?? "Avatar"}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="text-foreground/80">{initials}</span>
      )}
    </span>
  );
}
