import { describe, it, expect } from "vitest";
import { sign, verify } from "../src/hmac";
describe("hmac", () => {
  const secret = "test-secret";
  it("verifies a correctly signed body", () => {
    const body = JSON.stringify({ steamid: "123", n: 1 });
    expect(verify(secret, body, sign(secret, body))).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = sign(secret, JSON.stringify({ steamid: "123" }));
    expect(verify(secret, JSON.stringify({ steamid: "999" }), sig)).toBe(false);
  });
});
