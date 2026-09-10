/**
 * Fluxo Nota/Comprovante — segurança do QR Code.
 *
 * Roda via: bun test tests/nota-qr-ssrf-guard.test.ts
 *
 * Garante que NENHUMA URL arbitrária de QR Code chega ao fetch server-side:
 * só HTTPS, host fiscal em allowlist, sem IP literal/loopback/privado/metadata.
 */
import { describe, expect, it } from "bun:test";
import { validateNfceUrl, isAllowedNfceHost } from "../src/lib/nota/nfce-url-guard";
import { parseNfceQrContent } from "../src/lib/mercado/nfce-parser";

const URL_SP =
  "https://www.nfce.fazenda.sp.gov.br/consultanfce/consulta/qrcode?p=35260912345678901234650010000012341000012345|2|1|1|abc";

describe("guarda de URL de NFC-e", () => {
  it("aceita URL fiscal HTTPS de estado suportado", () => {
    const r = validateNfceUrl(URL_SP);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.host).toBe("www.nfce.fazenda.sp.gov.br");
  });

  it("recusa HTTP puro", () => {
    const r = validateNfceUrl(URL_SP.replace("https://", "http://"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_protocol");
  });

  it("recusa domínio arbitrário de QR não fiscal", () => {
    const r = validateNfceUrl("https://evil.example.com/nfce?p=123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("host_not_allowed");
  });

  it("recusa gov.br sem pista fiscal", () => {
    expect(isAllowedNfceHost("portal.gov.br")).toBe(false);
    expect(isAllowedNfceHost("nfce.fazenda.rs.gov.br")).toBe(true);
  });

  it("bloqueia localhost, IP literal, faixa privada e metadata (SSRF)", () => {
    const casos: Array<[string, string]> = [
      ["https://localhost/nfce", "loopback_blocked"],
      ["https://127.0.0.1/nfce", "loopback_blocked"],
      ["https://10.0.0.5/nfce", "private_or_internal_blocked"],
      ["https://192.168.1.10/nfce", "private_or_internal_blocked"],
      ["https://172.16.4.4/nfce", "private_or_internal_blocked"],
      ["https://169.254.169.254/latest/meta-data", "metadata_blocked"],
      ["https://metadata.google.internal/computeMetadata", "metadata_blocked"],
      ["https://8.8.8.8/nfce", "ip_literal_blocked"],
      ["https://sefaz-interno.internal/nfce", "private_or_internal_blocked"],
    ];
    for (const [url, reason] of casos) {
      const r = validateNfceUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it("bloqueia credenciais embutidas e portas fora de 443", () => {
    const cred = validateNfceUrl("https://user:pass@nfce.fazenda.sp.gov.br/x");
    expect(cred.ok).toBe(false);
    if (!cred.ok) expect(cred.reason).toBe("credentials_in_url");

    const port = validateNfceUrl("https://nfce.fazenda.sp.gov.br:8080/x");
    expect(port.ok).toBe(false);
    if (!port.ok) expect(port.reason).toBe("bad_port");
  });

  it("recusa URL absurdamente longa e conteúdo não-URL", () => {
    const longa = `https://nfce.fazenda.sp.gov.br/x?p=${"1".repeat(3000)}`;
    expect(validateNfceUrl(longa).ok).toBe(false);
    expect(validateNfceUrl("qualquer texto").ok).toBe(false);
    expect(validateNfceUrl(null).ok).toBe(false);
  });
});

describe("classificação do QR antes de qualquer fetch", () => {
  it("QR fiscal válido é reconhecido e passa pela guarda", () => {
    const parsed = parseNfceQrContent(URL_SP);
    expect(parsed.status).toBe("valid_nfce_url");
    expect(validateNfceUrl(parsed.url!).ok).toBe(true);
  });

  it("QR não fiscal (link qualquer) nunca é liberado para fetch", () => {
    const parsed = parseNfceQrContent("https://meusite.com/promo");
    expect(parsed.status).toBe("unsupported");
    expect(validateNfceUrl(parsed.url!).ok).toBe(false);
  });

  it("QR de texto aleatório é inválido", () => {
    expect(parseNfceQrContent("compre agora").status).toBe("invalid");
  });
});
