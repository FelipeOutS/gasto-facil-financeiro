/**
 * Fluxo Nota/Comprovante — /confirmar de ponta a ponta (sem browser real).
 *
 * Roda via: bun test tests/nota-confirmar-fluxo.test.tsx
 *
 * Cobre: extração automática da imagem capturada, QR fiscal sem navegação
 * externa, fallback para OCR, aviso de duplicidade e persistência só após
 * a confirmação do usuário.
 */
import { describe, expect, it, beforeEach, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } = await import(
  "@testing-library/react"
);
await import("../src/i18n");

// ---- dependências de plataforma substituídas por dublês simples ----
const anchorStub = ({ children, ...rest }: Record<string, unknown>) =>
  React.createElement("a", rest as never, children as never);
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  createRootRoute: (opts: unknown) => ({ options: opts }),
  createRootRouteWithContext: () => (opts: unknown) => ({ options: opts }),
  createRouter: () => ({}),
  RouterProvider: ({ children }: { children?: unknown }) =>
    React.createElement("div", null, children as never),
  Outlet: () => null,
  Link: anchorStub,
  useNavigate: () => () => {},
  useRouter: () => ({ navigate: () => {}, state: { location: { pathname: "/confirmar" } } }),
  useRouterState: () => ({ location: { pathname: "/confirmar" } }),
  useLocation: () => ({ pathname: "/confirmar", search: "", searchStr: "" }),
  useParams: () => ({}),
  useSearch: () => ({}),
  useMatches: () => [],
  redirect: (o: unknown) => o,
  notFound: () => undefined,
  HeadContent: () => null,
  Scripts: () => null,
}));
const chain = () => {
  const api: Record<string, unknown> = {};
  api['middleware'] = () => api;
  api['inputValidator'] = () => api;
  api['validator'] = () => api;
  api['client'] = () => api;
  api['server'] = () => api;
  api['handler'] = (fn: unknown) => fn;
  return api;
};
mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => chain(),
  createMiddleware: () => chain(),
  createStart: (fn: unknown) => fn,
}));
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
mock.module("@/components/MobileShell", () => ({
  MobileShell: ({ children }: { children?: unknown }) =>
    React.createElement("div", null, children as never),
}));
mock.module("@/components/PremiumLockModal", () => ({ PremiumLockModal: () => null }));
mock.module("@/lib/premium-errors", () => ({
  usePremiumApiGate: () => ({
    state: { open: false, title: "", description: "", feature: null },
    close: () => {},
    handleResponse: () => false,
  }),
}));
mock.module("@/lib/subscription-guard", () => ({
  useSubscriptionGuard: () => ({ canWrite: true, requireSubscription: () => {} }),
}));
mock.module("@/lib/use-online-status", () => ({ requireOnline: async () => true }));

// GastoForm real é pesado; o dublê apenas expõe os dados iniciais e submete.
let ultimoInitial: Record<string, unknown> | undefined;
mock.module("@/components/GastoForm", () => ({
  GastoForm: ({
    initial,
    submitLabel,
    onSubmit,
  }: {
    initial?: Record<string, unknown>;
    submitLabel: string;
    onSubmit: (d: unknown) => void | Promise<void>;
  }) => {
    ultimoInitial = initial;
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "salvar",
        onClick: () =>
          void onSubmit({
            valor: initial?.valor ?? 0,
            data: initial?.data ?? "2026-09-09",
            descricao: initial?.descricao ?? "",
            estabelecimento: initial?.estabelecimento ?? "",
            categoriaId: initial?.categoriaId ?? "mercado",
            formaPagamento: initial?.formaPagamento ?? "credito",
          }),
      },
      submitLabel,
    );
  },
}));

let ocrResposta: { ok: boolean; body: unknown } = { ok: true, body: {} };
let ocrChamadas = 0;
mock.module("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    if (url === "/api/ocr-gasto") ocrChamadas += 1;
    return {
      ok: ocrResposta.ok,
      status: ocrResposta.ok ? 200 : 500,
      json: async () => ocrResposta.body,
    } as unknown as Response;
  },
}));

let nfceResposta: unknown = null;
mock.module("@/lib/mercado/nfce-fetch.functions", () => ({
  fetchNfceFromUrl: async () => nfceResposta,
}));

const store = await import("../src/lib/store");
const { Route } = await import("../src/routes/confirmar");
const Confirmar = (Route as unknown as { options: { component: () => JSX.Element } }).options
  .component;

const IMG = "data:image/jpeg;base64,YWJj";
const QR_SP =
  "https://www.nfce.fazenda.sp.gov.br/consultanfce/consulta/qrcode?p=35260912345678901234650010000012341000012345|2|1|1|abc";

function ocrOk(over: Record<string, unknown> = {}) {
  return {
    valor: 150,
    valoresEncontrados: [150],
    data: "2026-09-09",
    descricao: "Mercado Exemplo",
    categoriaSugerida: "mercado",
    formaPagamento: null,
    confianca: "alta",
    observacao: null,
    ...over,
  };
}

function prepararSessao(opts: { img?: string; qr?: string; auto?: boolean }) {
  sessionStorage.clear();
  if (opts.img) sessionStorage.setItem("gf:pendingImage", opts.img);
  if (opts.qr) sessionStorage.setItem("gf:pendingQr", opts.qr);
  if (opts.auto !== false) sessionStorage.setItem("gf:pendingAuto", "1");
}

async function renderConfirmar() {
  const r = render(React.createElement(Confirmar));
  await act(async () => {});
  return r;
}

describe("/confirmar — captura → extração → revisão → dedup → confirmação", () => {
  beforeEach(() => {
    cleanup();
    ocrChamadas = 0;
    ocrResposta = { ok: true, body: ocrOk() };
    nfceResposta = null;
    ultimoInitial = undefined;
    store.setActiveUserId("usuario-teste");
  });

  it("imagem capturada é analisada automaticamente (usuário não escolhe o arquivo de novo)", async () => {
    prepararSessao({ img: IMG });
    await renderConfirmar();
    await waitFor(() => expect(ocrChamadas).toBe(1));
    await waitFor(() => expect(screen.getByTestId("salvar")).toBeTruthy());
    expect(ultimoInitial?.valor).toBe(150);
    expect(ultimoInitial?.estabelecimento).toBe("Mercado Exemplo");
    // sessão limpa: a imagem não fica guardada entre navegações
    expect(sessionStorage.getItem("gf:pendingImage")).toBeNull();
  });

  it("nada é salvo antes da revisão; só o clique em salvar registra o gasto", async () => {
    prepararSessao({ img: IMG });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByTestId("salvar")).toBeTruthy());
    const antes = store.getGastos().length;
    expect(antes).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId("salvar"));
    });
    await waitFor(() => expect(store.getGastos().length).toBe(antes + 1));
  });

  it("QR fiscal mostra a nota encontrada e NÃO abre o site da Fazenda", async () => {
    prepararSessao({ img: IMG, qr: QR_SP });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByTestId("qr-encontrado")).toBeTruthy());
    expect(ocrChamadas).toBe(0);
    expect(screen.getByText("Usar dados da nota")).toBeTruthy();
    const oficial = screen.getByText("Abrir nota oficial") as HTMLAnchorElement;
    expect(oficial.closest("a")?.getAttribute("target")).toBe("_blank");
  });

  it("'Usar dados da nota' traz UM gasto com o total e os itens como apoio", async () => {
    nfceResposta = {
      status: "items_found",
      host: "nfce.fazenda.sp.gov.br",
      items: [
        { id: "1", nome: "ARROZ", quantidade: 1, valorTotal: 25.9, confianca: "alta" },
        { id: "2", nome: "LEITE", quantidade: 1, valorTotal: 6.99, confianca: "alta" },
      ],
      totalDeclared: 32.89,
      marketName: "Mercado Exemplo",
      dateISO: "2026-09-09",
      warnings: [],
    };
    prepararSessao({ img: IMG, qr: QR_SP });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByTestId("qr-encontrado")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Usar dados da nota"));
    });
    await waitFor(() => expect(screen.getByTestId("salvar")).toBeTruthy());
    expect(ultimoInitial?.valor).toBe(32.89);
    expect(ocrChamadas).toBe(0);
  });

  it("consulta da nota indisponível cai para OCR/IA sem recomeçar o fluxo", async () => {
    nfceResposta = {
      status: "protected",
      host: "nfce.fazenda.sp.gov.br",
      items: [],
      warnings: [],
    };
    prepararSessao({ img: IMG, qr: QR_SP });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByTestId("qr-encontrado")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Usar dados da nota"));
    });
    await waitFor(() => expect(ocrChamadas).toBe(1));
    await waitFor(() => expect(screen.getByTestId("salvar")).toBeTruthy());
  });

  it("QR não fiscal não dispara consulta e usa OCR direto", async () => {
    prepararSessao({ img: IMG, qr: "https://meusite.com/promo" });
    await renderConfirmar();
    await waitFor(() => expect(ocrChamadas).toBe(1));
    expect(screen.queryByTestId("qr-encontrado")).toBeNull();
  });

  it("possível duplicidade aparece na revisão e exige decisão do usuário", async () => {
    store.addGastoAuto({
      valor: 150,
      data: "2026-09-08",
      descricao: "Mercado Exemplo",
      estabelecimento: "Mercado Exemplo",
      categoriaId: "mercado",
      formaPagamento: "credito",
    });
    prepararSessao({ img: IMG });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByTestId("dup-aviso")).toBeTruthy());
    const aviso = screen.getByTestId("dup-aviso");
    expect(aviso.textContent).toContain("Mercado Exemplo");
    expect(aviso.textContent).toContain("2026-09-08");

    const antes = store.getGastos().length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("salvar"));
    });
    // Confirmação obrigatória: nada é salvo silenciosamente.
    await waitFor(() => expect(screen.getByText("Salvar mesmo assim")).toBeTruthy());
    expect(store.getGastos().length).toBe(antes);

    await act(async () => {
      fireEvent.click(screen.getByText("Salvar mesmo assim"));
    });
    await waitFor(() => expect(store.getGastos().length).toBe(antes + 1));
  });

  it("erro de leitura mostra dicas e permite tentar novamente (sem salvar nada)", async () => {
    ocrResposta = { ok: false, body: { error: "falhou" } };
    prepararSessao({ img: IMG });
    await renderConfirmar();
    await waitFor(() => expect(screen.getByText("Não consegui ler")).toBeTruthy());
    expect(store.getGastos().length).toBe(0);
  });
});
