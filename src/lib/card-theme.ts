/**
 * Card theme helper — produces an elegant gradient that darkens toward a
 * deeper shade of the SAME color family (instead of a generic gray/black tail).
 *
 * Inputs are HEX colors stored on `cartao.cor`. Some issuers (Mercado Pago,
 * C6 Bank) get a premium "black" treatment regardless of color.
 */

export type CardTheme = {
  /** Full background gradient ready for `style.background` */
  background: string;
  /** Dominant color (used for accents like progress fill on light surfaces) */
  primary: string;
  /** Darker version of primary (gradient end) */
  deep: string;
  /** Foreground color for text on the gradient (always white-ish here) */
  fg: string;
  /** Whether this theme is intentionally dark/premium (black-ish) */
  premium: boolean;
};

/* -------------------- color math (sRGB) -------------------- */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h: number, s: number, l: number) {
  h /= 360;
  s /= 100;
  l /= 100;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/** Darken a hex color to a deeper shade of the same hue. */
function deepen(hex: string, amount = 0.42): string {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  // Grayscale colors: just darken lightness, keep neutral.
  if (hsl.s < 6) {
    const nl = Math.max(4, hsl.l - amount * 60);
    const out = hslToRgb(hsl.h, hsl.s, nl);
    return rgbToHex(out.r, out.g, out.b);
  }
  // Boost saturation slightly on dark side so it doesn't muddy into gray.
  const newL = Math.max(8, hsl.l - amount * 55);
  const newS = Math.min(100, hsl.s + 6);
  const out = hslToRgb(hsl.h, newS, newL);
  return rgbToHex(out.r, out.g, out.b);
}

/** Mid stop — slightly darker than primary, used for smoother gradient. */
function midShade(hex: string): string {
  return deepen(hex, 0.18);
}

/* -------------------- issuer overrides -------------------- */

const PREMIUM_BLACK_ISSUERS = new Set(["mercado pago", "mercadopago", "c6", "c6 bank", "c6bank"]);

function normalizeIssuer(s?: string): string {
  return (s || "").trim().toLowerCase();
}

/* -------------------- public API -------------------- */

export function getCardTheme(cor: string, banco?: string): CardTheme {
  const issuer = normalizeIssuer(banco);
  const premium = PREMIUM_BLACK_ISSUERS.has(issuer);

  if (premium) {
    // Premium black — adds a subtle nuance of the chosen color so it isn't
    // a flat, washed-out gray.
    const { r, g, b } = hexToRgb(cor);
    const tintHsl = rgbToHsl(r, g, b);
    const tint = hslToRgb(tintHsl.h, Math.min(35, tintHsl.s), 14);
    const tintHex = rgbToHex(tint.r, tint.g, tint.b);
    return {
      background: `linear-gradient(135deg, #2a2a2e 0%, ${tintHex} 55%, #0b0b0d 100%)`,
      primary: "#2a2a2e",
      deep: "#0b0b0d",
      fg: "#ffffff",
      premium: true,
    };
  }

  const mid = midShade(cor);
  const deep = deepen(cor, 0.45);
  return {
    background: `linear-gradient(135deg, ${cor} 0%, ${mid} 55%, ${deep} 100%)`,
    primary: cor,
    deep,
    fg: "#ffffff",
    premium: false,
  };
}

/** Util re-exports for callers that need just the deeper shade. */
export { deepen as darkenHex };
