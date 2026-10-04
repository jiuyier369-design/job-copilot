import type { ProfileResource } from "../../types/api.ts";
import { ApiError } from "../api/http.ts";
import { buildModelInput } from "../report/model-input.ts";
import { validateGeneratedReport } from "../report/validate-generated.ts";
import { jdService, type JdRepository } from "./service.ts";

export interface ConfirmedAnalysisReference { draftId: string; expectedDraftRevision: number; expectedProfileVersion: number }
/** Server composition boundary. No model/network call, no persistence, no browser-supplied manifest. */
export async function prepareConfirmedAnalysis(userId: string, reference: ConfirmedAnalysisReference,
  repository: JdRepository, loadProfile: (userId: string) => Promise<ProfileResource | null>) {
  const confirmed = await jdService(repository).requirements(userId, reference.draftId, reference.expectedDraftRevision);
  const profile = await loadProfile(userId);
  if (!profile || !profile.profile.facts.length) throw new ApiError(409, "PROFILE_REQUIRED", "请先保存至少一条真实画像事实。");
  if (profile.version !== reference.expectedProfileVersion) throw new ApiError(409, "PROFILE_VERSION_CONFLICT", "画像已更新，请重新核对后分析。");
  const context = structuredClone({ jdText: confirmed.jdText, jdItems: confirmed.jdItems, profile: profile.profile });
  return {
    modelInput: buildModelInput(context),
    jdItems: structuredClone(context.jdItems),
    profileVersion: profile.version,
    profileSnapshot: structuredClone(profile.profile),
    // Kept separately from model input, to be stored with the future report transaction.
    jdSnapshot: structuredClone(confirmed.draft),
    validateCandidate(candidate: unknown) { return validateGeneratedReport(candidate, context); },
  };
}
