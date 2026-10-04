import test from "node:test";
import assert from "node:assert/strict";
import { authHandlers, type AuthPort } from "../src/lib/auth/handlers.ts";

process.env.APP_ORIGIN = "http://localhost:3000";
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/auth/sign-in", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function setup(overrides: Partial<AuthPort> = {}) {
  let created = 0;
  const auth: AuthPort = {
    getUser: async () => ({ data: { user: { id: "verified-owner" } }, error: null }),
    signInWithPassword: async () => ({ error: null }),
    signOut: async () => ({ error: null }), ...overrides,
  };
  return { handlers: authHandlers(async () => { created++; return auth; }), calls: () => created };
}
test("session validates user remotely and returns no token or ID", async () => {
  const { handlers } = setup();
  const r = await handlers.session();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await r.json(), { ok: true, data: { authenticated: true } });
});
test("session missing returns 401; Auth outage returns 503", async () => {
  for (const [status, expected] of [[400, 401], [503, 503]]) {
    const { handlers } = setup({ getUser: async () => ({ data: { user: null }, error: { status } }) });
    assert.equal((await handlers.session()).status, expected);
  }
});
test("sign-in forwards credentials, preserves password whitespace and respects rate limit", async () => {
  const credentials = { email: "test@example.com", password: " password " };
  const { handlers } = setup({ signInWithPassword: async (input) => { assert.deepEqual(input, credentials); return { error: { status: 429 } }; } });
  assert.equal((await handlers.signIn(request(credentials))).status, 429);
});
test("cross-origin and missing origin are denied before contacting auth", async () => {
  const s = setup();
  for (const origin of ["https://evil.test", "null", ""]) assert.equal((await s.handlers.signIn(request({}, origin))).status, 403);
  assert.equal(s.calls(), 0);
});
test("unknown owner field and bad inputs are rejected before contacting auth", async () => {
  const s = setup();
  for (const body of [null, {}, { email: "a@b.c", password: "pass", userId: "forged" }, { email: "wrong", password: "pass" }]) {
    assert.equal((await s.handlers.signIn(request(body))).status, 422);
  }
  assert.equal(s.calls(), 0);
});
test("chunked oversized body is rejected even without Content-Length", async () => {
  const s = setup();
  const r = await s.handlers.signIn(request({ email: "a@b.c", password: "x".repeat(65536) }));
  assert.equal(r.status, 413); assert.equal(s.calls(), 0);
});
test("invalid JSON and non-JSON cannot log in", async () => {
  const s = setup();
  for (const type of ["application/json", "text/plain"]) {
    const req = new Request("http://localhost:3000/api/auth/sign-in", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": type }, body: "{" });
    assert.equal((await s.handlers.signIn(req)).status, 422);
  }
  assert.equal(s.calls(), 0);
});
test("unexpected upstream error does not expose credentials or internal message", async () => {
  const s = setup({ getUser: async () => { throw new Error("secret-test-token"); } });
  const r = await s.handlers.session();
  assert.equal(r.status, 503); assert.ok(!(await r.text()).includes("secret-test-token"));
});
test("logout is scoped to the current session and validates empty body", async () => {
  let calls = 0;
  const s = setup({ signOut: async (options) => { calls++; assert.equal(options.scope, "local"); return { error: null }; } });
  assert.equal((await s.handlers.signOut(request({ scope: "global" }))).status, 422);
  assert.equal((await s.handlers.signOut(request({}))).status, 200);
  assert.equal(calls, 1);
});
