import { describe, expect, test } from "bun:test";
import { isLocalDevPreview } from "../src/lib/local-dev-preview";

describe("prévia local de assinatura", () => {
  test.each(["localhost", "127.0.0.1", "::1", "[::1]", "192.168.0.176", "10.0.0.1", "172.16.0.1", "172.31.255.255"])(
    "aceita %s somente em DEV com flag explícita",
    (host) => {
      expect(isLocalDevPreview(true, "true", host)).toBe(true);
      expect(isLocalDevPreview(true, "false", host)).toBe(false);
      expect(isLocalDevPreview(false, "true", host)).toBe(false);
    },
  );

  test.each(["gastointeligente.com.br", "www.gastointeligente.com.br", "app.lovable.app", "192.169.0.1", "172.15.0.1", "172.32.0.1", "192.168.1.300", "localhost.example.com"])(
    "recusa %s mesmo com flag em DEV",
    (host) => {
      expect(isLocalDevPreview(true, "true", host)).toBe(false);
    },
  );
});
