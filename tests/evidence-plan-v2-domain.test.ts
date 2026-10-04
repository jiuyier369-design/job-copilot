import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fictionalId, fictionalRowCommand, fictionalV2Material } from '../src/fixtures/evidence-plan-v2-fictional.ts';
import { checkV2Material, createV2PlanSimulator, exactSlice, parseV2PlanEnvelope, rowEligible, readV2Plan } from '../src/lib/evidence-plan-v2/domain.ts';
import type { V2PlanCommand, V2Material } from '../src/types/evidence-plan-v2.ts';
import { v2Hash } from '../src/lib/evidence-plan-v2/domain.ts';
const envelope = <T extends V2PlanCommand>(n: number, command: T) => ({ contractVersion: 'evidence-plan-write/2' as const, operationId: fictionalId(n), command });
test('object field order does not change operation identity or snapshot hashes', () => {
  const m = fictionalV2Material(), db = createV2PlanSimulator();
  const c = { action: 'create_plan' as const, draftId: m.binding.draftId, expectedDraftRevision: m.binding.draftRevision, expectedProfileVersion: m.binding.profileVersion };
  const first = db.execute('a', null, envelope(100, c), m);
  const reordered = Object.fromEntries(Object.entries(c).reverse()) as typeof c;
  const replay = db.execute('a', null, envelope(100, reordered), m);
  assert.deepEqual(first.receipt, replay.receipt); assert.equal(v2Hash(c), v2Hash(reordered));
});
function setup(m = fictionalV2Material()) {
  const db = createV2PlanSimulator(), id = fictionalId(10); let serial = 10;
  const result = db.execute('a', null, envelope(serial, { action: 'create_plan', draftId: m.binding.draftId,
    expectedDraftRevision: m.binding.draftRevision, expectedProfileVersion: m.binding.profileVersion }), m);
  assert.equal(result.receipt.outcome, 'applied');
  return { db, id, m, apply(c: V2PlanCommand) { return db.execute('a', id, envelope(++serial, c), m); } };
}
test('arbitrary N rows retain earlier confirmations, and explicit full confirmation requires all rows', () => {
  for (const n of [1, 6, 14, 35]) {
    const s = setup(fictionalV2Material(n));
    for (const item of s.m.requirements) {
      const rev = s.db.read('a', s.id, s.m).revision;
      const result = s.apply(fictionalRowCommand(s.m, item.jdId, rev)); assert.equal(result.receipt.outcome, 'applied');
      assert.equal(result.resource!.eligibleJdIds.length, s.m.requirements.indexOf(item) + 1);
    }
    const full = s.apply({ action: 'confirm_plan', expectedRevision: s.db.read('a', s.id, s.m).revision, acknowledged: true });
    assert.equal(full.resource!.status, 'confirmed'); assert.equal(full.resource!.eligibleJdIds.length, n);
    const old = JSON.stringify(full.resource);
    const changed = s.apply({ ...fictionalRowCommand(s.m, 'R1', full.resource!.revision), intent: 'save_progress', acknowledged: false });
    assert.equal(changed.resource!.confirmation, null); assert.equal(changed.resource!.eligibleJdIds.length, n - 1);
    assert.equal(JSON.stringify(full.resource), old); // Historical detached values never mutated.
  }
});
test('partial saved rows and marked pending are durable in the local snapshot but never confirm', () => {
  const s = setup();
  const partial = s.apply({ ...fictionalRowCommand(s.m, 'R2', 1), selectedSources: [], missingScope: '', intent: 'save_progress', acknowledged: false });
  assert.equal(partial.receipt.outcome, 'applied'); assert.equal(partial.resource!.rows[1].confirmation, null);
  const pending = s.apply({ ...fictionalRowCommand(s.m, 'R3', 2), choice: 'pending', selectedSources: [],
    pendingReason: '需要核实范围', intent: 'save_progress', acknowledged: false });
  assert.equal(pending.resource!.rows[2].pendingReason, '需要核实范围'); assert.equal(pending.resource!.eligibleJdIds.length, 0);
  assert.equal(s.apply({ action: 'confirm_plan', expectedRevision: 3, acknowledged: true }).receipt.outcome, 'rejected');
  assert.throws(() => parseV2PlanEnvelope(envelope(80, { ...fictionalRowCommand(s.m, 'R3', 3), choice: 'pending' })), /INVALID_INPUT/);
});
test('exact UTF-16 fragments reject empty, out of bounds and split surrogate pairs, preserve emoji', () => {
  for (const span of [{ start: 1, end: 2 }, { start: 2, end: 3 }, { start: -1, end: 2 }, { start: 0, end: 99 }, { start: 0, end: 0 }])
    assert.throws(() => exactSlice('A😀B', span), /INVALID_INPUT/);
  assert.equal(exactSlice('A😀B', { start: 1, end: 3 }), '😀');
  const s = setup(); const c = fictionalRowCommand(s.m, 'R2', 1);
  for (const sources of [[...c.selectedSources, ...c.selectedSources], [{ ...c.selectedSources[0], end: 999 }],
    [{ ...c.selectedSources[0], end: 8 }, { ...c.selectedSources[0], start: 4, end: 12 }]]) {
    const result = s.apply({ ...c, selectedSources: sources }); assert.equal(result.receipt.outcome, 'rejected');
    assert.equal(s.db.read('a', s.id, s.m).revision, 1);
  }
});
test('mixed task scenes remain separate and source ordering is canonical for operation replay', () => {
  const s = setup(); const c = fictionalRowCommand(s.m, 'R2', 1);
  c.selectedSources.push({ factId: 'CAMPUS', start: 0, end: s.m.profile.facts[2].statement.length, evidenceType: 'transferable', sectionKey: null });
  const env = envelope(90, c); const first = s.db.execute('a', s.id, env, s.m);
  const reordered = structuredClone(env); reordered.command.selectedSources.reverse();
  assert.deepEqual(s.db.execute('a', s.id, reordered, s.m).receipt, first.receipt);
  assert.deepEqual(new Set(first.resource!.rows[1].sources.map(x => x.scene)), new Set(['campus', 'personal_project']));
  assert.equal(first.resource!.revision, 2);
});
test('old revision and changed acknowledgement cannot override confirmed data', () => {
  const s = setup(); s.apply(fictionalRowCommand(s.m, 'R2', 1));
  const rejected = s.apply(fictionalRowCommand(s.m, 'R3', 1));
  assert.equal(rejected.receipt.outcome, 'rejected');
  if (rejected.receipt.outcome === 'rejected') assert.equal(rejected.receipt.failureCode, 'PLAN_CONFLICT');
  assert.equal(s.db.read('a', s.id, s.m).eligibleJdIds.length, 1);
  for (const command of [{ ...fictionalRowCommand(s.m, 'R3', 2), acknowledged: false },
    { ...fictionalRowCommand(s.m, 'R3', 2), intent: 'save_progress', acknowledged: true }])
    assert.throws(() => parseV2PlanEnvelope(envelope(91, command as V2PlanCommand)), /INVALID_INPUT/);
});
test('personal project cannot be upgraded; preference, education and forged scene cannot be tasks', () => {
  const s = setup(); const c = fictionalRowCommand(s.m, 'R2', 1);
  for (const sources of [[{ ...c.selectedSources[0], evidenceType: 'same_task' as const }],
    [{ ...c.selectedSources[0], factId: 'PREFERENCE', end: 5 }], [{ ...c.selectedSources[0], factId: 'EDU', end: 5 }]]) {
    const result = s.apply({ ...c, selectedSources: sources });
    assert.equal(result.receipt.outcome, 'rejected'); if (result.receipt.outcome === 'rejected') assert.equal(result.receipt.failureCode, 'EVIDENCE_NOT_ALLOWED');
  }
  assert.throws(() => parseV2PlanEnvelope({ ...envelope(90, c), command: { ...c, selectedSources: [{ ...c.selectedSources[0], scene: 'formal_work' }] } }), /INVALID_INPUT/);
  const mixed = s.apply(fictionalRowCommand(s.m, 'R5', 1)); assert.equal(mixed.receipt.outcome, 'applied');
  assert.deepEqual(new Set(mixed.resource!.rows[4].sources.map(x => x.evidenceType)), new Set(['background', 'personal_practice']));
});
test('unknown preferred sections, wrong row sources and duplicate material anchors reject', () => {
  const s = setup(); const c = fictionalRowCommand(s.m, 'R5', 1);
  assert.equal(s.apply({ ...c, selectedSources: [{ ...c.selectedSources[0], sectionKey: 'R4/background' }] }).receipt.outcome, 'rejected');
  for (const mutate of [(m: V2Material) => { m.requirements[1].jdId = m.requirements[0].jdId; },
    (m: V2Material) => { m.requirements[4].sections[0].end--; }, (m: V2Material) => { m.requirements[0].conditions[1].start--; }]) {
    const m = structuredClone(s.m); mutate(m); assert.throws(() => checkV2Material(m), /INVALID_INPUT/);
  }
});
test('same operationId same canonical input replays after edits/deletion; different input conflicts', () => {
  const s = setup(); const env = envelope(90, fictionalRowCommand(s.m, 'R2', 1));
  const first = s.db.execute('a', s.id, env, s.m); const repeat = s.db.execute('a', s.id, env, s.m);
  assert.deepEqual(first.receipt, repeat.receipt); assert.equal(repeat.resource!.revision, 2);
  assert.throws(() => s.db.execute('a', s.id, { ...env, command: { ...env.command, missingScope: '另一个范围' } }, s.m), /OPERATION_CONFLICT/);
  const del = s.apply({ action: 'delete', expectedRevision: 2 }); assert.equal(del.resource, null);
  assert.equal(s.db.execute('a', s.id, env, s.m).resource, null);
  assert.deepEqual(s.db.receipt('a', env.operationId), first.receipt);
});
test('known rejection replays without executing again and no-op forged fields never get a receipt', () => {
  const s = setup(); const env = envelope(90, { action: 'confirm_plan', expectedRevision: 1, acknowledged: true });
  const rejected = s.db.execute('a', s.id, env, s.m);
  s.apply(fictionalRowCommand(s.m, 'R1', 1));
  assert.deepEqual(s.db.execute('a', s.id, env, s.m).receipt, rejected.receipt);
  assert.equal(s.db.read('a', s.id, s.m).revision, 2);
  assert.throws(() => s.db.execute('a', s.id, { ...env, userId: 'b' }, s.m), /INVALID_INPUT/);
});
test('401/404 owner isolation, changed material and unverified reads cannot grant generation', () => {
  const s = setup(); const changed = structuredClone(s.m); changed.profile.facts[0].statement += '补充事实。';
  assert.throws(() => s.db.read(null, s.id, s.m), /UNAUTHENTICATED/); assert.throws(() => s.db.read('b', s.id, s.m), /NOT_FOUND/);
  assert.throws(() => s.db.receipt('b', s.id), /NOT_FOUND/);
  assert.equal(s.db.read('a', s.id, changed).validity, 'stale'); assert.equal(s.db.read('a', s.id, null).validity, 'stale');
  assert.equal(s.db.read('a', s.id, undefined).validity, 'unverified');
  const reject = s.db.execute('a', s.id, envelope(90, fictionalRowCommand(s.m, 'R2', 1)), changed);
  assert.equal(reject.receipt.outcome, 'rejected'); assert.equal(s.db.read('a', s.id, s.m).revision, 1);
});
test('row receipt tampering and duplicate rows cannot fake full confirmation; no network/logger/storage', () => {
  const s = setup(fictionalV2Material(1)); s.apply(fictionalRowCommand(s.m, 'R1', 1));
  s.apply({ action: 'confirm_plan', expectedRevision: 2, acknowledged: true }); const p = s.db.snapshot('a', s.id)!;
  p.rows[0].sources[0].scene = 'formal_work'; assert.equal(rowEligible(p, p.rows[0]), false);
  assert.equal(readV2Plan('a', p, s.m).confirmation, null);
  const code = readFileSync('src/lib/evidence-plan-v2/domain.ts', 'utf8'); assert.doesNotMatch(code, /fetch\(|console\.|localStorage|SUPABASE|MODEL_API_KEY/);
});
