import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { ProfileResource } from "../src/types/api.ts";
import { ApiError } from "../src/lib/api/http.ts";
import { parseProfileInput, profileConflict, profileHandlers, type ProfileRepository } from "../src/lib/profile/handlers.ts";
import { profileRepository } from "../src/lib/profile/repository.ts";

process.env.APP_ORIGIN = "http://localhost:3000";
const profile = { structureVersion: "1.0.0" as const, targetDirections: [], facts: [] };
const resource: ProfileResource = { profile, version: 1, updatedAt: "2026-09-28T00:00:00Z" };
const req = (body: unknown) => new Request("http://localhost:3000/api/profile", { method: "PUT", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(body) });
function setup(override: Partial<ProfileRepository> = {}) {
  const calls: unknown[][] = [];
  const repository: ProfileRepository = {
    load: async (...args) => { calls.push(args); return null; },
    create: async (...args) => { calls.push(args); return resource; },
    update: async (...args) => { calls.push(args); return { ...resource, version: 2 }; }, ...override,
  };
  return { calls, handlers: profileHandlers(async () => ({ userId: "session-owner", repository })) };
}
test("missing profile returns successful null using only verified owner", async () => {
  const s = setup(); const r = await s.handlers.GET();
  assert.deepEqual(await r.json(), { ok: true, data: null });
  assert.deepEqual(s.calls, [["session-owner"]]);
});
test("first save uses session ID; next save forwards expected version and returns server revision", async () => {
  const s = setup();
  assert.equal((await s.handlers.PUT(req({ profile, expectedVersion: null }))).status, 200);
  const next = await s.handlers.PUT(req({ profile, expectedVersion: 1 }));
  assert.equal((await next.json()).data.version, 2);
  assert.deepEqual(s.calls, [["session-owner", profile], ["session-owner", profile, 1]]);
});
test("owner spoof, malformed versions and duplicate facts never reach repository", async () => {
  const s = setup();
  const fact = { factId: "P1", category: "project", context: "personal_project", statement: "真实实践" };
  for (const value of [
    { profile, expectedVersion: null, userId: "another-user" },
    ...[undefined, 0, -1, 1.5, "1", 2147483648].map((expectedVersion) => ({ profile, expectedVersion })),
    { profile: { ...profile, facts: [fact, fact] }, expectedVersion: null },
    { profile: { ...profile, facts: [{ ...fact, statement: "" }] }, expectedVersion: null },
  ]) assert.equal((await s.handlers.PUT(req(value))).status, 422);
  assert.equal(s.calls.length, 0);
});
test("unauthenticated profile read and save fail closed", async () => {
  const h = profileHandlers(async () => { throw new ApiError(401, "UNAUTHENTICATED", "请登录"); });
  assert.equal((await h.GET()).status, 401);
  assert.equal((await h.PUT(req({ profile, expectedVersion: null }))).status, 401);
});
test("conflict preserves error contract and does not retry overwrite", async () => {
  let writes = 0;
  const s = setup({ update: async () => { writes++; throw profileConflict(); } });
  const r = await s.handlers.PUT(req({ profile, expectedVersion: 1 }));
  assert.equal(r.status, 409); assert.equal((await r.json()).error.code, "PROFILE_VERSION_CONFLICT");
  assert.equal(writes, 1);
});
test("empty profile is valid, input remains unchanged", () => {
  const input = { profile, expectedVersion: null }; const before = structuredClone(input);
  assert.deepEqual(parseProfileInput(input), before); assert.deepEqual(input, before);
});

// Exercise the real Supabase query builder with intercepted HTTP, not a fake query chain.
function db(reply: unknown, status = 200) {
  const requests: { url: URL; method: string; body: unknown }[] = [];
  const client = createClient("https://unit-test.supabase.co", "unit-test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
  return { repository: profileRepository(client), requests };
}
const row = { profile_data: profile, version: 2, updated_at: resource.updatedAt };
test("database update sends only profile_data with owner AND revision filters", async () => {
  const s = db([row]); const result = await s.repository.update("owner-a", profile, 1);
  assert.equal(result.version, 2);
  const r = s.requests[0];
  assert.equal(r.method, "PATCH"); assert.equal(r.url.searchParams.get("user_id"), "eq.owner-a");
  assert.equal(r.url.searchParams.get("version"), "eq.1"); assert.deepEqual(r.body, { profile_data: profile });
});
test("first database insert cannot choose initial revision or timestamp", async () => {
  const s = db({ ...row, version: 1 }); await s.repository.create("owner-a", profile);
  assert.deepEqual(s.requests[0].body, { user_id: "owner-a", profile_data: profile });
});
test("empty conditional update and duplicate insert become 409", async () => {
  await assert.rejects(db([]).repository.update("owner", profile, 1), (e: unknown) => e instanceof ApiError && e.status === 409);
  await assert.rejects(db({ code: "23505", message: "private database detail" }, 409).repository.create("owner", profile), (e: unknown) => e instanceof ApiError && e.status === 409);
});
test("corrupt stored profile is not exposed as valid data", async () => {
  await assert.rejects(db([{ ...row, profile_data: null }]).repository.load("owner"), (e: unknown) => e instanceof ApiError && e.status === 503);
});
