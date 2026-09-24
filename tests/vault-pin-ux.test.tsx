import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
let configured = false,
  biometric = false,
  legacy = true,
  fail = false;
let calls: string[] = [];
const key = {} as CryptoKey;
const noop = () => {};
const ok = async () => {};
const status = () => ({ configured, failedAttempts: 0, lockedUntil: null });
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (o: any) => o,
  Link: ({ children, ...props }: any) => <a>{children}</a>,
}));
mock.module("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: "qa" } }) }));
mock.module("@/lib/use-plan", () => ({ usePlan: () => ({}) }));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("@/lib/vault/use-vault-bootstrap", () => ({ useVaultBootstrap: () => ({}) }));
mock.module("@/lib/vault/service", () => ({
  createVaultSettings: ok,
  fetchEntries: async () => [],
  createEntry: ok,
  updateEntry: ok,
  deleteEntry: ok,
  decryptOne: ok,
  rotateMasterKey: ok,
  buildEncryptedBackup: ok,
  assertCurrentVaultKey: async () => {
    calls.push("validate");
  },
}));
mock.module("@/lib/vault/crypto", () => ({
  createMasterKey: ok,
  unlockMasterKey: async () => {
    calls.push("master");
    return key;
  },
}));
mock.module("@/lib/vault/use-vault", () => ({
  useVaultKey: () => ({}),
  setMasterKey: () => calls.push("open"),
  getCachedSecret: noop,
  setCachedSecret: noop,
  evictCached: noop,
  clearSecretCache: noop,
}));
mock.module("@/lib/vault/native-pin", () => ({
  nativePinAvailable: () => true,
  getNativePinStatus: async () => status(),
  enrollNativePin: async (_id: string, pin: string) => {
    calls.push("enroll:" + pin);
    configured = true;
    return status();
  },
  unlockWithNativePin: async (_id: string, pin: string) => {
    calls.push("native:" + pin);
    if (fail) throw Error("PIN incorreto. 4 tentativas restantes.");
    return key;
  },
  clearNativePin: async () => {
    calls.push("clear-native");
  },
}));
mock.module("@/lib/vault/server-pin", () => ({
  getServerPinStatus: async () => ({
    configured: legacy,
    lockedUntil: null,
    failedAttempts: fail ? 1 : 0,
    updatedAt: null,
  }),
  unlockWithServerPin: async (_id: string, pin: string) => {
    calls.push("legacy:" + pin);
    if (fail) throw Error("PIN incorreto. 4 tentativas restantes.");
    return key;
  },
}));
mock.module("@/lib/vault/quick-unlock", () => ({
  getQuickUnlock: () =>
    biometric ? { kind: "native-vault", v: 2, userId: "qa", createdAt: 1 } : null,
  needsQuickUnlockMigration: () => false,
  migrateLegacyQuickUnlock: async () => false,
  disableQuickUnlock: ok,
  enableBiometricUnlock: ok,
  unlockWithBiometric: async () => {
    calls.push("biometric");
    return key;
  },
  isPlatformAuthenticatorAvailable: async () => true,
  biometricUnavailableReason: async () => null,
}));
const errors: string[] = [];
mock.module("sonner", () => ({
  toast: { success: noop, warning: noop, info: noop, error: (s: string) => errors.push(s) },
}));
const { UnlockView, QuickUnlockSettingsView } = await import("../src/routes/app_.cofre-pessoal");
const props = {
  userId: "qa",
  userLabel: "QA",
  settings: {
    user_id: "qa",
    salt: "s",
    verifier: "v",
    verifier_iv: "iv",
    iterations: 250000,
    hint: null,
  },
  onUnlocked: () => calls.push("done"),
};
beforeEach(() => {
  configured = false;
  biometric = false;
  legacy = true;
  fail = false;
  calls = [];
  errors.length = 0;
});
afterEach(cleanup);
async function enter(ui: any, value: string) {
  for (const d of value) fireEvent.click(ui.getByRole("button", { name: d, exact: true }));
}
test("biometric is primary from first render and unlocks only after key validation", async () => {
  biometric = true;
  const ui = render(<UnlockView {...props} />);
  expect(ui.getByRole("button", { name: "Desbloquear com biometria" })).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear com biometria" }));
  await waitFor(() => expect(calls).toEqual(["biometric", "validate", "open", "done"]));
});
test("native PIN shows exactly six positions and submits at six digits", async () => {
  configured = true;
  const ui = render(<UnlockView {...props} />);
  await waitFor(() => expect(ui.getByText("PIN de segurança")).toBeTruthy());
  expect(ui.container.querySelectorAll("span.h-3\\.5").length).toBe(6);
  await enter(ui, "123456");
  await waitFor(() => expect(calls).toEqual(["native:123456", "validate", "open", "done"]));
});
for (const value of ["1234", "12345", "1234567", "12345678"]) {
  test(`existing ${value.length}-digit PIN opens without enrollment or deletion`, async () => {
    const ui = render(<UnlockView {...props} />);
    await waitFor(() => expect(ui.getByLabelText("PIN de segurança")).toBeTruthy());
    expect(ui.container.textContent).not.toMatch(/legado|4 a 8|Keystore|migra/i);
    expect(ui.container.querySelectorAll("span.h-3\\.5").length).toBe(0);
    await enter(ui, value);
    expect(calls).toEqual([]);
    expect((ui.getByLabelText("PIN de segurança") as HTMLInputElement).type).toBe("password");
    fireEvent.click(ui.getByRole("button", { name: "Desbloquear com PIN" }));
    await waitFor(() => expect(calls).toEqual(["legacy:" + value, "validate", "open", "done"]));
  });
}
test("existing six-digit PIN waits for confirmation then preserves validated enrollment roundtrip", async () => {
  const ui = render(<UnlockView {...props} />);
  await waitFor(() => expect(ui.getByLabelText("PIN de segurança")).toBeTruthy());
  await enter(ui, "123456");
  expect(calls).toEqual([]);
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear com PIN" }));
  await waitFor(() =>
    expect(calls).toEqual([
      "legacy:123456",
      "validate",
      "enroll:123456",
      "native:123456",
      "validate",
      "open",
      "done",
    ]),
  );
});
test("incorrect PIN reports the existing failure and does not expose a key", async () => {
  fail = true;
  const ui = render(<UnlockView {...props} />);
  await waitFor(() => expect(ui.getByLabelText("PIN de segurança")).toBeTruthy());
  await enter(ui, "1234");
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear com PIN" }));
  await waitFor(() => expect(errors[0]).toContain("4 tentativas"));
  expect(calls).toEqual(["legacy:1234"]);
});
test("master password remains available and validates the key", async () => {
  legacy = false;
  const ui = render(<UnlockView {...props} />);
  fireEvent.change(ui.getByLabelText("Senha mestra", { exact: true }), {
    target: { value: "synthetic-password" },
  });
  fireEvent.submit(ui.container.querySelector("form")!);
  await waitFor(() => expect(calls).toEqual(["master", "validate", "open", "done"]));
});
test("settings put biometrics before PIN, hide technical migration details and require six digits", async () => {
  legacy = false;
  const ui = render(
    <QuickUnlockSettingsView userId="qa" userLabel="QA" masterKey={key} onBack={noop} />,
  );
  await waitFor(() =>
    expect(
      (ui.getByRole("button", { name: "Configurar biometria" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  const text = ui.container.textContent!;
  expect(text.indexOf("Biometria")).toBeLessThan(text.indexOf("PIN de 6 dígitos"));
  expect(text).not.toMatch(/legado|Keystore|migra|envelope|servidor/i);
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  const input = ui.container.querySelector("input")!;
  expect(input.type).toBe("password");
  for (const value of ["1234", "12345", "abc"]) {
    fireEvent.change(input, { target: { value } });
    expect((ui.getByRole("button", { name: "Continuar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  }
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(ui.getByRole("button", { name: "Continuar" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "123456" } });
  fireEvent.click(ui.getByRole("button", { name: "Salvar PIN" }));
  await waitFor(() => expect(calls).toEqual(["enroll:123456", "native:123456", "validate"]));
});
