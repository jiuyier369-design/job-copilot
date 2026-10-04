import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeTrialMs, initialTrial, trialReducer } from '../src/lib/evidence-plan/trial.ts';
test('timing excludes pauses, retains wall duration, ends on explicit plan confirmation and resets a new trial', () => {
  let s = trialReducer(initialTrial, { type: 'start', now: 1000 });
  s = trialReducer(s, { type: 'activation' }); s = trialReducer(s, { type: 'note_edit' });
  s = trialReducer(s, { type: 'pause', now: 4000 }); assert.equal(activeTrialMs(s, 10000), 3000);
  s = trialReducer(s, { type: 'activation' }); assert.equal(s.activations, 1);
  s = trialReducer(s, { type: 'resume', now: 10000 });
  s = trialReducer(s, { type: 'progress', now: 12000, checked: 14, total: 14, confirmed: true });
  assert.equal(s.phase, 'finished'); assert.equal(s.activeMs, 5000); assert.equal(s.finishedAt! - s.startedAt!, 11000);
  assert.equal(activeTrialMs(s, 99999), 5000); assert.equal(s.noteEdits, 1);
  assert.equal(trialReducer(s, { type: 'start', now: 13000 }).activations, 0);
});
test('abandoned trial records incomplete progress, idle actions do not count, user feedback is not inferred', () => {
  assert.equal(trialReducer(initialTrial, { type: 'activation' }).activations, 0);
  let s = trialReducer(initialTrial, { type: 'start', now: 0 });
  s = trialReducer(s, { type: 'progress', now: 3000, checked: 4, total: 14, confirmed: false });
  s = trialReducer(s, { type: 'finish', now: 5000 });
  assert.equal(s.checked, 4); assert.equal(s.confirmed, false); assert.equal(s.activeMs, 5000);
});
test('trial reuses W10, hides the fixed-complete shortcut, has no API, credentials or durable browser storage', () => {
  const host = readFileSync('src/components/evidence-plan/evidence-plan-trial-host.tsx', 'utf8');
  assert.match(host, /EvidencePlanGuidedTrialHost key=\{session\}/);
  // Capture-phase state updates previously prevented a controlled radio from changing.
  // The 14-row browser regression verifies the interaction; keep counting after target handlers.
  assert.match(host, /onClick=\{event/); assert.doesNotMatch(host, /onClickCapture/);
  assert.match(host, /预置/); assert.match(host, /只留在当前页面/);
  assert.doesNotMatch(host, /fetch\(|localStorage|sessionStorage|supabase|MODEL_API_KEY|server\.ts/i);
  assert.match(readFileSync('src/components/evidence-plan/evidence-plan-demo-host.tsx', 'utf8'), /!trialMode &&/);
});
