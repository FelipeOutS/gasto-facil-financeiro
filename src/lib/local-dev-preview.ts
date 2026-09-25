/** Permite visualizar a interface com uma sessão real apenas no servidor Vite local. */
export function isLocalDevPreview(dev: boolean, flag: string | undefined, hostname: string): boolean {
  if (!dev || flag !== "true") return false;

  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
    return false;
  }
  const numbers = octets.map(Number);
  if (numbers.some((part) => part > 255)) return false;

  return (
    numbers[0] === 10 ||
    (numbers[0] === 192 && numbers[1] === 168) ||
    (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31)
  );
}
