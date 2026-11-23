import { test, expect, mock, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...router,
  createFileRoute: () => (x: unknown) => x,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
mock.module("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("@/components/MobileShell", () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
mock.module("@/components/vault/CompanyLogo", () => ({ CompanyLogo: () => <span>Logo</span> }));
let emails = 0,
  changed = 0;
mock.module("@/lib/vault/v2/email.functions", () => ({
  vaultEmailFn: async () => {
    emails++;
    return { nonce: "nonce" };
  },
}));
const { Unlock, OpenVault } = await import("../src/routes/app_.cofre-novo");
const { VaultV2Password } = await import("../src/components/vault/VaultV2Password");
const { generateDek, encryptEntry, decryptEntry } = await import("../src/lib/vault/v2/keyslots");
const { wrapPassword } = await import("../src/lib/vault/v2/password");
const vault = { id: "v", user_id: "u", name: "Cofre", auto_lock_minutes: 5 };
const slot = {
  id: "s",
  vault_id: "v",
  user_id: "u",
  kind: "password",
  envelope: { ct: "encrypted" },
  revoked_at: null,
};
const store = {
  listSlots: async () => [slot],
  passwordAttempt: async () => {
    throw Error("senha_indisponivel");
  },
} as never;
afterEach(() => {
  cleanup();
  localStorage.clear();
  emails = 0;
  changed = 0;
});

test("real password unwrap opens original encrypted entry after remount/reload; wrong password never opens", async () => {
  const dek = await generateDek();
  const entry = await encryptEntry(dek, "preserved credential");
  const envelope = await wrapPassword(dek, "Uma senha independente segura!42", "u", "v");
  const persisted = JSON.parse(JSON.stringify({ ...slot, envelope }));
  const isolated = { passwordAttempt: async () => persisted } as never;
  const opened = mock(async (key: CryptoKey) => {
    expect(await decryptEntry(key, entry)).toBe("preserved credential");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const ui = render(
      <Unlock store={isolated} vault={vault} slots={[persisted]} onOpen={opened} />,
    );
    fireEvent.change(ui.getByLabelText("Senha do Cofre novo"), {
      target: { value: "Uma senha independente segura!42" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Desbloquear cofre" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(attempt + 1));
    cleanup();
  }
  const ui = render(<Unlock store={isolated} vault={vault} slots={[persisted]} onOpen={opened} />);
  const password = ui.getByLabelText("Senha do Cofre novo") as HTMLInputElement;
  fireEvent.change(password, { target: { value: "outra senha incorreta" } });
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear cofre" }));
  await waitFor(() => expect(password.value).toBe(""));
  expect(opened).toHaveBeenCalledTimes(2);
});
test("locked view exposes masked password, preference and email help; failures never open", async () => {
  const opened = mock(() => {});
  const ui = render(<Unlock store={store} vault={vault} slots={[slot] as never} onOpen={opened} />);
  const input = ui.getByLabelText("Senha do Cofre novo") as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: "wrong-password" } });
  fireEvent.click(ui.getByRole("button", { name: "Desbloquear cofre" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(opened).not.toHaveBeenCalled();
  fireEvent.change(ui.getByLabelText("Método preferido neste dispositivo"), {
    target: { value: "recovery" },
  });
  expect(localStorage.getItem("gi-vault-method:u:v")).toBe("recovery");
  fireEvent.click(ui.getByRole("button", { name: "Esqueci minha senha" }));
  expect(ui.getByText("Enviar código por e-mail")).toBeTruthy();
});
test("email proof alone cannot replace password or access plaintext", async () => {
  const ui = render(
    <VaultV2Password store={store} vault={vault} slots={[]} recovery onDone={() => changed++} />,
  );
  expect(ui.queryByLabelText("Confirmar nova senha")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Enviar código por e-mail" }));
  await waitFor(() => expect(ui.getByLabelText("Código de 6 dígitos")).toBeTruthy());
  expect(emails).toBe(1);
  expect(changed).toBe(0);
});
test("credentials use card grid, masked editor and detail dialog without touching legacy", async () => {
  const ui = render(
    <OpenVault
      store={store}
      vault={vault}
      dek={{} as CryptoKey}
      items={[
        {
          id: "e",
          updated_at: "",
          secret: {
            title: "Banco de teste",
            username: "teste",
            password: "secret",
            url: "",
            category: "Bancos",
            notes: "",
          },
        },
      ]}
      slots={[]}
      userId="u"
      onChange={async () => {}}
      onLock={() => {}}
    />,
  );
  expect(ui.container.querySelector("ul")?.className).toContain("sm:grid-cols-2");
  if (process.env.GI_VAULT_VISUAL_OUT)
    await Bun.write(process.env.GI_VAULT_VISUAL_OUT, ui.container.innerHTML);
  fireEvent.click(ui.getByRole("button", { name: "Banco de teste" }));
  expect(ui.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(ui.getByRole("dialog"), { key: "Escape" });
  cleanup();
  const edit = render(
    <OpenVault
      store={store}
      vault={vault}
      dek={{} as CryptoKey}
      items={[]}
      slots={[]}
      userId="u"
      onChange={async () => {}}
      onLock={() => {}}
    />,
  );
  fireEvent.click(edit.getByRole("button", { name: "Nova" }));
  expect((edit.getByLabelText("Senha") as HTMLInputElement).type).toBe("password");
});
