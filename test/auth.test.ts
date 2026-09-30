import test from "node:test";
import assert from "node:assert/strict";
import { validBasicAuth, sameSecret } from "../src/auth";
const basic = (s: string) => "Basic " + Buffer.from(s).toString("base64");
test("Dashboard login rejects missing and incorrect credentials", () => {
  assert.equal(validBasicAuth(null, "owner", "secret"), false);
  assert.equal(validBasicAuth(basic("owner:wrong"), "owner", "secret"), false);
  assert.equal(validBasicAuth(basic("owner:secret"), "owner", "secret"), true);
  assert.equal(
    validBasicAuth(basic("owner:sec:ret"), "owner", "sec:ret"),
    true,
  );
  assert.equal(validBasicAuth(basic(":"), "", ""), false);
});
test("Engine secret comparison rejects missing and unequal tokens", () => {
  assert.equal(sameSecret("", "a".repeat(32)), false);
  assert.equal(sameSecret("a".repeat(32), "b".repeat(32)), false);
  assert.equal(sameSecret("a".repeat(32), "a".repeat(32)), true);
});
