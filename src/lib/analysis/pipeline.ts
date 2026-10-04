import type { GenerateAnalysisRequest, ProfileResource } from "../../types/api.ts";
import type { JdDraft } from "../../types/jd-review.ts";
import type { JdItem, Report } from "../../types/job-copilot.ts";
import { invalid } from "../api/http.ts";
import { integer, nullable, object, text } from "../report/schema.ts";
import { JdError } from "../jd/content.ts";
import type { JdRepository } from "../jd/service.ts";
import { prepareConfirmedAnalysis } from "../jd/generation-context.ts";

export interface AnalysisMetadata {
  reportStructureVersion: "1.0.0";
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  testDataVersion: string | null;
}
export interface ConfirmedAnalysisWrite {
  userId: string;
  expectedProfileVersion: number;
  jdSnapshot: JdDraft;
  job: Pick<GenerateAnalysisRequest, "company" | "jobTitle" | "city" | "direction" | "jdSourceUrl">;
  jdItems: JdItem[];
  report: Report;
  metadata: AnalysisMetadata;
}
export function parseAnalysisRequest(value: unknown): GenerateAnalysisRequest {
  const errors: string[] = [];
  object({ company: text, jobTitle: text, city: nullable(text), direction: nullable(text), jdSourceUrl: nullable(text),
    requestId: text, draftId: text, expectedDraftRevision: integer, expectedProfileVersion: integer })(value, "input", errors);
  if (errors.length) throw invalid();
  const input = value as GenerateAnalysisRequest;
  if ([input.requestId, input.draftId].some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || [input.expectedDraftRevision, input.expectedProfileVersion].some((v) => !Number.isSafeInteger(v) || v < 1 || v > 2147483647)) throw invalid();
  if (input.company.length > 200 || input.jobTitle.length > 200 || (input.city?.length ?? 0) > 200
    || (input.direction?.length ?? 0) > 200 || (input.jdSourceUrl?.length ?? 0) > 2048) throw invalid();
  if (input.jdSourceUrl !== null) {
    try { const url = new URL(input.jdSourceUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw invalid(); }
    catch { throw invalid(); }
  }
  return { ...structuredClone(input), requestId: input.requestId.toLowerCase(), draftId: input.draftId.toLowerCase() };
}

/** Pure validation helper retained for unit tests; production entry is generateAnalysis.
 * This helper has no default writer or HTTP route and cannot call a legacy save RPC.
 * Caller supplies a verified session owner.
 * Model is invoked once, only after confirmation; invalid/stale results never reach store.
 * store MUST implement the atomic JD+profile recheck, not an ordinary table insert.
 */
export async function runConfirmedAnalysis<T>(userId: string, input: unknown, ports: {
  drafts: JdRepository;
  loadProfile: (userId: string) => Promise<ProfileResource | null>;
  model: (input: { instruction: string; data: string }) => Promise<unknown>;
  store: (input: ConfirmedAnalysisWrite) => Promise<T>;
  metadata: AnalysisMetadata;
}): Promise<T> {
  const request = parseAnalysisRequest(input);
  const metadata = structuredClone(ports.metadata); // server configuration, never model/browser metadata
  const prepare = () => prepareConfirmedAnalysis(userId, request, ports.drafts, ports.loadProfile);
  const before = await prepare();
  const candidate = await ports.model(structuredClone(before.modelInput));
  before.validateCandidate(candidate);
  const after = await prepare(); // catches changes during inference before attempting persistence
  if (after.jdSnapshot.confirmation?.digest !== before.jdSnapshot.confirmation?.digest) throw new JdError("JD_DRAFT_CONFLICT");
  const report = after.validateCandidate(candidate);
  const { company, jobTitle, city, direction, jdSourceUrl } = request;
  return ports.store({ userId, expectedProfileVersion: after.profileVersion,
    jdSnapshot: after.jdSnapshot, jdItems: after.jdItems, job: { company, jobTitle, city, direction, jdSourceUrl },
    report: structuredClone(report), metadata });
}
