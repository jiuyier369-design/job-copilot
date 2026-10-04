import test from "node:test";
import assert from "node:assert/strict";
import { createJdDemoAdapter } from "../src/lib/jd/demo-adapter.ts";
import { jdDemoText, jdSuggestedDemo, jdConfirmedDemo } from "../src/fixtures/jd-review-demo.ts";
import { draftDigest } from "../src/lib/jd/service.ts";
import { jdReviewView } from "../src/lib/jd/view-state.ts";

test("demo follows lifecycle without fetching or mutating fixtures", async () => {
  const before = structuredClone(jdSuggestedDemo);
  const adapter = createJdDemoAdapter();
  const created = await adapter.execute({ action: "create", rawText: jdDemoText });
  assert.ok(created.ok && created.data); const draft = created.data;
  const result = await adapter.execute({ action: "confirm", id: draft.id, expectedRevision: draft.revision, acknowledged: true });
  assert.ok(result.ok && result.data?.confirmation);
  assert.notEqual(result.data.confirmation.digest, draftDigest(result.data));
  const changed = await adapter.execute({ action: "classify", id: draft.id, expectedRevision: 2, segmentId: "JD2", category: null });
  assert.ok(changed.ok && changed.data); assert.equal(changed.data.confirmation, null);
  assert.equal((await adapter.execute({ action: "confirm", id: draft.id, expectedRevision: 3, acknowledged: true })).ok, false);
  assert.deepEqual(jdSuggestedDemo, before);
});
test("demo transient error preserves current revision; delete clears state; stale commands fail", async () => {
  const adapter = createJdDemoAdapter({ initial: jdConfirmedDemo, failOnce: "SERVICE_UNAVAILABLE" });
  const command = { action: "delete" as const, id: jdConfirmedDemo.id, expectedRevision: 2 };
  assert.equal((await adapter.execute(command)).ok, false);
  assert.deepEqual(await adapter.execute(command), { ok: true, data: null });
  const repeated = await adapter.execute(command); assert.ok(!repeated.ok); assert.equal(repeated.error.code, "NOT_FOUND");
});
test("UI projection distinguishes suggested/confirmed and suspends confirmation for unsent edits or pending writes", () => {
  assert.equal(jdReviewView(jdSuggestedDemo, false, false).isConfirmed, false);
  assert.equal(jdReviewView(jdSuggestedDemo, false, false).canConfirm, true);
  assert.equal(jdReviewView(jdConfirmedDemo, false, false).isConfirmed, true);
  for (const [edited, pending] of [[true, false], [false, true], [true, true]]) {
    const view = jdReviewView(jdConfirmedDemo, edited, pending);
    assert.equal(view.isConfirmed, false); assert.equal(view.canConfirm, false);
  }
});
