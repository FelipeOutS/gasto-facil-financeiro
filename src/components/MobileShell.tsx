import { type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { AuthGate } from "./AuthGate";

export function MobileShell({
  children,
  hideNav = false,
  unprotected = false,
}: {
  children: ReactNode;
  hideNav?: boolean;
  /** Skip the AuthGate. Use only for fully public screens (login, etc). */
  unprotected?: boolean;
}) {
  const inner = (
    <div className="min-h-screen w-full">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28 safe-top">
        {children}
      </div>
      {!hideNav && <BottomNav />}
    </div>
  );

  if (unprotected) return inner;
  return <AuthGate>{inner}</AuthGate>;
}
