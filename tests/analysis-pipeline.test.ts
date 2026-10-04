import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JdDraft } from "../src/types/jd-review.ts";
import { runConfirmedAnalysis, type ConfirmedAnalysisWrite } from "../src/lib/analysis/pipeline.ts";
import { checkAnalysisError } from "../src/lib/analysis/repository.ts";
import { confirmedAnalysisFixture } from "./helpers/confirmed-analysis.ts";
import type { JdRepository } from "../src/lib/jd/service.ts";

function setup() {
  const fixture = confirmedAnalysisFixture();
  let draft: JdDraft | null = fixture.draft;
  let version = 1;
  let modelCalls = 0;
  const writes: ConfirmedAnalysisWrite[] = [];
  const repository: JdRepository = {
    load: async (userId) => userId === "A" ? structuredClone(draft) : null,
    create: async () => { throw new Error("unexpected draft write"); },
    replace: async () => { throw new Error("unexpected draft write"); },
    remove: async () => { throw new Error("unexpected draft write"); },
  };
  const request = { requestId: "11111111-1111-4111-8111-111111111111", company: "测试", jobTitle: "测试岗位", city: null, direction: null, jdSourceUrl: null,
    draftId: fixture.draft.id, expectedDraftRevision: 2, expectedProfileVersion: 1 };
  const ports = {
    drafts: repository,
    loadProfile: async () => ({ version, updatedAt: "2026-09-29T00:00:00Z", profile: {
      structureVersion: "1.0.0" as const, targetDirections: [], facts: [
        { factId: "P1", category: "project" as const, context: "personal_project" as const, statement: "个人学习实践" },
      ],
    } }),
    model: async (_input: { instruction: string; data: string }) => { modelCalls++; return structuredClone(fixture.report); },
    store: async (write: ConfirmedAnalysisWrite) => { writes.push(write); return { id: fixture.draft.id }; },
    metadata: { reportStructureVersion: "1.0.0" as const, promptVersion: "fixture-v1", modelProvider: "fixture", modelName: "no-model", testDataVersion: "synthetic-v1" },
  };
  return { fixture, request, ports, writes, modelCalls: () => modelCalls, setDraft: (value: JdDraft | null) => { draft = value; },
    changeProfile: () => { version++; } };
}
test("confirmed pipeline validates then stores frozen provenance and metadata once", async () => {
  const x = setup(); await runConfirmedAnalysis("A", x.request, x.ports);
  assert.equal(x.modelCalls(), 1); assert.equal(x.writes.length, 1);
  const write = x.writes[0];
  assert.equal(write.userId, "A"); assert.equal(write.expectedProfileVersion, 1);
  assert.deepEqual(write.jdSnapshot, x.fixture.draft); assert.deepEqual(write.jdItems, x.fixture.jdItems);
  assert.equal(write.metadata.modelProvider, "fixture"); assert.equal(Object.hasOwn(write.job, "jdText"), false);
});
test("unconfirmed/deleted/other-owner/stale or forged input never calls model or writes", async () => {
  for (const mode of ["unconfirmed", "deleted", "owner", "stale", "forged"] as const) {
    const x = setup();
    if (mode === "unconfirmed") x.setDraft({ ...x.fixture.draft, confirmation: null });
    if (mode === "deleted") x.setDraft(null);
    const input = mode === "stale" ? { ...x.request, expectedDraftRevision: 1 } : mode === "forged" ? { ...x.request, jdItems: x.fixture.jdItems } : x.request;
    await assert.rejects(runConfirmedAnalysis(mode === "owner" ? "B" : "A", input, x.ports));
    assert.equal(x.modelCalls(), 0); assert.equal(x.writes.length, 0);
  }
});
test("JD edits/deletion and profile edits during model execution cannot save stale output", async () => {
  for (const mode of ["jd", "deleted", "profile"]) {
    const x = setup(); const model = x.ports.model;
    x.ports.model = async (input) => {
      const result = await model(input);
      if (mode === "jd") x.setDraft({ ...x.fixture.draft, revision: 3, confirmation: null });
      if (mode === "deleted") x.setDraft(null);
      if (mode === "profile") x.changeProfile();
      return result;
    };
    await assert.rejects(runConfirmedAnalysis("A", x.request, x.ports));
    assert.equal(x.modelCalls(), 1); assert.equal(x.writes.length, 0);
  }
});
test("missing core coverage and model exception never write or retry", async () => {
  const x = setup(); let calls = 0;
  x.ports.model = async () => { calls++; return { ...x.fixture.report, coreDuties: [] }; };
  await assert.rejects(runConfirmedAnalysis("A", x.request, x.ports));
  assert.equal(x.writes.length, 0); assert.equal(calls, 1);
  x.ports.model = async () => { calls++; throw new Error("model unavailable"); };
  await assert.rejects(runConfirmedAnalysis("A", x.request, x.ports));
  assert.equal(x.writes.length, 0); assert.equal(calls, 2);
});
test("model changing its input cannot replace the server manifest", async () => {
  const x = setup();
  x.ports.model = async (input) => { input.data = "{}"; return structuredClone(x.fixture.report); };
  await runConfirmedAnalysis("A", x.request, x.ports);
  assert.deepEqual(x.writes[0].jdItems, x.fixture.jdItems);
});
test("RPC errors map only exact safe messages including legacy conflict codes", () => {
  for (const code of ["PT409", "40001"]) {
    for (const message of ["JD_DRAFT_CONFLICT", "PROFILE_VERSION_CONFLICT", "private unknown conflict"]) {
      assert.throws(() => checkAnalysisError({code,message}), (error: any) => {
        if (message === "private unknown conflict") {
          assert.equal(error.status,503); assert.ok(!error.message.includes(message));
        } else assert.equal(error.code,message);
        return true;
      });
    }
  }
});
