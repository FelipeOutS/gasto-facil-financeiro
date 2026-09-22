import { afterEach, beforeEach, expect, test } from "bun:test";
import { applyConsentAndMaybeLoadGtm } from "../src/lib/cookie-consent";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let scripts: Array<{ id: string; src: string }>;
let location: { pathname: string };
beforeEach(() => {
  scripts = [];
  location = { pathname: "/auth/android/callback" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: (id: string) => scripts.find((script) => script.id === id),
      createElement: () => ({}),
      head: { appendChild: (script: { id: string; src: string }) => scripts.push(script) },
    },
  });
});
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

test("callback never loads third-party tags even with existing consent", () => {
  applyConsentAndMaybeLoadGtm({ analytics: true, marketing: true });
  expect(scripts).toHaveLength(0);
});
test("consented tracking remains available once the clean app page is loaded", () => {
  location.pathname = "/app";
  applyConsentAndMaybeLoadGtm({ analytics: true, marketing: false });
  applyConsentAndMaybeLoadGtm({ analytics: true, marketing: false });
  expect(scripts).toHaveLength(1);
  expect(scripts[0].src).toContain("https://www.googletagmanager.com/gtm.js");
});
test("ordinary pages still respect denied optional cookies", () => {
  location.pathname = "/app";
  applyConsentAndMaybeLoadGtm({ analytics: false, marketing: false });
  expect(scripts).toHaveLength(0);
});
