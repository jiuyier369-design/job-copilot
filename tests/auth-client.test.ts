import test from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../src/lib/auth/client.ts";

test("sign-in forwards exact password with same-origin cookies and verifies session", async () => {
  const calls: string[] = [];
  const client = createAuthClient(async (path, options) => {
    calls.push(String(path));
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    if (calls.length === 1) assert.deepEqual(JSON.parse(String(options?.body)), { email: "a@b.c", password: " pass " });
    return Response.json({ ok: true, data: { authenticated: true } });
  });
  assert.equal((await client.signIn({ email: "a@b.c", password: " pass " })).ok, true);
  assert.deepEqual(calls, ["/api/auth/sign-in", "/api/session"]);
});
test("cookie failure after successful POST cannot become signed-in UI", async () => {
  let calls = 0;
  const client = createAuthClient(async () => ++calls === 1
    ? Response.json({ ok: true, data: { authenticated: true } })
    : Response.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 }));
  assert.equal((await client.signIn({ email: "a@b.c", password: "secret" })).ok, false);
});
test("malformed responses, wrong success boolean and network failures fail closed", async () => {
  for (const send of [
    async () => Response.json({ ok: true, data: { authenticated: false } }),
    async () => new Response("<html>private error</html>", { status: 502 }),
    async () => Response.json({ ok: true, data: { authenticated: true } }, { status: 500 }),
    async () => { throw new Error("secret-value"); },
  ]) {
    const result = await createAuthClient(send).session();
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("secret-value"));
  }
});
test("failed login does not retry or expose server message", async () => {
  let calls = 0;
  const client = createAuthClient(async () => { calls++; return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "private upstream detail" } }, { status: 429 }); });
  const result = await client.signIn({ email: "a@b.c", password: "secret" });
  assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes("private upstream"));
  assert.equal(result.ok, false);
});
test("sign-out sends empty body and accepts only authenticated false", async () => {
  const client = createAuthClient(async (path, options) => {
    assert.equal(path, "/api/auth/sign-out"); assert.equal(options?.body, "{}");
    return Response.json({ ok: true, data: { authenticated: false } });
  });
  assert.deepEqual(await client.signOut(), { ok: true, data: { authenticated: false } });
});
