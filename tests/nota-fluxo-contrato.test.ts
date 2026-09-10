/**
 * Fluxo Nota/Comprovante — contratos de código do fluxo /adicionar → /confirmar.
 *
 * Roda via: bun test tests/nota-fluxo-contrato.test.ts
 *
 * Estes testes travam decisões que uma regressão silenciosa desfaria:
 *  - a opção principal NÃO usa mais a câmera nativa do sistema;
 *  - a imagem retornada é processada automaticamente;
 *  - a deduplicação é a avançada (uma única lógica no produto);
 *  - nada é persistido antes da confirmação;
 *  - a consulta da NFC-e é autenticada e passa pela guarda anti-SSRF.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const adicionar = readFileSync("src/routes/adicionar.tsx", "utf8");
const confirmar = readFileSync("src/routes/confirmar.tsx", "utf8");
const sheet = readFileSync("src/components/nota/ReceiptCaptureSheet.tsx", "utf8");
const fetchFn = readFileSync("src/lib/mercado/nfce-fetch.functions.ts", "utf8");
const ptAdicionar = JSON.parse(readFileSync("src/i18n/locales/pt/adicionar.json", "utf8"));
const enAdicionar = JSON.parse(readFileSync("src/i18n/locales/en/adicionar.json", "utf8"));
const ptConfirmar = JSON.parse(readFileSync("src/i18n/locales/pt/confirmar.json", "utf8"));
const enConfirmar = JSON.parse(readFileSync("src/i18n/locales/en/confirmar.json", "utf8"));

describe("/adicionar — menu de captura", () => {
  it("a opção principal abre a captura do app, não a câmera nativa", () => {
    expect(adicionar.includes("ReceiptCaptureSheet")).toBe(true);
    expect(adicionar.includes("onClick={openScanner}")).toBe(true);
    // a rota não cria mais <input capture="environment">
    expect(adicionar.includes('setAttribute("capture"')).toBe(false);
    expect(adicionar.includes('capture="environment"')).toBe(false);
  });

  it("galeria usa o mesmo pipeline e marca processamento automático", () => {
    expect(adicionar.includes("pickFromGallery")).toBe(true);
    expect(adicionar.includes("detectQrFromDataUrl")).toBe(true);
    expect(adicionar.includes('sessionStorage.setItem("gf:pendingAuto", "1")')).toBe(true);
  });

  it("textos deixam claro o que fazer, em pt e en", () => {
    expect(ptAdicionar.options.photo.title).toBe("Ler nota ou comprovante");
    expect(ptAdicionar.options.gallery.title).toBe("Escolher da galeria");
    expect(typeof enAdicionar.options.photo.title).toBe("string");
    expect(typeof ptAdicionar.scan.frameTitle).toBe("string");
    expect(typeof enAdicionar.scan.frameTitle).toBe("string");
  });
});

describe("captura — QR tratado como dado, não como link", () => {
  it("o scanner devolve o conteúdo do QR junto com a foto", () => {
    expect(sheet.includes("qrRaw")).toBe(true);
    expect(sheet.includes("captureVideoFrame")).toBe(true);
  });

  it("nenhuma navegação automática para fora do app", () => {
    for (const src of [sheet, adicionar]) {
      expect(src.includes("window.open")).toBe(false);
      expect(src.includes("location.href =")).toBe(false);
    }
  });

  it("em /confirmar, abrir a nota oficial é ação secundária e manual", () => {
    expect(confirmar.includes('t("qr.openOfficial")')).toBe(true);
    expect(confirmar.includes('rel="noreferrer noopener"')).toBe(true);
    expect(confirmar.includes("window.open")).toBe(false);
    // A ação primária é usar os dados dentro do app.
    expect(confirmar.includes("usarDadosDaNota")).toBe(true);
    expect(ptConfirmar.qr.useNota).toBe("Usar dados da nota");
    expect(typeof enConfirmar.qr.useNota).toBe("string");
  });
});

describe("/confirmar — extração, revisão, deduplicação e persistência", () => {
  it("processa a imagem automaticamente ao chegar da captura", () => {
    expect(confirmar.includes("gf:pendingImage")).toBe(true);
    expect(confirmar.includes("void analisarImagem(img)")).toBe(true);
  });

  it("reutiliza o OCR/IA existente (nenhum segundo pipeline)", () => {
    expect(confirmar.includes("/api/ocr-gasto")).toBe(true);
  });

  it("usa a deduplicação avançada e não a comparação exata antiga", () => {
    expect(confirmar.includes("findDuplicateGastoAdvanced")).toBe(true);
    expect(confirmar.includes("findPossibleDuplicate")).toBe(false);
  });

  it("duplicidade provável é apenas aviso com decisão do usuário", () => {
    expect(confirmar.includes('data-testid="dup-aviso"')).toBe(true);
    expect(ptConfirmar.dupPreview.title).toBe("Possível duplicidade");
    expect(ptConfirmar.dup.confirm).toBe("Salvar mesmo assim");
    expect(ptConfirmar.dup.cancel).toBe("Cancelar");
  });

  it("nada é salvo antes da confirmação: addGasto só dentro do submit da revisão", () => {
    const ocorrencias = confirmar.split("addGasto(").length - 1;
    expect(ocorrencias).toBe(1);
    const idx = confirmar.indexOf("addGasto(data)");
    const submitIdx = confirmar.indexOf("onSubmit={async (data) => {");
    expect(submitIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(submitIdx);
  });

  it("forma de pagamento não é inventada quando a leitura não identifica", () => {
    expect(confirmar.includes("result.formaPagamento ?? undefined")).toBe(true);
  });

  it("QR indisponível/incompatível cai para OCR sem recomeçar o fluxo", () => {
    expect(confirmar.includes('t("qr.fallbackOcr")')).toBe(true);
    expect(confirmar.includes('t("qr.notFiscal")')).toBe(true);
  });
});

describe("consulta da NFC-e — segurança server-side", () => {
  it("exige autenticação", () => {
    expect(fetchFn.includes("requireSupabaseAuth")).toBe(true);
  });

  it("valida a URL pela guarda anti-SSRF, inclusive em cada redirect", () => {
    expect(fetchFn.includes("validateNfceUrl")).toBe(true);
    expect(fetchFn.includes('redirect: "manual"')).toBe(true);
    expect(fetchFn.includes("MAX_REDIRECTS")).toBe(true);
  });

  it("mantém timeout e limite de tamanho da resposta", () => {
    expect(fetchFn.includes("TIMEOUT_MS")).toBe(true);
    expect(fetchFn.includes("MAX_BYTES")).toBe(true);
    expect(fetchFn.includes("readLimitedText")).toBe(true);
  });

  it("não persiste HTML nem dados fiscais extras no gasto", () => {
    const mapper = readFileSync("src/lib/nota/nfce-to-gasto.ts", "utf8");
    expect(mapper.includes("cnpj")).toBe(false);
    expect(mapper.includes("accessKey")).toBe(false);
  });
});
