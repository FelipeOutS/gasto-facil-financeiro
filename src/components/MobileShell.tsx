import { type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { DesktopSidebar } from "./DesktopSidebar";
import { AuthGate } from "./AuthGate";

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
  const showNav = !hideNav;

  const inner = (
    <div className="min-h-screen w-full">
      {showNav && <DesktopSidebar />}
      <div className={showNav ? "lg:pl-64" : ""}>
        <div
          className={
            "mx-auto flex min-h-screen w-full flex-col px-4 pb-28 safe-top sm:px-6 lg:pb-10 " +
            (wide
              ? "max-w-md md:max-w-3xl lg:max-w-6xl xl:max-w-7xl"
              : "max-w-md md:max-w-2xl lg:max-w-4xl")
          }
        >
          {children}
        </div>
      </div>
      {showNav && <BottomNav />}
    </div>
  );

  if (unprotected) return inner;
  return <AuthGate>{inner}</AuthGate>;
}
