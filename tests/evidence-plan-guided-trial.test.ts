import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidencePlanDemoSource as source, evidencePlanDemoReviewed as reviewed } from '../src/fixtures/evidence-plan-demo.ts';
import { fictionalSourceGuidance as notes } from '../src/fixtures/evidence-plan-guidance-demo.ts';
import { checkReview, optionsFor } from '../src/lib/evidence-plan/core.ts';
import { guidedProgress, guidedTrialReducer, initialGuidedTrial, remainingReviews, rowConfirmationBlocker, type GuidedTrialEvent } from '../src/lib/evidence-plan/guided-trial.ts';

const act = (state: ReturnType<typeof initialGuidedTrial>, event: GuidedTrialEvent) => guidedTrialReducer(source, notes, state, event);
test('opening most rows is distinct from row confirmation, skipped choices and overall eligibility', () => {
  let s = initialGuidedTrial(source);
  for (const item of source.jdItems.slice(1)) {
    s = act(s, { type: 'activate', id: item.jdId });
    assert.equal(s.viewed.includes(item.jdId), false); // Requesting navigation is not completed navigation.
    s = act(s, { type: 'leave_unconfirmed' });
  }
  const p = guidedProgress(source, s);
  assert.equal(p.viewed, 14); assert.equal(p.checked, 0); assert.equal(p.eligible, 0);
  assert.equal(p.pending, 14); assert.equal(p.markedPending, 0);
});
test('pending requires a reason, records intent and advances without creating any confirmation', () => {
  let s = initialGuidedTrial(source);
  const failed = act(s, { type: 'defer' }); assert.ok(failed.error); assert.equal(failed.activeJdId, 'D01');
  s = act(s, { type: 'reason', value: '不确定来源与本条的关联' });
  s = act(s, { type: 'defer' });
  assert.equal(s.activeJdId, 'D02'); assert.equal(s.review.rows[0].checked, false);
  assert.equal(guidedProgress(source, s).markedPending, 1); assert.equal(guidedProgress(source, s).eligible, 0);
  assert.throws(() => checkReview(source, { ...s.review, acknowledged: true }));
  assert.ok(act(s, { type: 'confirm_plan' }).error);
});
test('missing confirmation navigation has explicit stay/leave; unfinished notes survive both paths', () => {
  let s = act(initialGuidedTrial(source), { type: 'choice', choice: 'no_clue' });
  s = act(s, { type: 'note', field: 'missingScope', value: '虚构范围笔记' });
  s = act(s, { type: 'activate', id: 'D04' }); assert.equal(s.activeJdId, 'D01'); assert.equal(s.navigationTarget, 'D04');
  s = act(s, { type: 'stay' }); assert.equal(s.navigationTarget, null); assert.equal(s.activeJdId, 'D01');
  s = act(s, { type: 'activate', id: 'D04' }); s = act(s, { type: 'leave_unconfirmed' });
  assert.equal(s.activeJdId, 'D04'); assert.equal(s.review.rows[0].missingScope, '虚构范围笔记'); assert.equal(s.review.rows[0].checked, false);
});
test('no-clue uses a visible limited-scope hint; explicit confirm both verifies and advances', () => {
  let s = act(initialGuidedTrial(source), { type: 'choice', choice: 'no_clue' });
  assert.match(s.review.rows[0].missingScope, /不代表没有经历/);
  assert.equal(s.review.rows[0].checked, false);
  s = act(s, { type: 'confirm_next' });
  assert.equal(s.review.rows[0].checked, true); assert.equal(s.activeJdId, 'D02');
  assert.equal(guidedProgress(source, s).checked, 1); assert.equal(guidedProgress(source, s).eligible, 1);
});
test('range hints depend on selected fictional actions, preserve manual notes and never add evidence', () => {
  let s = initialGuidedTrial(source); s = act(s, { type: 'activate', id: 'D06' }); s = act(s, { type: 'leave_unconfirmed' });
  s = act(s, { type: 'choice', choice: 'limited_support' });
  assert.ok(rowConfirmationBlocker(source, s.review.rows[5]));
  s = act(s, { type: 'selection', selection: { actionKey: 'iterate', evidenceType: 'personal_practice' }, selected: true });
  assert.match(s.review.rows[5].missingScope, /个人/); assert.doesNotMatch(s.review.rows[5].missingScope, /比赛/);
  s = act(s, { type: 'note', field: 'missingScope', value: '虚构自写边界，必须重新核对' });
  s = act(s, { type: 'selection', selection: { actionKey: 'competition', evidenceType: 'transferable' }, selected: true });
  assert.equal(s.review.rows[5].missingScope, '虚构自写边界，必须重新核对');
  assert.equal(s.review.rows[5].selections.length, 2); assert.equal(s.review.rows[5].checked, false);
  assert.match(s.review.rows[5].existingAction, /评委反馈/);
});
test('source hints do not expand Host options, promote personal practice, or make D07 knowledge work valid', () => {
  let s = initialGuidedTrial(source); s = act(s, { type: 'activate', id: 'D04' }); s = act(s, { type: 'leave_unconfirmed' });
  s = act(s, { type: 'choice', choice: 'limited_support' });
  const bad = act(s, { type: 'selection', selection: { actionKey: 'design', evidenceType: 'same_task' }, selected: true });
  assert.ok(bad.error); assert.deepEqual(bad.review, s.review);
  s = act(s, { type: 'activate', id: 'D07' }); s = act(s, { type: 'leave_unconfirmed' });
  s = act(s, { type: 'choice', choice: 'limited_support' });
  assert.equal(optionsFor(source, 'D07').length, 0);
  const invalid = act(s, { type: 'selection', selection: { actionKey: 'knowledge', evidenceType: 'personal_practice' }, selected: true });
  assert.ok(invalid.error); assert.equal(invalid.review.rows[6].selections.length, 0);
  assert.equal(guidedProgress(source, invalid).eligible, 0);
});
test('all fourteen explicit confirmations still use original validation; edits invalidate while viewed progress remains', () => {
  let s = initialGuidedTrial(source);
  for (const r of reviewed.rows) {
    assert.equal(s.activeJdId, r.jdId);
    s = act(s, { type: 'choice', choice: r.choice });
    for (const selection of r.selections) s = act(s, { type: 'selection', selection, selected: true });
    s = act(s, { type: 'confirm_next' }); assert.equal(s.error, null);
  }
  s = act(s, { type: 'confirm_plan' }); assert.equal(s.confirmed, true);
  assert.equal(guidedProgress(source, s).eligible, 14); assert.equal(guidedProgress(source, s).viewed, 14);
  s = act(s, { type: 'note', field: 'missingScope', value: '修改虚构边界' });
  assert.equal(s.confirmed, false); assert.equal(guidedProgress(source, s).eligible, 13);
  assert.equal(guidedProgress(source, s).viewed, 14);
  s.review.rows[13].checked = true; s.review.rows[13].missingScope = '';
  assert.equal(guidedProgress(source, s).checked, 14); assert.equal(guidedProgress(source, s).eligible, 13);
});
test('prototype separates local guidance from frozen Props/API; no source body is uploaded or stored', () => {
  for (const path of ['src/components/evidence-plan/evidence-plan-guided-trial-host.tsx', 'src/lib/evidence-plan/guided-trial.ts']) {
    const code = readFileSync(path, 'utf8'); assert.doesNotMatch(code, /fetch\(|localStorage|sessionStorage|MODEL_API_KEY|supabase|console\./i);
  }
  const panel = readFileSync('src/components/evidence-plan/evidence-plan-panel.tsx', 'utf8');
  assert.match(panel, /activeRow.choice === 'pending'/); assert.match(panel, /标记待核对并继续/);
  assert.doesNotMatch(panel, /factIsSelectableFor|候选事实可作为/);
  assert.match(panel, /guidance=\{guide\?\.sourceNotes/);
});

test('remaining list explains current state without reconstructing three historical unfinished rows', () => {
  const s = initialGuidedTrial(source);
  s.review.rows = structuredClone(reviewed.rows);
  s.review.rows.slice(0, 10).forEach(r => { r.checked = true; });
  s.review.rows.slice(10).forEach(r => { r.checked = false; });
  s.review.rows[10].choice = 'pending'; s.deferred[s.review.rows[10].jdId] = '需要核实事实或支持范围';
  const remaining = remainingReviews(source, s);
  assert.equal(remaining.length, 4);
  assert.equal(remaining[0].reason, 'PENDING_MARKED');
  assert.ok(remaining.slice(1).every(r => r.reason === 'CONFIRMATION_REQUIRED'));
  assert.ok(remaining.slice(1).every(r => r.explanation.includes('不推断原因')));
  assert.equal(guidedProgress(source, s).eligible, 10);
  assert.equal(act(s, { type: 'confirm_plan' }).confirmed, false);
});
test('remaining blockers distinguish source, scope, pending and invalid evidence; edits restore item', () => {
  const s = initialGuidedTrial(source); const rows = s.review.rows;
  rows[0].choice = 'limited_support';
  rows[1].choice = 'no_clue'; rows[1].missingScope = '';
  rows[3] = { ...structuredClone(reviewed.rows[3]), checked: true, selections: [{ actionKey: 'design', evidenceType: 'same_task' }] };
  const found = remainingReviews(source, s);
  assert.equal(found[0].reason, 'SOURCE_REQUIRED'); assert.equal(found[1].reason, 'SCOPE_REQUIRED');
  assert.equal(found[2].reason, 'PENDING_UNMARKED'); assert.equal(found[3].reason, 'REVIEW_REQUIRED');
  const complete = { ...s, review: { ...s.review, rows: structuredClone(reviewed.rows).map(r => ({ ...r, checked: true })) } };
  assert.equal(remainingReviews(source, complete).length, 0);
  const edited = act(complete, { type: 'note', field: 'missingScope', value: '虚构修改范围' });
  assert.equal(remainingReviews(source, edited).length, 1);
});
