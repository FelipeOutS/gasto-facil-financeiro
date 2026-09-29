import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, waitFor, act } = await import("@testing-library/react");
let configured = false,
  biometric = false,
  legacy = true,
  fail = false;
let lockedUntil: number | null = null;
let lockOnAttempt = false;
let failServerStatus = false;
let calls: string[] = [];
const key = {} as CryptoKey;
const staleKey = {} as CryptoKey;
let rotated = false;
let mismatchOnAttempt = false;
let settingsReadFails = false;
let pendingSettings: Promise<any> | null = null;
let nativeCapable = true;
let wrongMasterPassword = false;
const noop = () => {};
const ok = async () => {};
const status = () => ({ configured, failedAttempts: lockedUntil ? 5 : 0, lockedUntil });
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
  assertCurrentVaultKey: async (id: string, candidate: CryptoKey) => {
    calls.push("validate");
    if (settingsReadFails) throw Error("Network unavailable");
    if (id === "qa" && pendingSettings) return pendingSettings;
    const settings = { ...props.settings, user_id: id, salt: rotated ? "new-salt" : props.settings.salt };
    if (candidate === staleKey) {
      await invalidateQuickCredentials(id, settings);
      throw new VaultKeyChangedError();
    }
    return settings;
  },
}));
mock.module("@/lib/vault/crypto", () => ({
  createMasterKey: ok,
  unlockMasterKey: async () => {
    calls.push("master");
    return wrongMasterPassword ? null : key;
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
  nativePinAvailable: () => nativeCapable,
  getNativePinStatus: async () => status(),
  enrollNativePin: async (_id: string, pin: string) => {
    calls.push("enroll:" + pin);
    configured = true;
    return status();
  },
  unlockWithNativePin: async (_id: string, pin: string) => {
    calls.push("native:" + pin);
    if (lockOnAttempt) {
      lockedUntil = Date.now() + 15 * 60_000;
      failServerStatus = true;
      throw Error("PIN temporariamente bloqueado.");
    }
    if (fail) throw Error("PIN incorreto. 4 tentativas restantes.");
    return mismatchOnAttempt ? staleKey : key;
  },
  clearNativePin: async () => {
    calls.push("clear-native");
    configured = false;
  },
}));
mock.module("@/lib/vault/server-pin", () => ({
  getServerPinStatus: async () => {
    if (failServerStatus) throw Error("Falha ao consultar status");
    return {
      configured: legacy,
      lockedUntil: null,
      failedAttempts: fail ? 1 : 0,
      updatedAt: null,
    };
  },
  unlockWithServerPin: async (_id: string, pin: string) => {
    calls.push("legacy:" + pin);
    if (fail) throw Error("PIN incorreto. 4 tentativas restantes.");
    return key;
  },
}));
mock.module("@/lib/vault/quick-unlock", () => ({
  getQuickUnlock: (id: string) =>
    biometric && id === "qa" ? { kind: "native-vault", v: 2, userId: "qa", createdAt: 1 } : null,
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
const { rememberQuickCredential, invalidateQuickCredentials, VaultKeyChangedError } =
  await import("../src/lib/vault/quick-unlock-state");
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
  rotated = false;
  mismatchOnAttempt = false;
  settingsReadFails = false;
  pendingSettings = null;
  nativeCapable = true;
  wrongMasterPassword = false;
  localStorage.clear();
  rememberQuickCredential("qa", "pin", props.settings);
  rememberQuickCredential("qa", "biometric", props.settings);
  configured = false;
  lockedUntil = null;
  lockOnAttempt = false;
  failServerStatus = false;
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
test("existing six-digit PIN opens without copying its digits into native enrollment", async () => {
  const ui = render(<UnlockView {...props} />);
  await waitFor(() => expect(ui.getByLabelText("PIN de segurança")).toBeTruthy());
  await enter(ui, "123456");
  expect(calls).toEqual([]);
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear com PIN" }));
  await waitFor(() => expect(calls).toEqual(["legacy:123456", "validate", "open", "done"]));
  expect(configured).toBe(false);
});
test("legacy PIN on web remains temporary; no server or native setup is offered", async () => {
  nativeCapable = false;
  const ui = render(settingsView());
  await waitFor(() => expect(ui.getAllByText(/Seu desbloqueio rápido precisa ser atualizado/).length).toBeGreaterThan(0));
  expect(ui.queryByRole("button", { name: "Configurar PIN de 6 dígitos" })).toBeNull();
  expect(calls).not.toContain("enroll:123456");
});
test("web can still unlock an existing legacy record and use the master password", async () => {
  nativeCapable = false;
  const ui = render(<UnlockView {...props} />);
  await waitFor(() => expect(ui.getByText(/Seu desbloqueio rápido precisa ser atualizado/)).toBeTruthy());
  await enter(ui, "123456");
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear com PIN" }));
  await waitFor(() => expect(calls).toEqual(["legacy:123456", "validate", "open", "done"]));
  expect(configured).toBe(false);
  ui.unmount();
  calls = [];
  const master = render(<UnlockView {...props} />);
  fireEvent.change(master.getByLabelText("Senha mestra", { exact: true }), {
    target: { value: "synthetic-password" },
  });
  fireEvent.submit(master.container.querySelector("form")!);
  await waitFor(() => expect(calls).toEqual(["master", "validate", "open", "done"]));
});
test("legacy update requires current master password and a separately entered new native PIN", async () => {
  const ui = render(settingsView());
  await waitFor(() => expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  expect(ui.getByLabelText("Senha mestra atual")).toBeTruthy();
  expect(ui.queryByText("PIN atual")).toBeNull();
  wrongMasterPassword = true;
  fireEvent.change(ui.getByLabelText("Senha mestra atual"), { target: { value: "wrong" } });
  fireEvent.click(ui.getByRole("button", { name: "Confirmar", exact: true }));
  await waitFor(() => expect(errors).toContain("Senha mestra incorreta."));
  expect(ui.getByLabelText("Senha mestra atual")).toBeTruthy();
  expect(calls.some(call => call.startsWith("enroll:"))).toBe(false);
  wrongMasterPassword = false;
  fireEvent.change(ui.getByLabelText("Senha mestra atual"), { target: { value: "correct" } });
  fireEvent.click(ui.getByRole("button", { name: "Confirmar", exact: true }));
  await waitFor(() => expect(ui.getByText("Crie um PIN de 6 dígitos")).toBeTruthy());
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "654321" } });
  fireEvent.click(ui.getByRole("button", { name: "Continuar" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "654321" } });
  fireEvent.click(ui.getByRole("button", { name: "Salvar PIN" }));
  await waitFor(() => expect(ui.getByRole("button", { name: "Alterar PIN" })).toBeTruthy());
  expect(calls).toContain("enroll:654321");
  expect(calls).toContain("native:654321");
  expect(calls).not.toContain("legacy:654321");
  expect(calls).not.toContain("enroll:123456");
});
test("switching accounts clears a legacy migration that had verified the previous password", async () => {
  const ui = render(settingsView());
  await waitFor(() => expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  fireEvent.change(ui.getByLabelText("Senha mestra atual"), { target: { value: "correct" } });
  fireEvent.click(ui.getByRole("button", { name: "Confirmar", exact: true }));
  await waitFor(() => expect(ui.getByText("Crie um PIN de 6 dígitos")).toBeTruthy());
  ui.rerender(settingsView("user-B"));
  expect(ui.queryByText("Crie um PIN de 6 dígitos")).toBeNull();
  await waitFor(() => expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  expect(ui.getByLabelText("Senha mestra atual")).toBeTruthy();
  expect(calls.some(call => call.startsWith("enroll:"))).toBe(false);
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
  await waitFor(() => expect(calls.filter((call) => call !== "validate")).toEqual(["enroll:123456", "native:123456"]));
  expect(calls.filter((call) => call === "validate").length).toBeGreaterThanOrEqual(2);
});

for (const hasBio of [true, false]) {
  test(`configured native PIN already locked prefers ${hasBio ? "biometrics" : "master password"}, never legacy`, async () => {
    configured = true;
    biometric = hasBio;
    lockedUntil = Date.now() + 15 * 60_000;
    const ui = render(<UnlockView {...props} />);
    await waitFor(() =>
      expect(ui.getByRole("status").textContent).toContain("temporariamente bloqueado"),
    );
    expect(ui.queryByLabelText("PIN de segurança")).toBeNull();
    expect(ui.queryByRole("button", { name: /^Usar PIN/ })).toBeNull();
    expect(ui.queryByRole("button", { name: "Desbloquear com PIN" })).toBeNull();
    if (hasBio) {
      fireEvent.click(ui.getByRole("button", { name: "Desbloquear com biometria" }));
    } else {
      fireEvent.change(ui.getByLabelText("Senha mestra", { exact: true }), {
        target: { value: "synthetic-password" },
      });
      fireEvent.submit(ui.container.querySelector("form")!);
    }
    await waitFor(() =>
      expect(calls).toEqual([hasBio ? "biometric" : "master", "validate", "open", "done"]),
    );
  });

  test(`attempt reaching native lockout uses fresh status and selects ${hasBio ? "biometrics" : "master password"} even if server status fails`, async () => {
    configured = true;
    biometric = hasBio;
    lockOnAttempt = true;
    const ui = render(<UnlockView {...props} />);
    if (hasBio) {
      await waitFor(() =>
        expect(ui.getByRole("button", { name: "Usar PIN de 6 dígitos" })).toBeTruthy(),
      );
      fireEvent.click(ui.getByRole("button", { name: "Usar PIN de 6 dígitos" }));
    }
    await waitFor(() => expect(ui.getByText("PIN de segurança")).toBeTruthy());
    expect(ui.container.querySelectorAll("span.h-3\\.5").length).toBe(6);
    await enter(ui, "123456");
    await waitFor(() =>
      expect(ui.getByRole("status").textContent).toContain("temporariamente bloqueado"),
    );
    expect(ui.queryByLabelText("PIN de segurança")).toBeNull();
    expect(ui.queryByRole("button", { name: /^Usar PIN/ })).toBeNull();
    if (hasBio) {
      expect(ui.getByRole("button", { name: "Desbloquear com biometria" })).toBeTruthy();
    } else {
      expect(ui.getByLabelText("Senha mestra", { exact: true })).toBeTruthy();
    }
    expect(calls).toEqual(["native:123456"]);
  });
}

function settingsView(id = "qa") {
  return <QuickUnlockSettingsView userId={id} userLabel="QA" masterKey={key} onBack={noop} />;
}
test("rotation immediately replaces change/remove actions with setup and remains so after remount", async () => {
  configured = true; biometric = true; legacy = false;
  const ui = render(settingsView());
  await waitFor(() => expect(ui.getByRole("button", { name: "Alterar PIN" })).toBeTruthy());
  rotated = true;
  await invalidateQuickCredentials("qa", { ...props.settings, salt: "new-salt" });
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(ui.queryByRole("button", { name: "Alterar PIN" })).toBeNull());
  expect(ui.queryByRole("button", { name: "Remover PIN" })).toBeNull();
  expect(ui.queryByRole("button", { name: "Remover biometria" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  expect(ui.queryByText("PIN atual")).toBeNull();
  ui.unmount();
  const again = render(settingsView());
  await waitFor(() => expect((again.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  expect(again.queryByRole("button", { name: "Alterar PIN" })).toBeNull();
});
test("rotation on web is detected on settings entry in the native container without a PIN attempt", async () => {
  configured = true; biometric = true; legacy = false; rotated = true;
  const ui = render(settingsView());
  await waitFor(() => expect(ui.getByText("Não configurado. Configure novamente o PIN.")).toBeTruthy());
  expect(ui.queryByRole("button", { name: "Alterar PIN" })).toBeNull();
  expect(calls.some(call => call.startsWith("native:") || call.startsWith("legacy:"))).toBe(false);
  expect(ui.queryByRole("button", { name: "Remover biometria" })).toBeNull();
});
test("late key mismatch clears current PIN and exits change flow without a verification loop", async () => {
  configured = true; legacy = false;
  const ui = render(settingsView());
  await waitFor(() => expect((ui.getByRole("button", { name: "Alterar PIN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Alterar PIN" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "123456" } });
  mismatchOnAttempt = true;
  fireEvent.click(ui.getByRole("button", { name: "Confirmar", exact: true }));
  await waitFor(() => expect(ui.queryByText("PIN atual")).toBeNull());
  expect(ui.queryByRole("button", { name: "Alterar PIN" })).toBeNull();
  expect(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" })).toBeTruthy();
  expect(ui.container.querySelector("input")).toBeNull();
  expect(calls.filter(call => call.startsWith("native:")).length).toBe(1);
});
test("after reset a newly confirmed PIN restores configured UI without asking for old PIN", async () => {
  rotated = true; legacy = false;
  await invalidateQuickCredentials("qa", { ...props.settings, salt: "new-salt" });
  const ui = render(settingsView());
  await waitFor(() => expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "654321" } });
  fireEvent.click(ui.getByRole("button", { name: "Continuar" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "654321" } });
  fireEvent.click(ui.getByRole("button", { name: "Salvar PIN" }));
  await waitFor(() => expect((ui.getByRole("button", { name: "Alterar PIN" }) as HTMLButtonElement).disabled).toBe(false));
  expect(calls).toContain("native:654321");
  expect(calls).not.toContain("native:123456");
});
test("read error disables setup without declaring a credential absent, retry restores status", async () => {
  configured = true; legacy = false; settingsReadFails = true;
  const ui = render(settingsView());
  await waitFor(() => expect(ui.getByRole("alert")).toBeTruthy());
  expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls).not.toContain("clear-native");
  settingsReadFails = false;
  fireEvent.click(ui.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect((ui.getByRole("button", { name: "Alterar PIN" }) as HTMLButtonElement).disabled).toBe(false));
});
test("switching user hides old configured state and current PIN, ignoring late reads from A", async () => {
  configured = true; legacy = false;
  const ui = render(settingsView());
  await waitFor(() => expect((ui.getByRole("button", { name: "Alterar PIN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "Alterar PIN" }));
  fireEvent.change(ui.container.querySelector("input")!, { target: { value: "123456" } });
  let resolve!: (value: unknown) => void;
  pendingSettings = new Promise(r => { resolve = r; });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  ui.rerender(settingsView("user-B"));
  expect(ui.queryByText("PIN atual")).toBeNull();
  expect(ui.queryByText("PIN protegido neste dispositivo.")).toBeNull();
  await act(async () => { resolve(props.settings); });
  await waitFor(() => expect((ui.getByRole("button", { name: "Configurar PIN de 6 dígitos" }) as HTMLButtonElement).disabled).toBe(false));
  expect(ui.queryByRole("button", { name: "Alterar PIN" })).toBeNull();
});
