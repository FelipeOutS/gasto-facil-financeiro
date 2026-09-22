import { describe, expect, test } from "bun:test";
import { validateAndroidOAuthReturn } from "../src/lib/android-oauth";

describe("Android OAuth callback", () => {
  test("waits for session initialization, clears the URL and verifies the user", async () => {
    const calls: string[] = [];
    const status = await validateAndroidOAuthReturn(
      {
        getSession: async () => {
          calls.push("session");
          return { data: { session: {} }, error: null };
        },
        getUser: async () => {
          calls.push("user");
          return { data: { user: {} }, error: null };
        },
      },
      true,
      () => {
        calls.push("clear");
      },
    );
    expect(status).toBe("complete");
    expect(calls).toEqual(["session", "clear", "user"]);
  });

  test("does not treat a browser session as a completed app login", async () => {
    const status = await validateAndroidOAuthReturn(
      {
        getSession: async () => ({ data: { session: {} }, error: null }),
        getUser: async () => {
          throw new Error("Must not verify app login in browser");
        },
      },
      false,
      () => {},
    );
    expect(status).toBe("browser");
  });

  test("does not accept missing or failed sessions", async () => {
    for (const session of [null, {}]) {
      expect(
        await validateAndroidOAuthReturn(
          {
            getSession: async () => ({
              data: { session },
              error: session ? new Error("Rejected") : null,
            }),
            getUser: async () => {
              throw new Error("Unexpected user lookup");
            },
          },
          true,
          () => {},
        ),
      ).toBe("invalid-session");
    }
  });

  test("rejects a session that the auth server cannot validate", async () => {
    expect(
      await validateAndroidOAuthReturn(
        {
          getSession: async () => ({ data: { session: {} }, error: null }),
          getUser: async () => ({ data: { user: null }, error: new Error("Expired") }),
        },
        true,
        () => {},
      ),
    ).toBe("invalid-user");
  });

  test("clears the token URL even when SDK initialization throws", async () => {
    let cleared = false;
    await expect(
      validateAndroidOAuthReturn(
        {
          getSession: async () => {
            throw new Error("Network unavailable");
          },
          getUser: async () => ({ data: { user: null }, error: null }),
        },
        true,
        () => {
          cleared = true;
        },
      ),
    ).rejects.toThrow("Network unavailable");
    expect(cleared).toBe(true);
  });
});
