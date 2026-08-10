import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("AJUSTES-07 — regressões de UX da Central de Ajustes", () => {
  it("Aparência não deve conter strings PT hardcoded nem chaves cruas", () => {
    const src = read("src/routes/app_.ajustes.aparencia.tsx");
    expect(src).not.toMatch(/Tema do Aplicativo/);
    expect(src).not.toMatch(/Em breve"/);
    expect(src).toContain('t("appearance.themes.light")');
    expect(src).toContain('t("appearance.comingSoon")');
  });

  it("Aparência mantém tema persistente e seletor de cor de destaque", () => {
    const src = read("src/routes/app_.ajustes.aparencia.tsx");
    expect(src).toContain('from "@/lib/theme"');
    expect(src).toContain("useAccent");
    expect(src).toContain("ACCENTS.map");
    // não deve voltar a usar a chave divergente gi-theme via store
    expect(src).not.toContain('localStorage.getItem("gi-theme")');
  });

  it("i18n possui as chaves usadas em Aparência (pt e en)", () => {
    for (const loc of ["pt", "en"]) {
      const j = JSON.parse(read(`src/i18n/locales/${loc}/settings.json`));
      const a = j.appearance;
      for (const k of [
        "title",
        "description",
        "theme",
        "accent",
        "moreOptions",
        "comingSoon",
        "compactLayout",
        "fontSize",
        "themeUpdated",
      ]) {
        expect(a[k], `${loc}.appearance.${k}`).toBeTruthy();
      }
      for (const k of ["light", "dark", "system"]) {
        expect(a.themes[k], `${loc}.appearance.themes.${k}`).toBeTruthy();
      }
    }
  });

  it("nenhuma referência visível a 'beta' nas telas de Ajustes/Ajuda", () => {
    const files = [
      "src/routes/app_.ajustes.index.tsx",
      "src/routes/app_.ajustes.ajuda.tsx",
      "src/routes/app_.ajustes.aparencia.tsx",
      "src/routes/app_.ajustes.ajuda.suporte.tsx",
      "src/routes/app_.ajustes.ajuda.termos.tsx",
      "src/routes/app_.ajustes.ajuda.privacidade.tsx",
    ];
    for (const f of files) {
      expect(/beta/i.test(read(f)), f).toBe(false);
    }
  });

  it("versão vem de fonte canônica única, sem sufixo de estágio", () => {
    const ver = read("src/lib/app-version.ts");
    expect(ver).toMatch(/APP_VERSION = "\d+\.\d+\.\d+"/);
    expect(ver).not.toMatch(/APP_VERSION = "[^"]*(beta|alpha|rc)/i);
    expect(read("src/routes/app_.ajustes.ajuda.tsx")).toContain("APP_VERSION");
  });

  it("exclusão seletiva usa checkbox + modal, sem campo de texto EXCLUIR", () => {
    const src = read("src/routes/app_.privacidade.tsx");
    expect(src).toContain("isConfirmChecked");
    expect(src).toContain("<Dialog");
    expect(src).toContain("disabled={!isConfirmChecked || isDeleting}");
    expect(src).not.toMatch(/placeholder="EXCLUIR"/);
    expect(src).not.toContain("confirmationInput");
  });

  it("copy de dados preservados não usa 'Histórico de cobrança obrigatório'", () => {
    for (const loc of ["pt", "en"]) {
      const j = JSON.parse(read(`src/i18n/locales/${loc}/privacy.json`));
      expect(j.manageData.review.billingSafe).not.toMatch(/obrigatório|Required billing history/);
    }
  });

  it("documentos legais internos e públicos compartilham a mesma fonte", () => {
    const shared = read("src/components/legal/LegalContent.tsx");
    expect(shared).toContain("export function TermosContent");
    expect(shared).toContain("export function PrivacidadeContent");
    for (const f of [
      "src/routes/termos.tsx",
      "src/routes/app_.ajustes.ajuda.termos.tsx",
    ]) {
      expect(read(f)).toContain("TermosContent");
    }
    for (const f of [
      "src/routes/privacidade.tsx",
      "src/routes/app_.ajustes.ajuda.privacidade.tsx",
    ]) {
      expect(read(f)).toContain("PrivacidadeContent");
    }
  });

  it("rotas internas de ajuda permanecem no shell de Ajustes e voltam para Ajuda", () => {
    for (const f of [
      "src/routes/app_.ajustes.ajuda.suporte.tsx",
      "src/routes/app_.ajustes.ajuda.termos.tsx",
      "src/routes/app_.ajustes.ajuda.privacidade.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain("MobileShell");
      expect(src, f).toContain('backTo="/app/ajustes/ajuda"');
    }
  });

  it("layout de Ajuda entrega o Outlet e o Hub existe somente na rota index", () => {
    const layout = read("src/routes/app_.ajustes.ajuda.tsx");
    const index = read("src/routes/app_.ajustes.ajuda.index.tsx");
    expect(layout).toContain("<Outlet />");
    expect(layout).not.toContain("settings-help-hub");
    expect(index).toContain('data-testid="settings-help-hub"');
    expect(index).toContain('createFileRoute("/app_/ajustes/ajuda/")');
  });

  it("cada child de Ajuda possui conteúdo próprio e nunca inclui o Hub", () => {
    const children = [
      ["src/routes/app_.ajustes.ajuda.suporte.tsx", "settings-help-support", "SuportePage"],
      ["src/routes/app_.ajustes.ajuda.termos.tsx", "settings-help-terms", "TermosContent"],
      ["src/routes/app_.ajustes.ajuda.privacidade.tsx", "settings-help-privacy", "PrivacidadeContent"],
    ];
    for (const [file, testId, ownContent] of children) {
      const src = read(file);
      expect(src, file).toContain(`data-testid="${testId}"`);
      expect(src, file).toContain(ownContent);
      expect(src, file).not.toContain("settings-help-hub");
      expect(src, file).toContain('backTo="/app/ajustes/ajuda"');
    }
  });
});
