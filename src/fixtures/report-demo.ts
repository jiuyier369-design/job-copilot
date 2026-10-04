import type { JobAnalysisRecord, JdItem } from "../types/job-copilot.ts";
import { reportPreviewCompleted, reportPreviewJdItems } from "./public-report.ts";
import { profilePreviewFacts } from "./public-profile.ts";

/** Entirely fictional publication fixture. Not a real candidate, employer or saved report. */
const jdItems: JdItem[] = reportPreviewJdItems.map(item => ({ ...item,
  kind: ["DEMO-JD-3", "DEMO-JD-6"].includes(item.jdId) ? "qualification" : item.jdId === "DEMO-JD-5" ? "preferred" : "core_duty",
}));
export const reportDemo: JobAnalysisRecord = {
  id: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  company: reportPreviewCompleted.company, jobTitle: reportPreviewCompleted.jobTitle, city: null, direction: "客户成功",
  jdText: jdItems.map(item => item.exactText).join("\n"), jdSourceUrl: null, jdConfirmationSnapshot: null, jdItems,
  profileVersion: 1, profileSnapshot: { structureVersion: "1.0.0", targetDirections: ["客户成功"], facts: profilePreviewFacts.map((fact, index) => ({ factId: fact.factId, statement: fact.statement,
    category: index === 0 ? "education" : index === 2 ? "skill" : "project",
    context: index === 0 ? "education" : index === 1 ? "personal_project" : index === 2 ? "self_report" : "campus",
  })) },
  report: reportPreviewCompleted.report, reportStructureVersion: "1.0.0", promptVersion: "publication-fictional",
  modelProvider: "fixture", modelName: "fictional-display", testDataVersion: "public-fictional-v1",
  createdAt: "2026-10-04T00:00:00.000Z",
};
