import { createContext, useContext, type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { MobileNotificationsFab } from "./MobileNotificationsFab";
import { AuthGate } from "./AuthGate";
import { ExpiredAccessBanner } from "./ExpiredAccessBanner";
import { useSidebarCollapsed } from "@/lib/sidebar-collapsed";

/**
 * Sinaliza que o conteúdo já está dentro de um MobileShell persistente
 * renderizado no nível do root layout. Quando este contexto estiver `true`,
 * qualquer <MobileShell> aninhado dentro das páginas vira pass-through:
 * não re-renderiza AuthGate / Sidebar / TopBar / BottomNav / <main>,
 * apenas devolve `children`. Isso impede a sensação de "recarregar a tela"
 * ao navegar entre rotas — o shell deixa de remontar.
 */
const PersistentShellContext = createContext(false);

export function PersistentShellProvider({ children }: { children: ReactNode }) {
  return <PersistentShellContext.Provider value={true}>{children}</PersistentShellContext.Provider>;
}

export function MobileShell({
  children,
  hideNav = false,
  unprotected = false,
  wide = false,
}: {
  children: ReactNode;
  hideNav?: boolean;
  /** Skip the AuthGate. Use only for fully public screens (login, etc). */
  unprotected?: boolean;
  /** Use a wider container on desktop (good for dashboard with grids). */
  wide?: boolean;
}) {
  const insidePersistent = useContext(PersistentShellContext);

  // Pass-through: já existe um shell persistente acima. Não duplicamos
  // AuthGate/Sidebar/TopBar/BottomNav/<main>. Apenas devolvemos o conteúdo.
  // Props como `wide` e `hideNav` são resolvidas a nível de root pelo
  // pathname para preservar layout responsivo.
  const collapsed = useSidebarCollapsed();
  const showNav = !hideNav;

  if (insidePersistent) {
    return <>{children}</>;
  }

  const inner = (
    <div className="min-h-screen min-h-dvh w-full bg-background">
      {showNav && <DesktopSidebar />}
      {showNav && <MobileTopBar />}
      <div
        className={
          showNav
            ? collapsed
              ? "lg:pl-20 transition-[padding] duration-300"
              : "lg:pl-64 transition-[padding] duration-300"
            : ""
        }
      >
        <main
          className={
            "mx-auto flex w-full flex-col px-3 pt-4 pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-5 md:px-6 lg:min-h-screen lg:px-6 lg:pt-5 lg:pb-12 xl:px-7 2xl:px-8 " +
            (wide
              ? "max-width-md md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl"
              : "max-w-md md:max-w-2xl lg:max-w-3xl xl:max-w-4xl")
          }
          style={
            showNav
              ? { minHeight: "calc(100dvh - 3.5rem - max(0.75rem, env(safe-area-inset-top, 0px)))" }
              : { minHeight: "100dvh" }
          }
        >
          {!unprotected && <ExpiredAccessBanner />}
          <PersistentShellProvider>{children}</PersistentShellProvider>
        </main>
      </div>
      {showNav && <BottomNav />}
      {showNav && <MobileNotificationsFab />}
    </div>
  );

  if (unprotected) return inner;
  return <AuthGate>{inner}</AuthGate>;
}
