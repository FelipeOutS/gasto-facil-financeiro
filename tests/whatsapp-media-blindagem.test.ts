/**
 * WA-G5A.1 — blindagem de mídia: testes unitários dos validadores puros.
 *
 * Esses testes garantem que NENHUMA imagem inválida (tamanho, formato,
 * mismatch de mime, vazia, corrompida) passe pelo gate antes do OCR.
 * Combinado com a ordem do webhook (eligibilidade → entitlement →
 * download → validação → OCR), isso garante que o OCR só é chamado
 * para imagens reais de usuários elegíveis.
 */
import { test, expect } from "bun:test";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  detectImageMimeFromBytes,
  validateDownloadedImage,
} from "../src/server/whatsapp-media-validation.server";

function jpegBytes(extra = 32): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0];
  return Uint8Array.from([...head, ...new Array(extra).fill(0)]);
}
function pngBytes(extra = 32): Uint8Array {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return Uint8Array.from([...head, ...new Array(extra).fill(0)]);
}
function webpBytes(extra = 32): Uint8Array {
  // "RIFF" .... "WEBP"
  const head = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  return Uint8Array.from([...head, ...new Array(extra).fill(0)]);
}

test("detecta JPEG, PNG e WEBP pelos bytes mágicos", () => {
  expect(detectImageMimeFromBytes(jpegBytes())).toBe("image/jpeg");
  expect(detectImageMimeFromBytes(pngBytes())).toBe("image/png");
  expect(detectImageMimeFromBytes(webpBytes())).toBe("image/webp");
});

test("rejeita buffer vazio ou pequeno demais para conter header", () => {
  expect(detectImageMimeFromBytes(new Uint8Array(0))).toBeNull();
  expect(detectImageMimeFromBytes(new Uint8Array([0xff, 0xd8]))).toBeNull();
});

test("rejeita conteúdo arbitrário (PDF, HTML, executável)", () => {
  // PDF: %PDF
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
  // HTML
  const html = Uint8Array.from([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0, 0, 0]);
  expect(detectImageMimeFromBytes(pdf)).toBeNull();
  expect(detectImageMimeFromBytes(html)).toBeNull();
  expect(validateDownloadedImage(pdf, "image/jpeg")).toBeNull();
  expect(validateDownloadedImage(html, "image/png")).toBeNull();
});

test("validateDownloadedImage: mismatch de mime declarado vs bytes reais é rejeitado", () => {
  // bytes JPEG, mas declarado como PNG → rejeita.
  expect(validateDownloadedImage(jpegBytes(), "image/png")).toBeNull();
  // bytes PNG, declarado JPEG → rejeita.
  expect(validateDownloadedImage(pngBytes(), "image/jpeg")).toBeNull();
});

test("validateDownloadedImage: aceita jpeg/jpg como equivalentes", () => {
  expect(validateDownloadedImage(jpegBytes(), "image/jpeg")?.mimeType).toBe("image/jpeg");
  expect(validateDownloadedImage(jpegBytes(), "image/jpg")?.mimeType).toBe("image/jpeg");
});

test("validateDownloadedImage: mime declarado fora do allowlist é rejeitado", () => {
  // PDF declarado, mas bytes JPEG → rejeita pelo mime declarado.
  expect(validateDownloadedImage(jpegBytes(), "application/pdf")).toBeNull();
  // gif declarado, bytes png → rejeita.
  expect(validateDownloadedImage(pngBytes(), "image/gif")).toBeNull();
});

test("validateDownloadedImage: aceita quando declaredMime ausente, desde que bytes batam", () => {
  expect(validateDownloadedImage(jpegBytes())?.mimeType).toBe("image/jpeg");
  expect(validateDownloadedImage(webpBytes())?.mimeType).toBe("image/webp");
});

test("validateDownloadedImage: rejeita acima de 15 MB", () => {
  // construímos um array de tamanho MAX+1 com header JPEG válido.
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  expect(validateDownloadedImage(big, "image/jpeg")).toBeNull();
});

test("validateDownloadedImage: aceita logo abaixo do limite", () => {
  const ok = new Uint8Array(MAX_IMAGE_BYTES - 1024);
  ok[0] = 0xff; ok[1] = 0xd8; ok[2] = 0xff;
  expect(validateDownloadedImage(ok, "image/jpeg")?.mimeType).toBe("image/jpeg");
});

test("ALLOWED_IMAGE_MIME tem apenas JPEG/PNG/WEBP", () => {
  expect(Array.from(ALLOWED_IMAGE_MIME).sort()).toEqual([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ]);
});

test("MAX_IMAGE_BYTES é exatamente 15 MB", () => {
  expect(MAX_IMAGE_BYTES).toBe(15 * 1024 * 1024);
});
