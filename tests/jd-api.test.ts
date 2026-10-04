import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jdHandlers } from "../src/lib/jd/handlers.ts";
import { ApiError } from "../src/lib/api/http.ts";
import { jdRepository } from "../src/lib/jd/repository.ts";
import { transitionDraft } from "../src/lib/jd/transition.ts";
import { draftDigest, type JdRepository } from "../src/lib/jd/service.ts";
import { prepareConfirmedAnalysis } from "../src/lib/jd/generation-context.ts";
const id = "11111111-1111-4111-8111-111111111111";
const options = { id, now: "2026-09-29T00:00:00Z", digest: draftDigest };
const draft = transitionDraft(null, { action: "create", rawText: "岗位职责\n访谈客户" }, options)!;
function fake() {
  let calls = 0;
  const repository: JdRepository = {
    async load(userId) { calls++; assert.equal(userId, "session-owner"); return structuredClone(draft); },
    async create(userId, value) { calls++; assert.equal(userId, "session-owner"); return value; },
    async replace(userId, _version, value) { calls++; assert.equal(userId, "session-owner"); return value; },
    async remove(userId) { calls++; assert.equal(userId, "session-owner"); },
  };
  return { repository, count: () => calls };
}
const request = (body: unknown, origin: string | null = "http://localhost:3000") => new Request("http://localhost:3000/api/jd-drafts", {
  method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});
test("JD handler takes owner from session, returns no-store; browser cannot supply confirmation or owner", async () => {
  const { repository, count } = fake();
  const handler = jdHandlers(async () => ({ userId: "session-owner", repository }));
  for (const extra of [{ userId: "attacker" }, { confirmation: { digest: "fake" } }, { segments: [] }]) {
    assert.equal((await handler.POST(request({ action: "create", rawText: "JD", ...extra }))).status, 422);
  }
  assert.equal(count(), 0);
  const response = await handler.POST(request({ action: "create", rawText: "JD" }));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal((await response.json()).data.confirmation, null); assert.equal(count(), 1);
});
test("JD origin, unauthenticated, not found, conflict and invalid confirmation errors", async () => {
  const { repository, count } = fake();
  const handler = jdHandlers(async () => ({ userId: "session-owner", repository }));
  for (const origin of [null, "https://outside.invalid"]) {
    assert.equal((await handler.POST(request({ action: "create", rawText: "JD" }, origin))).status, 403);
  }
  assert.equal(count(), 0);
  const noAuth = jdHandlers(async () => { throw new ApiError(401, "UNAUTHENTICATED", "请登录"); });
  assert.equal((await noAuth.POST(request({ action: "create", rawText: "JD" }))).status, 401);
  assert.equal((await handler.POST(request({ action: "confirm", id, expectedRevision: 9, acknowledged: true }))).status, 409);
  const missing = jdHandlers(async () => ({ userId: "session-owner", repository: { ...repository, load: async () => null } }));
  assert.equal((await missing.GET(new Request(`http://localhost:3000/api/jd-drafts?id=${id}`))).status, 404);
});
test("privileged JD updates and deletion include owner, id AND revision predicates", async () => {
  const calls: unknown[][] = [];
  const row = { id, revision: 1, draft };
  const query = {
    select(...args: unknown[]) { calls.push(["select", ...args]); return this; },
    update(...args: unknown[]) { calls.push(["update", ...args]); return this; },
    delete() { calls.push(["delete"]); return this; },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return this; },
    maybeSingle: async () => ({ data: row, error: null }),
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [{ id }], error: null }).then(resolve); },
  };
  const repository = jdRepository({ from: () => query } as unknown as SupabaseClient);
  await repository.replace("owner-A", 1, draft);
  for (const [key, value] of [["user_id", "owner-A"], ["id", id], ["revision", 1]]) assert.ok(calls.some((c) => c[0] === "eq" && c[1] === key && c[2] === value));
  calls.length = 0;
  await repository.remove("owner-A", id, 1);
  assert.deepEqual(calls.filter((c) => c[0] === "eq"), [["eq", "user_id", "owner-A"], ["eq", "id", id], ["eq", "revision", 1]]);
});
test("generation context cannot load profile before JD confirmation; changed profile is rejected", async () => {
  const { repository } = fake(); let profileLoads = 0;
  const profile = { version: 1, updatedAt: options.now, profile: { structureVersion: "1.0.0" as const, targetDirections: [], facts: [
    { factId: "P1", category: "project" as const, context: "personal_project" as const, statement: "真实实践" },
  ] } };
  const load = async () => { profileLoads++; return profile; };
  const ref = { draftId: id, expectedDraftRevision: 1, expectedProfileVersion: 1 };
  await assert.rejects(prepareConfirmedAnalysis("session-owner", ref, repository, load));
  assert.equal(profileLoads, 0);
  const confirmed = transitionDraft(draft, { action: "confirm", id, expectedRevision: 1, acknowledged: true }, options)!;
  const ready = { ...repository, load: async () => confirmed };
  await assert.rejects(prepareConfirmedAnalysis("session-owner", { ...ref, expectedDraftRevision: 2, expectedProfileVersion: 2 }, ready, load));
  const context = await prepareConfirmedAnalysis("session-owner", { ...ref, expectedDraftRevision: 2 }, ready, load);
  assert.deepEqual(JSON.parse(context.modelInput.data).reviewedJdItems, [{ jdId: "JD2", kind: "core_duty", exactText: "访谈客户" }]);
  assert.throws(() => context.validateCandidate({}));
});
