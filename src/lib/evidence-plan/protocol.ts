import { createHash } from 'node:crypto';
import type { EvidencePlanSource, EvidenceReviewInput, EvidenceReviewRow } from '../../types/evidence-plan.ts';
import { PLAN_POLICY_VERSION, type LocalPlanRecord, type PlanCommand, type PlanErrorCode,
  type PlanMaterial, type PlanResource, type SourceProposal } from '../../types/evidence-plan-protocol.ts';
import { array, boolean, integer, object, oneOf, text, type Check } from '../report/schema.ts';
import { checkRow, checkSource, EvidencePlanError, initialReview } from './core.ts';
import { compileEvidencePlan } from './server.ts';

/** Local server-domain prototype only. No default database, HTTP handler, model or log sink. */
export class PlanProtocolError extends Error {
  readonly code: PlanErrorCode;
  readonly status: 401 | 404 | 409 | 422 | 503;
  constructor(code: PlanErrorCode, status: 401 | 404 | 409 | 422 | 503) {
    super(code); this.name = 'PlanProtocolError'; this.code = code; this.status = status;
  }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: PlanErrorCode, status: PlanProtocolError['status']): never => { throw new PlanProtocolError(code, status); };
const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const note = (value: unknown, path: string, errors: string[]) => {
  if (typeof value !== 'string' || value.length > 800) errors.push(path);
};
const evidenceType = oneOf('qualification', 'same_task', 'transferable', 'personal_practice');
const proposalSchema = object({ jdId: text, factId: text, start: integer, end: integer, evidenceType });
const rowSchema = object({ jdId: text, choice: oneOf('limited_support', 'no_clue', 'pending'),
  selections: array(object({ actionKey: text, evidenceType })), existingAction: note, missingScope: note });
export function parsePlanCommand(value: unknown): PlanCommand {
  if (!value || typeof value !== 'object') return fail('INVALID_INPUT', 422);
  const action = (value as { action?: unknown }).action;
  const common = { action: text, expectedRevision: integer };
  const fields: Record<string, Check> | null = action === 'add_source' ? { source: proposalSchema }
    : action === 'confirm_source' ? { key: text, acknowledged: boolean }
    : action === 'remove_source' ? { key: text }
    : action === 'save_row' ? { row: rowSchema }
    : action === 'confirm_row' ? { jdId: text }
    : action === 'confirm_plan' ? { acknowledged: boolean }
    : action === 'delete' ? {} : null;
  if (!fields) return fail('INVALID_INPUT', 422);
  const errors: string[] = []; object({ ...common, ...fields })(value, 'command', errors);
  const command = value as PlanCommand;
  if (errors.length || !positive(command.expectedRevision) || command.expectedRevision === 2147483647
    || ('acknowledged' in command && command.acknowledged !== true)) return fail('INVALID_INPUT', 422);
  return structuredClone(command);
}
function owns(ownerId: string | null, record: LocalPlanRecord | null): asserts record is LocalPlanRecord {
  if (!ownerId) fail('UNAUTHENTICATED', 401);
  if (!record || record.ownerId !== ownerId) fail('NOT_FOUND', 404);
}
function emptySource(material: PlanMaterial): EvidencePlanSource {
  return { binding: structuredClone(material.binding), jdText: material.jdText,
    jdItems: structuredClone(material.jdItems), profile: structuredClone(material.profile), actions: [],
    scopes: material.jdItems.map(item => ({ jdId: item.jdId, capabilities: [],
      ...(item.kind === 'qualification' && material.qualificationDecisions[item.jdId]
        ? { qualificationStatus: material.qualificationDecisions[item.jdId] } : {}) })) };
}
export function materialDigest(material: PlanMaterial): string {
  checkSource(emptySource(material));
  if (Object.keys(material.qualificationDecisions).some(id =>
    !material.jdItems.some(item => item.jdId === id && item.kind === 'qualification'))) fail('INVALID_INPUT', 422);
  // Pick fields in a stable order; arbitrary object insertion order is not material identity.
  return hash([PLAN_POLICY_VERSION, material.binding.draftId, material.binding.draftRevision,
    material.binding.confirmationDigest, material.binding.profileVersion, material.jdText,
    material.jdItems.map(i => [i.jdId, i.kind, i.exactText]), material.profile.structureVersion,
    material.profile.targetDirections, material.profile.facts.map(f =>
      [f.factId, f.category, f.context, f.statement, f.period ?? null, f.organization ?? null]),
    material.jdItems.map(i => [i.jdId, material.qualificationDecisions[i.jdId] ?? null])]);
}
export function createLocalPlan(ownerId: string | null, id: string, material: PlanMaterial): LocalPlanRecord {
  if (!ownerId) return fail('UNAUTHENTICATED', 401);
  return { id, ownerId, revision: 1, policyVersion: PLAN_POLICY_VERSION, material: structuredClone(material),
    materialDigest: materialDigest(material), nextSourceNumber: 1, sources: [],
    rows: initialReview(emptySource(material)).rows, confirmation: null };
}
function sliceBoundary(value: string, index: number) {
  const before = value.charCodeAt(index - 1), after = value.charCodeAt(index);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function verifyProposal(material: PlanMaterial, proposal: SourceProposal): string {
  const item = material.jdItems.find(i => i.jdId === proposal.jdId);
  const fact = material.profile.facts.find(f => f.factId === proposal.factId);
  if (!item || !fact || !Number.isSafeInteger(proposal.start) || !Number.isSafeInteger(proposal.end)
    || proposal.start < 0 || proposal.end <= proposal.start || proposal.end > fact.statement.length
    || !sliceBoundary(fact.statement, proposal.start) || !sliceBoundary(fact.statement, proposal.end)) return fail('INVALID_INPUT', 422);
  const quote = fact.statement.slice(proposal.start, proposal.end);
  if (!quote.trim()) return fail('INVALID_INPUT', 422);
  if (fact.category === 'preference' || fact.category === 'constraint') return fail('EVIDENCE_NOT_ALLOWED', 422);
  if (item.kind === 'qualification') {
    if (proposal.evidenceType !== 'qualification' || (fact.category !== 'education' && fact.context !== 'formal_work')) return fail('EVIDENCE_NOT_ALLOWED', 422);
  } else {
    if (fact.category === 'education' || fact.context === 'education' || fact.context === 'self_report'
      || proposal.evidenceType === 'qualification') return fail('EVIDENCE_NOT_ALLOWED', 422);
    if (fact.context === 'personal_project' && proposal.evidenceType !== 'personal_practice') return fail('EVIDENCE_NOT_ALLOWED', 422);
    if (fact.context !== 'personal_project' && proposal.evidenceType === 'personal_practice') return fail('EVIDENCE_NOT_ALLOWED', 422);
  }
  return quote;
}
function compiledSource(record: LocalPlanRecord): EvidencePlanSource {
  const source = emptySource(record.material);
  for (const entry of record.sources.filter(s => s.reviewed)) {
    // A per-requirement, user-reviewed association, NOT an inferred reusable capability label.
    const capability = `reviewed-association/${entry.jdId}`;
    source.actions.push({ key: entry.key, factId: entry.factId, quote: entry.quote, capability });
    const scope = source.scopes.find(s => s.jdId === entry.jdId)!;
    if (!scope.capabilities.includes(capability)) scope.capabilities.push(capability);
  }
  return source;
}
export function planOptions(record: LocalPlanRecord): PlanResource['options'] {
  return Object.fromEntries(record.material.jdItems.map(item => [item.jdId,
    record.sources.filter(s => s.jdId === item.jdId && s.reviewed).map(s => {
      const fact = record.material.profile.facts.find(f => f.factId === s.factId)!;
      return { actionKey: s.key, evidenceType: s.evidenceType, label: `${fact.factId} · ${s.evidenceType}`,
        factStatement: fact.statement, scene: fact.context, actionQuote: s.quote };
    })]));
}
export function sourceDigest(record: LocalPlanRecord): string {
  return hash([record.policyVersion, record.materialDigest, record.sources.map(s =>
    [s.key, s.jdId, s.factId, s.start, s.end, s.quote, s.evidenceType, s.reviewed])]);
}
export function readLocalPlan(ownerId: string | null, record: LocalPlanRecord | null, current: PlanMaterial | null): PlanResource {
  owns(ownerId, record);
  const stale = current === null || record.materialDigest !== materialDigest(current) || Boolean(record.confirmation &&
    (record.confirmation.revision !== record.revision || record.confirmation.sourceDigest !== sourceDigest(record)));
  return { id: record.id, revision: record.revision, status: stale ? 'stale' : record.confirmation ? 'confirmed' : 'draft',
    binding: structuredClone(record.material.binding), sourceDigest: sourceDigest(record),
    confirmation: stale ? null : structuredClone(record.confirmation), jdText: record.material.jdText,
    requirements: structuredClone(record.material.jdItems), facts: structuredClone(record.material.profile.facts),
    sources: structuredClone(record.sources), rows: structuredClone(record.rows), options: planOptions(record) };
}
function verifyRow(record: LocalPlanRecord, row: EvidenceReviewRow) {
  const decision = record.material.qualificationDecisions[row.jdId];
  if (decision && decision !== 'needs_confirmation' && row.choice !== 'limited_support')
    return fail('PLAN_REVIEW_REQUIRED', 409); // User clicks cannot downgrade a reliable server date result.
  for (const selection of row.selections) {
    const entry = record.sources.find(s => s.key === selection.actionKey && s.jdId === row.jdId);
    if (!entry?.reviewed) return fail('SOURCE_REVIEW_REQUIRED', 409);
    if (entry.evidenceType !== selection.evidenceType) return fail('EVIDENCE_NOT_ALLOWED', 422);
  }
  try { checkRow(compiledSource(record), row); }
  catch (error) {
    if (error instanceof EvidencePlanError && error.code === 'REVIEW_REQUIRED') return fail('PLAN_REVIEW_REQUIRED', 409);
    return fail('EVIDENCE_NOT_ALLOWED', 422);
  }
}
export function compileLocalPlan(record: LocalPlanRecord) {
  if (record.rows.some(row => !row.checked || row.choice === 'pending')) return fail('PLAN_REVIEW_REQUIRED', 409);
  // An unreviewed proposal is unresolved work, even if it is not yet selected in a row.
  if (record.sources.some(s => !s.reviewed)) return fail('SOURCE_REVIEW_REQUIRED', 409);
  record.rows.forEach(row => verifyRow(record, row));
  const input: EvidenceReviewInput = { contractVersion: 'evidence-plan-prototype/1',
    binding: record.material.binding, planRevision: record.revision, rows: record.rows, acknowledged: true };
  const compiled = compileEvidencePlan(compiledSource(record), input);
  return { compiled, planDigest: hash(['evidence-plan-v2', record.ownerId, record.id,
    record.revision, sourceDigest(record), compiled.planDigest]) };
}
export function applyLocalPlan(ownerId: string | null, record: LocalPlanRecord | null,
  current: PlanMaterial, value: unknown): LocalPlanRecord | null {
  owns(ownerId, record);
  const command = parsePlanCommand(value);
  if (command.expectedRevision !== record.revision) return fail('PLAN_CONFLICT', 409);
  if (command.action === 'delete') return null; // Owner may delete a stale draft; existing reports stay immutable.
  if (record.materialDigest !== materialDigest(current)) return fail('PLAN_SOURCE_CHANGED', 409);
  const next = structuredClone(record); next.revision++; next.confirmation = null;
  const invalidate = (jdId: string) => { const row = next.rows.find(r => r.jdId === jdId); if (row) row.checked = false; };
  switch (command.action) {
    case 'add_source': {
      const quote = verifyProposal(record.material, command.source);
      if (record.sources.some(s => s.jdId === command.source.jdId && s.factId === command.source.factId
        && s.start === command.source.start && s.end === command.source.end)) return fail('INVALID_INPUT', 422);
      next.sources.push({ ...command.source, key: `source-${next.nextSourceNumber++}`, quote, reviewed: false });
      invalidate(command.source.jdId); break;
    }
    case 'confirm_source': {
      const entry = next.sources.find(s => s.key === command.key); if (!entry) return fail('INVALID_INPUT', 422);
      verifyProposal(record.material, entry); entry.reviewed = true; invalidate(entry.jdId); break;
    }
    case 'remove_source': {
      const entry = next.sources.find(s => s.key === command.key); if (!entry) return fail('INVALID_INPUT', 422);
      next.sources = next.sources.filter(s => s.key !== command.key);
      for (const row of next.rows) row.selections = row.selections.filter(s => s.actionKey !== command.key);
      invalidate(entry.jdId); break;
    }
    case 'save_row': {
      const index = next.rows.findIndex(r => r.jdId === command.row.jdId); if (index < 0) return fail('INVALID_INPUT', 422);
      const row = { ...command.row, checked: false };
      // Partial notes/pending are saveable, but forged associations are not.
      if (row.selections.some(s => !planOptions(record)[row.jdId]?.some(o => o.actionKey === s.actionKey && o.evidenceType === s.evidenceType))) return fail('EVIDENCE_NOT_ALLOWED', 422);
      if (row.choice !== 'limited_support' && (row.selections.length || row.existingAction.trim())) return fail('EVIDENCE_NOT_ALLOWED', 422);
      next.rows[index] = row; break;
    }
    case 'confirm_row': {
      const row = next.rows.find(r => r.jdId === command.jdId); if (!row) return fail('INVALID_INPUT', 422);
      verifyRow(next, row); row.checked = true; break;
    }
    case 'confirm_plan': {
      const result = compileLocalPlan(next);
      next.confirmation = { revision: next.revision, sourceDigest: sourceDigest(next), planDigest: result.planDigest }; break;
    }
  }
  return next;
}
