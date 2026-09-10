import { it, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const { fileToDataUrl } = await import("/dev-server/src/lib/nota/qr-scan");
it("filereader", async () => {
  const f = new File(["abc"], "a.jpg", { type: "image/jpeg" });
  const url = await fileToDataUrl(f);
  console.log("url", url.slice(0, 40));
  expect(url.startsWith("data:")).toBe(true);
});
