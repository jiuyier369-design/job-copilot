import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidencePlanDemoSource as demo, evidencePlanDemoReviewed as reviewed, evidencePlanMockOutput } from '../src/fixtures/evidence-plan-demo.ts';
import { applyLocalPlan, compileLocalPlan, createLocalPlan, materialDigest, parsePlanCommand,
  planOptions, PlanProtocolError, readLocalPlan, sourceDigest } from '../src/lib/evidence-plan/protocol.ts';
import { checkPlanReplay, lockPlanGeneration, parseGenerateWithPlan } from '../src/lib/evidence-plan/generation-v2.ts';
import { planEditor, planEditorReducer } from '../src/lib/evidence-plan/recovery.ts';
import { validateAnswers } from '../src/lib/evidence-plan/server.ts';
import { requestFingerprint } from '../src/lib/analysis/runs.ts';
import { loadPlanMaterial, parsePlanCreate } from '../src/lib/evidence-plan/material.ts';
import { transitionDraft } from '../src/lib/jd/transition.ts';
import { draftDigest } from '../src/lib/jd/service.ts';
import type { LocalPlanRecord, PlanCommand, PlanMaterial, GenerateWithPlanRequest } from '../src/types/evidence-plan-protocol.ts';

const clone = <T>(value: T): T => structuredClone(value);
const planId = '11111111-1111-4111-8111-111111111111';
const material = (): PlanMaterial => ({ binding: { ...demo.binding, draftId: '22222222-2222-4222-8222-222222222222' },
  jdText: demo.jdText, jdItems: clone(demo.jdItems), profile: clone(demo.profile),
  qualificationDecisions: Object.fromEntries(demo.scopes.filter(s => s.qualificationStatus).map(s => [s.jdId, s.qualificationStatus!])) });
const rejects = (code: string, fn: () => unknown) => assert.throws(fn, e => e instanceof PlanProtocolError && e.code === code);
function change(p: LocalPlanRecord, command: Omit<PlanCommand, 'expectedRevision'>): LocalPlanRecord {
  return applyLocalPlan('owner-a', p, p.material, { ...command, expectedRevision: p.revision })!;
}
function confirmed() {
  let p = createLocalPlan('owner-a', planId, material());
  for (const row of reviewed.rows) {
    const selections = [];
    for (const selection of row.selections) {
      const action = demo.actions.find(a => a.key === selection.actionKey)!;
      const fact = demo.profile.facts.find(f => f.factId === action.factId)!;
      p = change(p, { action: 'add_source', source: { jdId: row.jdId, factId: action.factId,
        start: fact.statement.indexOf(action.quote), end: fact.statement.indexOf(action.quote) + action.quote.length, evidenceType: selection.evidenceType } } as Omit<PlanCommand, 'expectedRevision'>);
      const entry = p.sources.at(-1)!;
      p = change(p, { action: 'confirm_source', key: entry.key, acknowledged: true } as Omit<PlanCommand, 'expectedRevision'>);
      selections.push({ actionKey: entry.key, evidenceType: entry.evidenceType });
    }
    const { checked: _, ...values } = row;
    p = change(p, { action: 'save_row', row: { ...values, selections } } as Omit<PlanCommand, 'expectedRevision'>);
    p = change(p, { action: 'confirm_row', jdId: row.jdId } as Omit<PlanCommand, 'expectedRevision'>);
  }
  return change(p, { action: 'confirm_plan', acknowledged: true } as Omit<PlanCommand, 'expectedRevision'>);
}
const metadata = { reportStructureVersion: '1.0.0' as const, promptVersion: 'proposal-only', modelProvider: 'mock', modelName: 'none', testDataVersion: 'fictional' };
function request(p: LocalPlanRecord): GenerateWithPlanRequest {
  return { contractVersion: 'analysis-request-v2', planId: p.id, expectedPlanRevision: p.revision,
    requestId: '33333333-3333-4333-8333-333333333333', draftId: p.material.binding.draftId,
    expectedDraftRevision: p.material.binding.draftRevision, expectedProfileVersion: p.material.binding.profileVersion,
    company: '虚构公司', jobTitle: '虚构岗位', city: null, direction: null, jdSourceUrl: null };
}

test('arbitrary profile fragments start unreviewed, never automatic capabilities or options', () => {
  let p = createLocalPlan('owner-a', planId, material());
  p = change(p, { action: 'add_source', source: { jdId: 'D04', factId: 'F02', start: 0, end: 12, evidenceType: 'personal_practice' } } as Omit<PlanCommand, 'expectedRevision'>);
  assert.equal(p.sources[0].reviewed, false); assert.equal(planOptions(p).D04.length, 0);
  rejects('SOURCE_REVIEW_REQUIRED', () => applyLocalPlan('owner-a', { ...p, rows: reviewed.rows.map(r => ({ ...r, checked: true })) }, p.material,
    { action: 'confirm_plan', expectedRevision: p.revision, acknowledged: true }));
  p = change(p, { action: 'confirm_source', key: p.sources[0].key, acknowledged: true } as Omit<PlanCommand, 'expectedRevision'>);
  assert.equal(planOptions(p).D04.length, 1); assert.equal(planOptions(p).D07.length, 0);
});
test('server derives quotes from exact positions; unknown facts, bad ranges and split surrogate pairs fail', () => {
  const m = material(); m.profile.facts[1].statement = '虚构😀个人项目。'; const p = createLocalPlan('owner-a', planId, m);
  const proposal = { jdId: 'D04', factId: 'F02', start: 0, end: 4, evidenceType: 'personal_practice' };
  for (const patch of [{ start: 3 }, { end: 3 }, { start: -1 }, { end: 500 }, { factId: 'alien' }])
    rejects('INVALID_INPUT', () => applyLocalPlan('owner-a', p, m, { action: 'add_source', expectedRevision: 1, source: { ...proposal, ...patch } }));
  const valid = applyLocalPlan('owner-a', p, m, { action: 'add_source', expectedRevision: 1, source: proposal })!;
  assert.equal(valid.sources[0].quote, '虚构😀'); assert.equal(p.sources.length, 0);
});
test('personal project types locked; education task, self-report preference and forged contexts rejected', () => {
  const p = createLocalPlan('owner-a', planId, material());
  for (const patch of [ { factId: 'F02', evidenceType: 'same_task' }, { factId: 'F02', evidenceType: 'transferable' },
    { factId: 'F01', evidenceType: 'same_task' }, { factId: 'F07', evidenceType: 'transferable' } ])
    rejects('EVIDENCE_NOT_ALLOWED', () => applyLocalPlan('owner-a', p, p.material, {
      action: 'add_source', expectedRevision: 1, source: { jdId: 'D04', start: 0, end: 2, ...patch } }));
  rejects('INVALID_INPUT', () => parsePlanCommand({ action: 'add_source', expectedRevision: 1,
    source: { jdId: 'D04', factId: 'F02', start: 0, end: 2, evidenceType: 'personal_practice', context: 'formal_work' } }));
});
test('fourteen checked requirements compile with per-requirement mixed links and original answer validation', () => {
  const p = confirmed(), result = compileLocalPlan(p);
  assert.equal(result.compiled.slots.length, 14);
  assert.equal(planOptions(p).D07.length, 0);
  assert.equal(result.compiled.slots.find(s => s.jdId === 'D02')!.qualificationStatus, 'meets');
  assert.equal(result.compiled.slots.find(s => s.jdId === 'D03')!.qualificationStatus, 'needs_confirmation');
  assert.deepEqual(new Set(result.compiled.slots.find(s => s.jdId === 'D06')!.links.map(l => l.context)), new Set(['personal_project', 'competition']));
  assert.equal(validateAnswers(result.compiled, evidencePlanMockOutput(result.compiled)).answers.length, 14);
});
test('unconfirmed sources, wrong-row associations, unapproved types and pending rows cannot confirm', () => {
  const p = confirmed(); const q = clone(p); q.rows[5].selections[1].evidenceType = 'same_task';
  rejects('EVIDENCE_NOT_ALLOWED', () => compileLocalPlan(q));
  const r = clone(p); r.rows[6].selections = clone(r.rows[3].selections); r.rows[6].choice = 'limited_support';
  rejects('SOURCE_REVIEW_REQUIRED', () => compileLocalPlan(r));
  const pending = clone(p); pending.rows[6].choice = 'pending'; rejects('PLAN_REVIEW_REQUIRED', () => compileLocalPlan(pending));
});
test('only explicit server commands can confirm; input cannot write owner, statuses, snapshots or digest', () => {
  for (const field of ['userId', 'confirmation', 'profile', 'sourceDigest', 'provider', 'qualificationStatus'])
    rejects('INVALID_INPUT', () => parsePlanCommand({ action: 'confirm_plan', expectedRevision: 1, acknowledged: true, [field]: 'sensitive' }));
  rejects('INVALID_INPUT', () => parsePlanCommand({ action: 'confirm_plan', expectedRevision: 1, acknowledged: false }));
  rejects('INVALID_INPUT', () => parsePlanCommand({ action: 'save_row', expectedRevision: 1, row: reviewed.rows[0] }));
});
test('401, cross-owner and nonexistent 404 do not leak stored material; failed writes do not mutate', () => {
  const p = confirmed(), before = JSON.stringify(p);
  rejects('UNAUTHENTICATED', () => readLocalPlan(null, p, p.material));
  rejects('NOT_FOUND', () => readLocalPlan('owner-b', p, p.material));
  rejects('NOT_FOUND', () => readLocalPlan('owner-a', null, p.material));
  rejects('PLAN_CONFLICT', () => applyLocalPlan('owner-a', p, p.material, { action: 'delete', expectedRevision: 1 }));
  assert.equal(JSON.stringify(p), before);
});
test('any JD/profile content, version or confirmation change invalidates old plan even at unchanged versions', () => {
  const p = confirmed();
  for (const mutate of [ (m: PlanMaterial) => m.binding.profileVersion++, (m: PlanMaterial) => m.binding.draftRevision++,
    (m: PlanMaterial) => m.binding.confirmationDigest += '-new', (m: PlanMaterial) => m.profile.facts[0].statement += ' 补充。',
    (m: PlanMaterial) => m.jdText += '\n背景补充', (m: PlanMaterial) => m.qualificationDecisions.D01 = 'meets' ]) {
    const m = clone(p.material); mutate(m);
    const resource = readLocalPlan('owner-a', p, m); assert.equal(resource.status, 'stale'); assert.equal(resource.confirmation, null);
    assert.equal(resource.rows.length, 14);
    rejects('PLAN_SOURCE_CHANGED', () => applyLocalPlan('owner-a', p, m, { action: 'confirm_plan', expectedRevision: p.revision, acknowledged: true }));
    assert.equal(applyLocalPlan('owner-a', p, m, { action: 'delete', expectedRevision: p.revision }), null);
  }
});
test('notes and catalogue edits invalidate receipts without silently deleting user notes or altering history', () => {
  const p = confirmed(), before = JSON.stringify(p), { checked: _, ...row } = p.rows[3];
  const next = change(p, { action: 'save_row', row: { ...row, missingScope: '新的虚构缺口说明' } } as Omit<PlanCommand, 'expectedRevision'>);
  assert.equal(next.confirmation, null); assert.equal(next.rows[3].checked, false);
  assert.equal(JSON.stringify(p), before);
  const removed = change(p, { action: 'remove_source', key: p.sources[0].key } as Omit<PlanCommand, 'expectedRevision'>);
  assert.equal(removed.confirmation, null); assert.equal(removed.rows[0].checked, false);
  assert.notEqual(sourceDigest(removed), sourceDigest(p));
});
test('source receipt tampering fails closed, and material object insertion order does not change digest', () => {
  const p = confirmed(); p.sources[0].reviewed = false;
  assert.equal(readLocalPlan('owner-a', p, p.material).status, 'stale');
  const m = material(); assert.equal(materialDigest(m), materialDigest({ ...m, qualificationDecisions: Object.fromEntries(Object.entries(m.qualificationDecisions).reverse()) }));
});
test('v2 plan digest joins a new fingerprint namespace; v1 fingerprint contract remains unchanged', () => {
  const p = confirmed(), r = request(p), lock = lockPlanGeneration('owner-a', p, p.material, r, metadata);
  const v1 = requestFingerprint('owner-a', r, p.material.binding.confirmationDigest, metadata);
  assert.notEqual(lock.fingerprint, v1); assert.equal(lock.planDigest, p.confirmation!.planDigest);
  checkPlanReplay('owner-a', lock, r);
  rejects('IDEMPOTENCY_CONFLICT', () => checkPlanReplay('owner-a', lock, { ...r, expectedPlanRevision: r.expectedPlanRevision + 1 }));
  rejects('IDEMPOTENCY_CONFLICT', () => checkPlanReplay('owner-a', lock, { ...r, company: '另一虚构公司' }));
  rejects('IDEMPOTENCY_CONFLICT', () => checkPlanReplay('owner-a', lock, { ...r, requestId: '44444444-4444-4444-8444-444444444444' }));
  rejects('NOT_FOUND', () => checkPlanReplay('owner-b', lock, r));
  // Exact completed replay relies on locked input; no current plan read or model callback required.
  checkPlanReplay('owner-a', lock, clone(r));
});
test('v2 rejects unconfirmed, stale or forged plans before any generation admission', () => {
  const p = confirmed(), r = request(p); const draft = { ...p, confirmation: null };
  rejects('PLAN_REVIEW_REQUIRED', () => lockPlanGeneration('owner-a', draft, p.material, r, metadata));
  const m = clone(p.material); m.binding.profileVersion++;
  rejects('PLAN_SOURCE_CHANGED', () => lockPlanGeneration('owner-a', p, m, r, metadata));
  for (const field of ['planDigest', 'userId', 'report', 'provider', 'sourceDigest', 'confirmation'])
    rejects('INVALID_INPUT', () => parseGenerateWithPlan({ ...r, [field]: 'forged' }));
});
test('error recovery keeps input and last success for 401/404/409/503; reload only replaces after explicit consent AND success', () => {
  const p = confirmed(), resource = readLocalPlan('owner-a', p, p.material);
  const original = planEditor(resource), rows = clone(original.input); rows[3].missingScope = '本地未保存的虚构笔记';
  let state = planEditorReducer(original, { type: 'edit', rows });
  for (const code of ['UNAUTHENTICATED', 'NOT_FOUND', 'PLAN_CONFLICT', 'PLAN_SOURCE_CHANGED', 'SERVICE_UNAVAILABLE'] as const) {
    const failed = planEditorReducer(state, { type: 'error', code });
    assert.deepEqual(failed.input, rows); assert.deepEqual(failed.saved, resource);
  }
  state = planEditorReducer(state, { type: 'request_reload', discardConfirmed: false });
  assert.equal(state.needsDiscardConfirmation, true); assert.equal(state.busy, false);
  state = planEditorReducer(state, { type: 'request_reload', discardConfirmed: true });
  const failed = planEditorReducer(state, { type: 'error', code: 'SERVICE_UNAVAILABLE' }); assert.deepEqual(failed.input, rows);
  const loaded = planEditorReducer(state, { type: 'loaded', resource, discardConfirmed: true }); assert.deepEqual(loaded.input, resource.rows);
});
test('edits made while saving or reloading cannot be overwritten by a late success', () => {
  const p = confirmed(), resource = readLocalPlan('owner-a', p, p.material);
  let state = planEditorReducer(planEditor(resource), { type: 'start_save' });
  const rows = clone(state.input); rows[3].missingScope = '请求中继续编辑的虚构笔记';
  state = planEditorReducer(state, { type: 'edit', rows });
  assert.deepEqual(planEditorReducer(state, { type: 'saved', resource }).input, rows);
  assert.deepEqual(planEditorReducer(state, { type: 'loaded', resource, discardConfirmed: true }).input, rows);
});
test('local protocol has no model/network/persistence or raw diagnostic logging', () => {
  for (const path of ['src/lib/evidence-plan/protocol.ts', 'src/lib/evidence-plan/generation-v2.ts', 'src/lib/evidence-plan/recovery.ts'])
    assert.doesNotMatch(readFileSync(path, 'utf8'), /fetch\(|console\.|process\.env|localStorage|supabase/i);
});
test('material loader reuses real confirmation digest rules and only receives owner-scoped mock ports', async () => {
  const options = { id: material().binding.draftId, now: '2026-10-03T00:00:00Z', digest: draftDigest };
  let draft = transitionDraft(null, { action: 'create', rawText: demo.jdItems.map(i => i.exactText).join('\n') }, options)!;
  for (let i = 0; i < draft.segments.length; i++) draft = transitionDraft(draft, { action: 'classify', id: draft.id,
    expectedRevision: draft.revision, segmentId: draft.segments[i].id, category: demo.jdItems[i].kind }, options)!;
  const unconfirmed = clone(draft);
  draft = transitionDraft(draft, { action: 'confirm', id: draft.id, expectedRevision: draft.revision, acknowledged: true }, options)!;
  const reference = { draftId: draft.id, expectedDraftRevision: draft.revision, expectedProfileVersion: 1 };
  const ports = { drafts: { async load(owner: string) { return owner === 'owner-a' ? clone(draft) : null; },
    async create() { throw Error('UNUSED'); }, async replace() { throw Error('UNUSED'); }, async remove() { throw Error('UNUSED'); } },
    async loadProfile(owner: string) { assert.equal(owner, 'owner-a'); return { profile: clone(demo.profile), version: 1, updatedAt: 'fictional' }; } };
  const m = await loadPlanMaterial('owner-a', reference, ports);
  assert.equal(m.jdItems.length, 14); assert.equal(m.qualificationDecisions[draft.segments[1].id], 'meets');
  assert.equal(m.qualificationDecisions[draft.segments[2].id], undefined);
  await assert.rejects(() => loadPlanMaterial('owner-b', reference, ports), (e: unknown) => e instanceof PlanProtocolError && e.code === 'NOT_FOUND');
  await assert.rejects(() => loadPlanMaterial(null, reference, ports), (e: unknown) => e instanceof PlanProtocolError && e.code === 'UNAUTHENTICATED');
  await assert.rejects(() => loadPlanMaterial('owner-a', reference, { ...ports, drafts: { ...ports.drafts, async load() { return unconfirmed; } } }),
    (e: unknown) => e instanceof PlanProtocolError && e.code === 'JD_DRAFT_CONFLICT');
  const corrupted = clone(draft); corrupted.confirmation!.digest = 'forged';
  await assert.rejects(() => loadPlanMaterial('owner-a', reference, { ...ports, drafts: { ...ports.drafts, async load() { return corrupted; } } }),
    (e: unknown) => e instanceof PlanProtocolError && e.code === 'JD_REVIEW_REQUIRED');
  await assert.rejects(() => loadPlanMaterial('owner-a', { ...reference, expectedProfileVersion: 2 }, ports),
    (e: unknown) => e instanceof PlanProtocolError && e.code === 'PROFILE_VERSION_CONFLICT');
  rejects('INVALID_INPUT', () => parsePlanCreate({ ...reference, userId: 'forged' }));
  draft = transitionDraft(null, { action: 'create', rawText: demo.jdItems.map((item, i) =>
    item.exactText + (i === 1 ? '且已取得本科毕业证。' : '')).join('\n') }, options)!;
  for (let i = 0; i < draft.segments.length; i++) draft = transitionDraft(draft, { action: 'classify', id: draft.id,
    expectedRevision: draft.revision, segmentId: draft.segments[i].id, category: demo.jdItems[i].kind }, options)!;
  draft = transitionDraft(draft, { action: 'confirm', id: draft.id, expectedRevision: draft.revision, acknowledged: true }, options)!;
  const compound = await loadPlanMaterial('owner-a', { ...reference, expectedDraftRevision: draft.revision }, ports);
  assert.equal(compound.qualificationDecisions[draft.segments[1].id], 'needs_confirmation');
});
test('reliable date decision cannot be overridden by no-clue; unknown qualifications stay separate', () => {
  const p = confirmed(); const q = clone(p); Object.assign(q.rows[1], { choice: 'no_clue', selections: [], existingAction: '' });
  rejects('PLAN_REVIEW_REQUIRED', () => compileLocalPlan(q));
  assert.equal(p.rows[2].choice, 'no_clue'); assert.equal(compileLocalPlan(p).compiled.slots[2].qualificationStatus, 'needs_confirmation');
});
test('new plan revision changes v2 lock; same requestId cannot become a new execution, while original replay survives', () => {
  const p = confirmed(), r = request(p), lock = lockPlanGeneration('owner-a', p, p.material, r, metadata);
  const { checked: _, ...row } = p.rows[3];
  let next = change(p, { action: 'save_row', row: { ...row, missingScope: '修订的虚构核对边界' } } as Omit<PlanCommand, 'expectedRevision'>);
  next = change(next, { action: 'confirm_row', jdId: row.jdId } as Omit<PlanCommand, 'expectedRevision'>);
  next = change(next, { action: 'confirm_plan', acknowledged: true } as Omit<PlanCommand, 'expectedRevision'>);
  const changed = lockPlanGeneration('owner-a', next, next.material, request(next), metadata);
  assert.notEqual(changed.planDigest, lock.planDigest); assert.notEqual(changed.fingerprint, lock.fingerprint);
  rejects('IDEMPOTENCY_CONFLICT', () => checkPlanReplay('owner-a', lock, request(next)));
  checkPlanReplay('owner-a', lock, r);
  rejects('PLAN_CONFLICT', () => applyLocalPlan('owner-a', next, next.material, { action: 'delete', expectedRevision: p.revision }));
});

// A deleted bound JD/profile must not erase an owner-readable old plan snapshot.
test('missing bound material returns stale owner snapshot without a generation confirmation', () => {
  const p = confirmed(); const result = readLocalPlan('owner-a', p, null);
  assert.equal(result.status, 'stale'); assert.equal(result.confirmation, null);
  assert.deepEqual(result.rows, p.rows); assert.equal(result.jdText, p.material.jdText);
  rejects('NOT_FOUND', () => readLocalPlan('owner-b', p, null));
});
