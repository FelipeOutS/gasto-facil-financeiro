import { type ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function MobileShell({
  children,
  hideNav = false,
}: {
  children: ReactNode;
  hideNav?: boolean;
}) {
  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28 safe-top">
        {children}
      </div>
      {!hideNav && <BottomNav />}
    </div>
  );
}
