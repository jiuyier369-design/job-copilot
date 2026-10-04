import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { V2Material, V2OperationResult, V2Plan, V2PlanEnvelope, V2PlanResource,
  V2PlanRow, V2ReviewedSource, TextSpan } from '../../types/evidence-plan-v2.ts';
import { SOURCE_POLICY_V2 } from '../../types/evidence-plan-v2.ts';
import type { PlanOperationReceipt, PlanWriteFailure } from '../../types/evidence-plan-receipts.ts';
import { array, boolean, integer, nullable, object, oneOf, profileSchema, text, type Check } from '../report/schema.ts';
import { PlanProtocolError } from '../evidence-plan/protocol.ts';

// Explicit UTF-8 byte ordering matches SQL COLLATE "C", independent of host locale.
const byteCompare = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => byteCompare(a, b))
    .map(([k, item]) => `${JSON.stringify(k)}:${canonical(item)}`).join(',')}}` : JSON.stringify(v);
export const v2Hash = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
const clone = <T>(v: T): T => structuredClone(v);
const invalid = (): never => { throw new PlanProtocolError('INVALID_INPUT', 422); };
export const safeUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const note = (limit: number): Check => (v, _p, e) => { if (typeof v !== 'string' || v.length > limit) e.push('INVALID_INPUT'); };
export function exactSlice(s: string, span: TextSpan): string {
  const boundary = (i: number) => !(s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff
    && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff);
  if (![span.start, span.end].every(Number.isSafeInteger) || span.start < 0 || span.end <= span.start
    || span.end > s.length || !boundary(span.start) || !boundary(span.end)) return invalid();
  const result = s.slice(span.start, span.end); if (!result.trim()) return invalid(); return result;
}
const spanFields = { start: integer, end: integer };
const sourceSchema = object({ ...spanFields, factId: text, evidenceType: oneOf('qualification', 'background', 'same_task', 'transferable', 'personal_practice'), sectionKey: nullable(text) });
const requirementSchema = object({ ...spanFields, jdId: text, kind: oneOf('qualification', 'core_duty', 'preferred'), exactText: text,
  conditions: array(object({ ...spanFields, key: text, basisKind: oneOf('verified_date_rule', 'unresolved') })),
  sections: array(object({ ...spanFields, key: text, kind: oneOf('task', 'background') })) });
const materialSchema = object({ binding: object({ draftId: text, draftRevision: integer, confirmationDigest: text, profileVersion: integer }),
  jdText: text, requirements: array(requirementSchema), profile: profileSchema });
export function checkV2Material(value: unknown): V2Material {
  const errors: string[] = []; materialSchema(value, 'material', errors);
  if (errors.length) return invalid(); const m = value as V2Material;
  if (!safeUuid(m.binding.draftId) || !m.requirements.length || m.requirements.length > 500
    || ![m.binding.draftRevision, m.binding.profileVersion].every(n => Number.isSafeInteger(n) && n > 0 && n < 2147483647)
    || new Set(m.requirements.map(r => r.jdId)).size !== m.requirements.length
    || new Set(m.profile.facts.map(f => f.factId)).size !== m.profile.facts.length
    || Buffer.byteLength(JSON.stringify(m)) > 262144) return invalid();
  const keys = new Set<string>(); const occupied = new Set<number>();
  for (const r of m.requirements) {
    if (exactSlice(m.jdText, r) !== r.exactText || (r.kind === 'qualification' ? !r.conditions.length || r.sections.length
      : r.kind === 'core_duty' ? r.conditions.length || r.sections.length : r.conditions.length || !r.sections.length)) return invalid();
    for (let i = r.start; i < r.end; i++) { if (occupied.has(i)) return invalid(); occupied.add(i); }
    const parts = r.kind === 'qualification' ? r.conditions : r.sections; const covered = new Set<number>();
    for (const p of parts) {
      if (keys.has(p.key) || p.start < r.start || p.end > r.end) return invalid(); keys.add(p.key); exactSlice(m.jdText, p);
      for (let i = p.start; i < p.end; i++) { if (covered.has(i)) return invalid(); covered.add(i); }
    }
    if (parts.length) for (let i = r.start; i < r.end; i++) if (!/\s/.test(m.jdText[i]) && !covered.has(i)) return invalid();
  }
  // An enum-valid but contradictory profile cannot turn a personal project into employment.
  for (const f of m.profile.facts) if ((f.category === 'education') !== (f.context === 'education')) return invalid();
  return clone(m);
}
export function v2MaterialDigest(m: V2Material): string {
  const checked = checkV2Material(m);
  return v2Hash([SOURCE_POLICY_V2, checked.binding.draftId, checked.binding.draftRevision, checked.binding.confirmationDigest,
    checked.binding.profileVersion, checked.jdText, checked.requirements.map(r => [r.jdId, r.kind, r.exactText, r.start, r.end,
      r.conditions.map(p => [p.key, p.start, p.end, p.basisKind]), r.sections.map(p => [p.key, p.start, p.end, p.kind])]),
    checked.profile.structureVersion, checked.profile.targetDirections, checked.profile.facts.map(f =>
      [f.factId, f.category, f.context, f.statement, f.period ?? null, f.organization ?? null])]);
}
export function parseV2PlanEnvelope(value: unknown): V2PlanEnvelope {
  const cmd = value && typeof value === 'object' ? (value as { command?: { action?: string } }).command : null;
  const fields: Record<string, Check> | null = cmd?.action === 'create_plan' ? { action: oneOf('create_plan'), draftId: text, expectedDraftRevision: integer, expectedProfileVersion: integer }
    : cmd?.action === 'review_row' ? { action: oneOf('review_row'), expectedRevision: integer, jdId: text,
      choice: oneOf('limited_support', 'no_clue', 'pending'), selectedSources: array(sourceSchema), missingScope: note(800),
      pendingReason: note(300), intent: oneOf('save_progress', 'confirm_and_continue'), acknowledged: boolean }
    : cmd?.action === 'confirm_plan' ? { action: oneOf('confirm_plan'), expectedRevision: integer, acknowledged: boolean }
    : cmd?.action === 'delete' ? { action: oneOf('delete'), expectedRevision: integer } : null;
  if (!fields) return invalid(); const errors: string[] = [];
  object({ contractVersion: oneOf('evidence-plan-write/2'), operationId: text, command: object(fields) })(value, 'operation', errors);
  if (errors.length) return invalid(); const env = clone(value as V2PlanEnvelope);
  if (!safeUuid(env.operationId)) return invalid(); env.operationId = env.operationId.toLowerCase();
  const c = env.command; const versions = c.action === 'create_plan' ? [c.expectedDraftRevision, c.expectedProfileVersion] : [c.expectedRevision];
  if (versions.some(v => !Number.isSafeInteger(v) || v < 1 || v >= 2147483647)) return invalid();
  if (c.action === 'create_plan') { if (!safeUuid(c.draftId)) return invalid(); c.draftId = c.draftId.toLowerCase(); }
  if (c.action === 'confirm_plan' && c.acknowledged !== true) return invalid();
  if (c.action === 'review_row') {
    if (c.intent === 'confirm_and_continue' && (c.acknowledged !== true || c.choice === 'pending')) return invalid();
    if (c.intent === 'save_progress' && c.acknowledged !== false) return invalid();
    c.selectedSources.sort((a, b) => byteCompare(JSON.stringify([a.sectionKey, a.factId, a.start, a.end, a.evidenceType]), JSON.stringify([b.sectionKey, b.factId, b.start, b.end, b.evidenceType])));
  }
  return env;
}
export function reviewedSources(m: V2Material, jdId: string, selected: import('../../types/evidence-plan-v2.ts').V2SourceSelection[]): V2ReviewedSource[] {
  const item = m.requirements.find(r => r.jdId === jdId); if (!item) return invalid();
  const seen = new Set<string>();
  return selected.map(s => {
    const fact = m.profile.facts.find(f => f.factId === s.factId); if (!fact) return invalid();
    const quote = exactSlice(fact.statement, s); const section = item.sections.find(p => p.key === s.sectionKey);
    if (item.kind === 'preferred' ? !section : s.sectionKey !== null) return invalid();
    const identity = JSON.stringify([s.sectionKey, s.factId, s.start, s.end]);
    if (seen.has(identity) || selected.some(other => other !== s && other.sectionKey === s.sectionKey && other.factId === s.factId
      && other.start < s.end && other.end > s.start)) return invalid(); seen.add(identity);
    const fail = (): never => { throw new PlanProtocolError('EVIDENCE_NOT_ALLOWED', 422); };
    if (fact.category === 'preference' || fact.category === 'constraint') return fail();
    if (item.kind === 'qualification') {
      if (s.evidenceType !== 'qualification' || (fact.category !== 'education' && fact.context !== 'formal_work')) return fail();
    } else if (section?.kind === 'background') {
      if (s.evidenceType !== 'background' || fact.category !== 'education' || fact.context !== 'education') return fail();
    } else if (fact.category === 'education' || fact.context === 'self_report' || s.evidenceType === 'qualification' || s.evidenceType === 'background'
      || (fact.context === 'personal_project') !== (s.evidenceType === 'personal_practice')) return fail();
    return { factId: s.factId, start: s.start, end: s.end, evidenceType: s.evidenceType, sectionKey: s.sectionKey,
      sourceKey: `source/${v2Hash([jdId, s.sectionKey, s.factId, s.start, s.end, s.evidenceType])}`,
      quote, scene: fact.context };
  });
}
export const rowSourceDigest = (r: V2PlanRow) => v2Hash(r.sources);
export const rowDigest = (r: V2PlanRow) => v2Hash([r.jdId, r.choice, r.sources, r.existingAction, r.missingScope, r.pendingReason]);
export const planSourceDigest = (p: V2Plan) => v2Hash([p.materialDigest, p.rows.map(r => [r.jdId, r.sources])]);
export const confirmedPlanDigest = (p: V2Plan) => v2Hash([SOURCE_POLICY_V2, p.ownerId, p.id, p.revision, p.materialDigest,
  planSourceDigest(p), p.rows.map(r => [rowDigest(r), r.confirmation])]);
export function rowEligible(p: V2Plan, r: V2PlanRow): boolean {
  try {
    if (r.choice === 'pending' || !r.missingScope.trim() || !r.confirmation
      || r.confirmation.materialDigest !== p.materialDigest || r.confirmation.rowDigest !== rowDigest(r)
      || r.confirmation.rowSourceDigest !== rowSourceDigest(r) || !r.confirmation.confirmedAt) return false;
    if (r.choice === 'limited_support' ? !r.sources.length : r.sources.length > 0) return false;
    const verified = reviewedSources(p.material, r.jdId, r.sources);
    return isDeepStrictEqual(verified, r.sources) && r.existingAction === r.sources.map(s => s.quote).join('；');
  } catch { return false; }
}
export function readV2Plan(owner: string | null, p: V2Plan | null, current: V2Material | null | undefined): V2PlanResource {
  if (!owner) throw new PlanProtocolError('UNAUTHENTICATED', 401);
  if (!p || p.ownerId !== owner) throw new PlanProtocolError('NOT_FOUND', 404);
  const validity = current === undefined ? 'unverified' : current === null || v2MaterialDigest(current) !== p.materialDigest ? 'stale' : 'valid';
  const eligible = validity === 'valid' ? p.rows.filter(r => rowEligible(p, r)).map(r => r.jdId) : [];
  const validConfirmation = validity === 'valid' && v2MaterialDigest(p.material) === p.materialDigest
    && p.rows.length === p.material.requirements.length && new Set(p.rows.map(r => r.jdId)).size === p.rows.length
    && p.material.requirements.every(i => p.rows.some(r => r.jdId === i.jdId)) && eligible.length === p.rows.length
    && p.confirmation?.revision === p.revision && p.confirmation.sourceDigest === planSourceDigest(p) && p.confirmation.planDigest === confirmedPlanDigest(p);
  const { ownerId: _owner, ...resource } = clone(p);
  return { ...resource, confirmation: validConfirmation ? resource.confirmation : null, validity,
    status: validity === 'stale' ? 'stale' : validConfirmation ? 'confirmed' : 'draft', eligibleJdIds: eligible };
}
/** Single-process ledger simulation. No database transaction/concurrency/HTTP guarantees. */
export function createV2PlanSimulator() {
  const plans = new Map<string, V2Plan>();
  const operations = new Map<string, { fingerprint: string; receipt: PlanOperationReceipt }>();
  const key = (owner: string, id: string) => JSON.stringify([owner, id]);
  const failure = (code: PlanWriteFailure, status: 409 | 422): never => { throw Object.assign(new Error(code), { code, status }); };
  return {
    read: (owner: string | null, id: string, current: V2Material | null | undefined) => readV2Plan(owner, owner ? plans.get(key(owner, id)) ?? null : null, current),
    snapshot(owner: string, id: string): V2Plan | null { return clone(plans.get(key(owner, id)) ?? null); },
    receipt(owner: string | null, id: string): PlanOperationReceipt {
      if (!owner) throw new PlanProtocolError('UNAUTHENTICATED', 401);
      const found = operations.get(key(owner, id)); if (!found) throw new PlanProtocolError('NOT_FOUND', 404); return clone(found.receipt);
    },
    execute(owner: string | null, target: string | null, value: unknown, current: V2Material, now = '2026-10-03T00:00:00Z'): V2OperationResult {
      if (!owner) throw new PlanProtocolError('UNAUTHENTICATED', 401);
      const env = parseV2PlanEnvelope(value), c = env.command;
      if ((c.action === 'create_plan') !== (target === null) || (target !== null && !safeUuid(target))) return invalid();
      if (target !== null) target = target.toLowerCase();
      const fingerprint = v2Hash([env.contractVersion, owner, target, c]); const opKey = key(owner, env.operationId);
      const prior = operations.get(opKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) return failure('OPERATION_CONFLICT', 409);
        const id = prior.receipt.outcome === 'applied' ? prior.receipt.planId : target;
        const stored = id ? plans.get(key(owner, id)) : null;
        return { receipt: clone(prior.receipt), resource: stored ? readV2Plan(owner, stored, current) : null };
      }
      const original = target ? plans.get(key(owner, target)) : null;
      // Owner-scoped nonexistent/foreign objects never manufacture readable rejection records.
      if (c.action !== 'create_plan' && !original) throw new PlanProtocolError('NOT_FOUND', 404);
      let updated: V2Plan | null = null; let receipt: PlanOperationReceipt;
      try {
        const m = checkV2Material(current);
        if (c.action === 'create_plan') {
          if (c.draftId !== m.binding.draftId || c.expectedDraftRevision !== m.binding.draftRevision) failure('JD_DRAFT_CONFLICT', 409);
          if (c.expectedProfileVersion !== m.binding.profileVersion) failure('PROFILE_VERSION_CONFLICT', 409);
          updated = { id: env.operationId, ownerId: owner, revision: 1, policyVersion: SOURCE_POLICY_V2, material: m,
            materialDigest: v2MaterialDigest(m), confirmation: null, rows: m.requirements.map(r => ({ jdId: r.jdId, choice: 'pending', sources: [], existingAction: '', missingScope: '', pendingReason: '', confirmation: null })) };
        } else {
          if (c.expectedRevision !== original!.revision) failure('PLAN_CONFLICT', 409);
          if (c.action !== 'delete' && original!.materialDigest !== v2MaterialDigest(m)) failure('PLAN_SOURCE_CHANGED', 409);
          updated = clone(original!); updated.revision++; updated.confirmation = null;
          if (c.action === 'review_row') {
            const index = updated.rows.findIndex(r => r.jdId === c.jdId); if (index < 0) return invalid();
            const sources = reviewedSources(m, c.jdId, c.selectedSources);
            if (c.choice !== 'limited_support' && sources.length) failure('EVIDENCE_NOT_ALLOWED', 422);
            const r: V2PlanRow = { jdId: c.jdId, choice: c.choice, sources, existingAction: sources.map(s => s.quote).join('；'),
              missingScope: c.missingScope, pendingReason: c.pendingReason, confirmation: null };
            if (c.choice !== 'pending' && c.pendingReason) return invalid();
            if (c.intent === 'confirm_and_continue') {
              if (!r.missingScope.trim() || (r.choice === 'limited_support' && !sources.length)) failure('PLAN_REVIEW_REQUIRED', 409);
              r.confirmation = { rowDigest: rowDigest(r), rowSourceDigest: rowSourceDigest(r), materialDigest: updated.materialDigest, confirmedAt: now };
            }
            // Pending can save partial progress; a marked pending intent must have a reason.
            if (c.choice === 'pending' && !c.pendingReason.trim()) failure('PLAN_REVIEW_REQUIRED', 409);
            updated.rows[index] = r;
          } else if (c.action === 'confirm_plan') {
            if (!updated.rows.every(r => rowEligible(updated!, r))) failure('PLAN_REVIEW_REQUIRED', 409);
            updated.confirmation = { revision: updated.revision, sourceDigest: planSourceDigest(updated), planDigest: confirmedPlanDigest(updated) };
          }
        }
        receipt = { contractVersion: 'evidence-plan-receipt/2', operationId: env.operationId, operation: c.action, outcome: 'applied',
          planId: updated!.id, resultingRevision: updated!.revision, failureCode: null, resolvedAt: now };
      } catch (error) {
        const code = error instanceof PlanProtocolError ? error.code : (error as { code?: string }).code;
        const allowed = ['INVALID_INPUT', 'PLAN_CONFLICT', 'PLAN_SOURCE_CHANGED', 'JD_DRAFT_CONFLICT', 'PROFILE_VERSION_CONFLICT', 'EVIDENCE_NOT_ALLOWED', 'PLAN_REVIEW_REQUIRED'];
        if (!code || !allowed.includes(code)) throw new PlanProtocolError('SERVICE_UNAVAILABLE', 503);
        receipt = { contractVersion: 'evidence-plan-receipt/2', operationId: env.operationId, operation: c.action, outcome: 'rejected',
          planId: null, resultingRevision: null, failureCode: code as PlanWriteFailure, resolvedAt: now }; updated = null;
      }
      // Publish the simulated mutation+receipt only after all checks; no partial update on rejection.
      if (receipt.outcome === 'applied') {
        if (c.action === 'delete') plans.delete(key(owner, target!)); else plans.set(key(owner, updated!.id), updated!);
      }
      operations.set(opKey, { fingerprint, receipt: clone(receipt) });
      const stored = receipt.outcome === 'applied' ? plans.get(key(owner, receipt.planId)) : original;
      return { receipt: clone(receipt), resource: stored ? readV2Plan(owner, stored, current) : null };
    },
  };
}
