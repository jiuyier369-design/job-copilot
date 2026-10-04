import type { ProfileResource } from '../../types/api.ts';
import type { CreatePlanRequest, PlanMaterial } from '../../types/evidence-plan-protocol.ts';
import { integer, object, text } from '../report/schema.ts';
import { graduationChecks } from '../report/graduation.ts';
import { JdError } from '../jd/content.ts';
import { jdService, type JdRepository } from '../jd/service.ts';
import { materialDigest, PlanProtocolError } from './protocol.ts';

export function parsePlanCreate(value: unknown): CreatePlanRequest {
  const errors: string[] = [];
  object({ draftId: text, expectedDraftRevision: integer, expectedProfileVersion: integer })(value, 'create-plan', errors);
  const request = value as CreatePlanRequest;
  if (errors.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.draftId)
    || [request.expectedDraftRevision, request.expectedProfileVersion].some(v => !Number.isSafeInteger(v) || v < 1 || v > 2147483647))
    throw new PlanProtocolError('INVALID_INPUT', 422);
  return { ...request, draftId: request.draftId.toLowerCase() };
}
/** Mockable composition only. Caller obtains ownerId from a verified session.
 * Uses the existing JD confirmation/digest validator; no browser or model source catalogue. */
export async function loadPlanMaterial(ownerId: string | null, value: unknown, ports: {
  drafts: JdRepository; loadProfile: (ownerId: string) => Promise<ProfileResource | null>;
}): Promise<PlanMaterial> {
  if (!ownerId) throw new PlanProtocolError('UNAUTHENTICATED', 401);
  const request = parsePlanCreate(value);
  try {
    const jd = await jdService(ports.drafts).requirements(ownerId, request.draftId, request.expectedDraftRevision);
    const profile = await ports.loadProfile(ownerId);
    if (!profile || !profile.profile.facts.length) throw new PlanProtocolError('PROFILE_REQUIRED', 409);
    if (profile.version !== request.expectedProfileVersion) throw new PlanProtocolError('PROFILE_VERSION_CONFLICT', 409);
    const checks = graduationChecks({ jdText: jd.jdText, jdItems: jd.jdItems, profile: profile.profile });
    const material: PlanMaterial = { binding: { draftId: jd.draft.id, draftRevision: jd.draft.revision,
      confirmationDigest: jd.draft.confirmation!.digest, profileVersion: profile.version }, jdText: jd.jdText,
      jdItems: jd.jdItems, profile: profile.profile,
      qualificationDecisions: Object.fromEntries(checks.map(c => [c.jdId, c.requiredOverallStatus ?? 'needs_confirmation'])) };
    materialDigest(material);
    return structuredClone(material);
  } catch (error) {
    if (error instanceof PlanProtocolError) throw error;
    if (error instanceof JdError && ['NOT_FOUND', 'JD_REVIEW_REQUIRED', 'JD_DRAFT_CONFLICT'].includes(error.code))
      throw new PlanProtocolError(error.code as 'NOT_FOUND' | 'JD_REVIEW_REQUIRED' | 'JD_DRAFT_CONFLICT', error.code === 'NOT_FOUND' ? 404 : 409);
    throw new PlanProtocolError('SERVICE_UNAVAILABLE', 503);
  }
}
