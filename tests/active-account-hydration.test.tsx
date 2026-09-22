import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, act, waitFor } = await import("@testing-library/react");
let viewer = "own",
  denyConnections = false;
mock.module("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: viewer } }) }));
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let owner = "",
        insert = false;
      const q: any = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (key === "user_id") owner = value;
          return q;
        },
        is: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        abortSignal: () => q,
        insert: () => {
          insert = true;
          return q;
        },
        then: (ok: any, bad: any) =>
          Promise.resolve(
            insert
              ? { data: [] }
              : table === "connected_accounts"
                ? {
                    data: denyConnections
                      ? null
                      : ["A", "B"].map((id) => ({
                          owner_user_id: id,
                          invited_email: id + "@example.invalid",
                          access_level: "view_create",
                          status: "accepted",
                        })),
                    error: denyConnections ? { message: "offline" } : null,
                  }
                : {
                    data:
                      table === "receitas"
                        ? [
                            {
                              id: owner + "-income",
                              user_id: owner,
                              descricao: owner,
                              valor: 10,
                              data: "2026-09-21",
                              tipo: "outros",
                              mes: 9,
                              ano: 2026,
                            },
                          ]
                        : [],
                  },
          ).then(ok, bad),
      };
      return q;
    },
  },
}));
const { ActiveAccountProvider, useActiveAccount } = await import("../src/lib/active-account");
const { getReceitas, useStore, getHydrationStatus, setActiveUserId } =
  await import("../src/lib/store");
let account: ReturnType<typeof useActiveAccount>;
function Probe() {
  account = useActiveAccount();
  const rows = useStore(getReceitas);
  return (
    <div data-testid="state">
      {account.activeOwnerId}:{account.loading ? "loading" : rows.map((r) => r.descricao).join(",")}
    </div>
  );
}
const setup = async () => {
  localStorage.setItem("gf:u:own:legacyMigrated", "1");
  const ui = render(
    <ActiveAccountProvider>
      <Probe />
    </ActiveAccountProvider>,
  );
  await waitFor(() => expect(account.loading).toBe(false));
  return ui;
};
afterEach(() => {
  cleanup();
  setActiveUserId(null);
  localStorage.clear();
  denyConnections = false;
});
for (const sequence of [
  ["own", "A"],
  ["A", "own"],
  ["A", "B", "A"],
  ["A", "B", "own"],
]) {
  test("hydrate each transition: " + sequence.join(" -> "), async () => {
    await setup();
    for (const owner of sequence) {
      await act(async () => {
        await account.switchTo(owner);
      });
      expect(account.activeOwnerId).toBe(owner);
      expect(account.loading).toBe(false);
      expect(getHydrationStatus()).toBe("ready");
      expect(getReceitas().map((r) => r.descricao)).toEqual([owner]);
    }
  });
}
test("connection query failure still hydrates own account", async () => {
  denyConnections = true;
  await setup();
  expect(getReceitas().map((r) => r.descricao)).toEqual(["own"]);
});
test("unknown connected account cannot be selected", async () => {
  await setup();
  await act(async () => account.switchTo("unauthorized"));
  expect(account.activeOwnerId).toBe("own");
});
