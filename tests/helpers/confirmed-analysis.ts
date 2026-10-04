import type { Report } from "../../src/types/job-copilot.ts";
import { transitionDraft } from "../../src/lib/jd/transition.ts";
import { draftDigest } from "../../src/lib/jd/service.ts";

/** Synthetic database/pipeline fixture, not a live model output or the three-JD corpus. */
export function confirmedAnalysisFixture(id = "33333333-3333-4333-8333-333333333333") {
  const options = { id, now: "2026-09-29T00:00:00Z", digest: draftDigest };
  const initial = transitionDraft(null, { action: "create", rawText: "岗位职责\n核对客户需求。\n任职要求\n本科毕业。\n公司介绍\n测试岗位。" }, options)!;
  const draft = transitionDraft(initial, { action: "confirm", id, expectedRevision: 1, acknowledged: true }, options)!;
  const report: Report = {
    materialFit: { level: "weak", summary: "尚缺任务证据。", supportingJdIds: [], limitingJdIds: ["JD2"] },
    applicationAction: { category: "try_with_weak_evidence", summary: "证据较弱，可由用户决定是否尝试。", verificationItemIndexes: [] },
    qualifications: [{ jdId: "JD4", status: "needs_confirmation", factIds: [], explanation: "需核对毕业条件。" }],
    coreDuties: [{ jdId: "JD2", evidenceType: "no_evidence", evidenceLinks: [], missingAspects: ["缺少同类经历证据。"], needsUserConfirmation: true, explanation: "暂无证据。" }],
    preferredItems: [], inferences: [], resumeSuggestions: [], verificationItems: [],
  };
  const jdItems = draft.segments.flatMap((s) => s.category && s.category !== "background"
    ? [{ jdId: s.id, kind: s.category, exactText: draft.rawText.slice(s.start, s.end) }] : []);
  return { initial, draft, report, jdItems };
}
