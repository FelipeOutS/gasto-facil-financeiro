export type Strength = "fraca" | "media" | "forte" | "unknown";

export function evaluateStrength(pwd: string): Strength {
  if (!pwd) return "unknown";
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 2) return "fraca";
  if (score === 3 || score === 4) return "media";
  return "forte";
}

export function generateStrongPassword(length = 18): string {
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*?-_=+";
  const all = lowers + uppers + digits + symbols;
  const pick = (set: string) =>
    set[Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % set.length)];
  const req = [pick(lowers), pick(uppers), pick(digits), pick(symbols)];
  const rest: string[] = [];
  for (let i = 0; i < length - 4; i++) rest.push(pick(all));
  const arr = [...req, ...rest];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}
