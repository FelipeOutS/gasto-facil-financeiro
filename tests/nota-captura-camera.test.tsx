/**
 * Fluxo Nota/Comprovante — tela de captura controlada pelo app.
 *
 * Roda via: bun test tests/nota-captura-camera.test.tsx
 *
 * Cobre: câmera indisponível, permissão negada, galeria e o fato de que o
 * conteúdo de um QR Code NUNCA é aberto no navegador por este componente.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Outro arquivo de teste pode já ter registrado o DOM no mesmo processo.
try {
  GlobalRegistrator.register();
} catch {
  /* já registrado */
}

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
await import("../src/i18n");
const { ReceiptCaptureSheet } = await import("../src/components/nota/ReceiptCaptureSheet");

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("ReceiptCaptureSheet — captura dentro do Gasto Inteligente", () => {
  beforeEach(() => {
    cleanup();
  });
  afterEach(() => {
    cleanup();
  });

  it("sem suporte a câmera, oferece fallback nativo e galeria (sem tela quebrada)", async () => {
    setMediaDevices(undefined);
    render(
      React.createElement(ReceiptCaptureSheet, {
        open: true,
        onClose: () => {},
        onResult: () => {},
      }),
    );
    await waitFor(() => expect(screen.getByText("Câmera indisponível aqui")).toBeTruthy());
    expect(screen.getByText("Abrir câmera do celular")).toBeTruthy();
    expect(screen.getByText("Escolher da galeria")).toBeTruthy();
  });

  it("permissão negada mostra mensagem amigável e mantém alternativas", async () => {
    setMediaDevices({
      getUserMedia: async () => {
        const err = new Error("denied");
        err.name = "NotAllowedError";
        throw err;
      },
    });
    render(
      React.createElement(ReceiptCaptureSheet, {
        open: true,
        onClose: () => {},
        onResult: () => {},
      }),
    );
    await waitFor(() => expect(screen.getByText("Sem acesso à câmera")).toBeTruthy());
    expect(screen.getByText("Escolher da galeria")).toBeTruthy();
    expect(screen.getByText("Abrir câmera do celular")).toBeTruthy();
  });

  it("imagem da galeria entra no mesmo pipeline (sem escolher o arquivo duas vezes)", async () => {
    setMediaDevices(undefined);
    let recebido: { imageDataUrl?: string; qrRaw?: string } | null = null;
    const { container } = render(
      React.createElement(ReceiptCaptureSheet, {
        open: true,
        onClose: () => {},
        onResult: (r: { imageDataUrl?: string; qrRaw?: string }) => {
          recebido = r;
        },
      }),
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBe(2);
    const file = new File(["fake-bytes"], "cupom.jpg", { type: "image/jpeg" });
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(recebido).not.toBeNull(), { timeout: 8000 });
    expect(recebido!.imageDataUrl?.startsWith("data:")).toBe(true);
  });

  it("a tela de captura não abre nenhuma URL externa (QR nunca leva à SEFAZ)", async () => {
    const src = await Bun.file("src/components/nota/ReceiptCaptureSheet.tsx").text();
    expect(src.includes("window.open")).toBe(false);
    expect(src.includes("location.href")).toBe(false);
    expect(src.includes("location.assign")).toBe(false);
  });
});
