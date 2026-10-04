import { createHash } from 'node:crypto';
import type { GenerateWithPlanRequest, LocalPlanRecord, PlanMaterial } from '../../types/evidence-plan-protocol.ts';
import type { AnalysisMetadata } from '../analysis/pipeline.ts';
import { parseAnalysisRequest } from '../analysis/pipeline.ts';
import { requestFingerprint } from '../analysis/runs.ts';
import { object, integer, text, nullable, oneOf } from '../report/schema.ts';
import { compileLocalPlan, PlanProtocolError, readLocalPlan } from './protocol.ts';

/** Proposal-only v2 namespace. Current v1 parser, fingerprints, runs and Worker remain unchanged. */
export function parseGenerateWithPlan(value: unknown): GenerateWithPlanRequest {
  const errors: string[] = [];
  object({ contractVersion: oneOf('analysis-request-v2'), planId: text, expectedPlanRevision: integer,
    requestId: text, draftId: text, expectedDraftRevision: integer, expectedProfileVersion: integer,
    company: text, jobTitle: text, city: nullable(text), direction: nullable(text), jdSourceUrl: nullable(text) })(value, 'v2', errors);
  if (errors.length) throw new PlanProtocolError('INVALID_INPUT', 422);
  const { contractVersion, planId, expectedPlanRevision, ...base } = value as GenerateWithPlanRequest;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)
    || !Number.isSafeInteger(expectedPlanRevision) || expectedPlanRevision < 1 || expectedPlanRevision > 2147483647) throw new PlanProtocolError('INVALID_INPUT', 422);
  try { return { ...parseAnalysisRequest(base), contractVersion, planId: planId.toLowerCase(), expectedPlanRevision }; }
  catch { throw new PlanProtocolError('INVALID_INPUT', 422); }
}
export interface PlanGenerationLock {
  ownerId: string;
  request: GenerateWithPlanRequest;
  metadata: AnalysisMetadata;
  jdDigest: string;
  sourceDigest: string;
  planDigest: string;
  fingerprint: string;
}
function fingerprint(ownerId: string, request: GenerateWithPlanRequest, lock: Omit<PlanGenerationLock, 'fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify(['analysis-request-v2',
    requestFingerprint(ownerId, request, lock.jdDigest, lock.metadata), request.planId,
    request.expectedPlanRevision, lock.sourceDigest, lock.planDigest])).digest('hex');
}
export function lockPlanGeneration(ownerId: string | null, record: LocalPlanRecord | null,
  current: PlanMaterial, value: unknown, metadata: AnalysisMetadata): PlanGenerationLock {
  const request = parseGenerateWithPlan(value);
  const resource = readLocalPlan(ownerId, record, current);
  if (resource.id !== request.planId) throw new PlanProtocolError('NOT_FOUND', 404);
  if (resource.status === 'stale') throw new PlanProtocolError('PLAN_SOURCE_CHANGED', 409);
  if (request.expectedPlanRevision !== resource.revision) throw new PlanProtocolError('PLAN_CONFLICT', 409);
  if (!resource.confirmation) throw new PlanProtocolError('PLAN_REVIEW_REQUIRED', 409);
  if (request.draftId !== resource.binding.draftId || request.expectedDraftRevision !== resource.binding.draftRevision
    || request.expectedProfileVersion !== resource.binding.profileVersion) throw new PlanProtocolError('PLAN_SOURCE_CHANGED', 409);
  const compiled = compileLocalPlan(record!);
  if (compiled.planDigest !== resource.confirmation.planDigest || resource.confirmation.sourceDigest !== resource.sourceDigest
    || resource.confirmation.revision !== resource.revision) throw new PlanProtocolError('PLAN_SOURCE_CHANGED', 409);
  const lock = { ownerId: ownerId!, request, metadata: structuredClone(metadata),
    jdDigest: resource.binding.confirmationDigest, sourceDigest: resource.sourceDigest, planDigest: compiled.planDigest };
  return { ...lock, fingerprint: fingerprint(ownerId!, request, lock) };
}
/** Replay uses the immutable run lock, so exact old replays survive later plan edits/deletion.
 * A new revision/job/plan under that same requestId is a conflict, not a new execution. */
export function checkPlanReplay(ownerId: string | null, lock: PlanGenerationLock | null, value: unknown): void {
  if (!ownerId) throw new PlanProtocolError('UNAUTHENTICATED', 401);
  if (!lock || lock.ownerId !== ownerId) throw new PlanProtocolError('NOT_FOUND', 404);
  const request = parseGenerateWithPlan(value);
  if (fingerprint(ownerId, request, lock) !== lock.fingerprint) throw new PlanProtocolError('IDEMPOTENCY_CONFLICT', 409);
}
