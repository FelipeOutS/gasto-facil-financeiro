import { test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { bindVaultAutoLock, watchVaultVersion } from "../src/lib/vault/v2/lifecycle";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("v2 idle lock expires once, activity extends it, disposal cancels it", async () => {
  let locks = 0;
  const dispose = bindVaultAutoLock(() => locks++, 60);
  await delay(30);
  window.dispatchEvent(new Event("pointerdown"));
  await delay(40);
  expect(locks).toBe(0);
  await delay(40);
  expect(locks).toBe(1);
  window.dispatchEvent(new Event("keydown"));
  await delay(70);
  expect(locks).toBe(1);
  dispose();
  const cancel = bindVaultAutoLock(() => locks++, 20);
  cancel();
  await delay(40);
  expect(locks).toBe(1);
});

test("another session version change or failed check locks once; unmounted checks never relock", async () => {
  let version = 0,
    locks = 0;
  const dispose = watchVaultVersion(
    async () => version,
    0,
    () => locks++,
    15,
  );
  await delay(35);
  expect(locks).toBe(0);
  version = 1;
  await delay(40);
  expect(locks).toBe(1);
  dispose();
  const stop = watchVaultVersion(
    async () => {
      throw Error("network");
    },
    0,
    () => locks++,
    15,
  );
  await delay(40);
  expect(locks).toBe(2);
  stop();
  let finish!: (n: number) => void;
  const cancel = watchVaultVersion(
    () =>
      new Promise<number>((r) => {
        finish = r;
      }),
    0,
    () => locks++,
    15,
  );
  await delay(30);
  cancel();
  finish(9);
  await delay(15);
  expect(locks).toBe(2);
});
