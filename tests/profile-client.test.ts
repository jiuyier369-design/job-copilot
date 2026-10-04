import test from "node:test";
import assert from "node:assert/strict";
import { createProfileClient } from "../src/lib/profile/client.ts";
import { editorReducer, editorState, profilePayload } from "../src/lib/profile/editor-state.ts";
import type { ProfileResource } from "../src/types/api.ts";

const resource: ProfileResource = { version: 1, updatedAt: "2026-09-29T00:00:00Z", profile: {
  structureVersion: "1.0.0", targetDirections: ["客户成功"], facts: [
    { factId: "P1", category: "project", context: "personal_project", statement: "真实实践" },
  ],
} };
test("empty GET returns null, malformed stored profile is rejected", async () => {
  assert.deepEqual(await createProfileClient(async () => Response.json({ ok: true, data: null })).load(), { ok: true, data: null });
  for (const data of [{ ...resource, profile: null }, { ...resource, version: 0 }, { ...resource, updatedAt: "bad" }]) {
    assert.equal((await createProfileClient(async () => Response.json({ ok: true, data })).load()).ok, false);
  }
});
test("profile save sends only frozen fields and correct revision with same-origin cookies", async () => {
  let calls = 0;
  const client = createProfileClient(async (path, options) => {
    calls++; assert.equal(path, "/api/profile"); assert.equal(options?.method, "PUT");
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    assert.deepEqual(JSON.parse(String(options?.body)), { profile: resource.profile, expectedVersion: 1 });
    return Response.json({ ok: true, data: { ...resource, version: 2 } });
  });
  assert.equal((await client.save({ profile: resource.profile, expectedVersion: 1 })).ok, true);
  assert.equal(calls, 1);
});
test("PUT null/unchanged revision/error success response cannot masquerade as save", async () => {
  for (const data of [null, resource, { ...resource, version: 3 }]) {
    const result = await createProfileClient(async () => Response.json({ ok: true, data })).save({ profile: resource.profile, expectedVersion: 1 });
    assert.equal(result.ok, false);
  }
});
test("conflict returns safe error without retrying the write", async () => {
  let calls = 0;
  const result = await createProfileClient(async () => {
    calls++; return Response.json({ ok: false, error: { code: "PROFILE_VERSION_CONFLICT", message: "private-data" } }, { status: 409 });
  }).save({ profile: resource.profile, expectedVersion: 1 });
  assert.equal(calls, 1); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("private-data"));
});
test("timeout or network error preserves uncertain outcome instead of pretending success", async () => {
  assert.equal((await createProfileClient(async () => { throw new Error("sensitive"); }).save({ profile: resource.profile, expectedVersion: null })).ok, false);
});
test("conflict preserves modified draft and version, successful reload explicitly resets both", () => {
  let state = editorState(resource);
  state = editorReducer(state, { type: "edit", draft: { ...state.draft, facts: [{ ...state.draft.facts[0], statement: "新增真实细节" }] } });
  state = editorReducer(state, { type: "start" });
  const conflict = editorReducer(state, { type: "finish", result: { ok: false, error: { code: "PROFILE_VERSION_CONFLICT", message: "conflict" } } });
  assert.equal(conflict.version, 1); assert.equal(conflict.draft.facts[0].statement, "新增真实细节");
  assert.equal(conflict.conflict, true); assert.equal(conflict.dirty, true); assert.equal(conflict.busy, false);
  const reloaded = editorReducer(conflict, { type: "loaded", resource: { ...resource, version: 2 } });
  assert.equal(reloaded.version, 2); assert.equal(reloaded.conflict, false); assert.equal(reloaded.dirty, false);
});
test("401 preserves draft for login in another tab, edits are blocked during save", () => {
  const state = editorReducer(editorState(resource), { type: "start" });
  assert.equal(editorReducer(state, { type: "edit", directions: "overwrite" }), state);
  const expired = editorReducer(state, { type: "finish", result: { ok: false, error: { code: "UNAUTHENTICATED", message: "login" } } });
  assert.deepEqual(expired.draft, resource.profile); assert.equal(expired.needsLogin, true);
});
test("first save version null becomes server version; existing IDs survive trimming", () => {
  let state = editorState(null); assert.equal(state.version, null);
  state = editorReducer(state, { type: "edit", directions: " 客户成功 \n\nAI 产品", draft: { ...resource.profile, facts: [{ ...resource.profile.facts[0], period: "  " }] } });
  const payload = profilePayload(state);
  assert.equal(payload.facts[0].factId, "P1"); assert.equal(Object.hasOwn(payload.facts[0], "period"), false);
  assert.deepEqual(payload.targetDirections, ["客户成功", "AI 产品"]);
  const saved = editorReducer(state, { type: "finish", result: { ok: true, data: { ...resource, profile: payload } } });
  assert.equal(saved.version, 1); assert.equal(saved.dirty, false);
});
