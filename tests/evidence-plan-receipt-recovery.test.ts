import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptRecoveryReducer as reduce, restoreReceiptRecovery } from '../src/lib/evidence-plan/receipt-recovery.ts';
import type { PlanOperationReceipt } from '../src/types/evidence-plan-receipts.ts';
const receipt = (operation: 'review_row' | 'delete' = 'review_row'): PlanOperationReceipt => ({
  contractVersion: 'evidence-plan-receipt/2', operationId: 'fictional-operation', operation,
  outcome: 'applied', planId: 'fictional-plan', resultingRevision: 2, failureCode: null, resolvedAt: '2026-10-03T00:00:00Z',
});
function ready() {
  return reduce(restoreReceiptRecovery<{ note: string }>({ planId: 'fictional-plan', operationId: null }),
    { type: 'loaded', input: { note: '虚构保存内容' }, replaceConfirmed: false });
}
test('lost write stays unresolved through receipt404/503 and blocks second write even after resource GET', () => {
  let s = reduce(ready(), { type: 'edit', input: { note: '虚构新输入' } });
  s = reduce(s, { type: 'begin_write', operationId: 'fictional-operation' });
  s = reduce(s, { type: 'write_unknown' });
  for (const code of ['NOT_FOUND', 'SERVICE_UNAVAILABLE', 'UNAUTHENTICATED'] as const) {
    s = reduce(s, { type: 'read_error', code });
    assert.equal(s.phase, 'unresolved'); assert.equal(s.input?.note, '虚构新输入');
    assert.equal(s.lastSaved?.note, '虚构保存内容');
    assert.throws(() => reduce(s, { type: 'begin_write', operationId: 'new-operation' }), /RECOVERY_REQUIRED/);
  }
  assert.equal(reduce(s, { type: 'loaded', input: { note: '服务器值' }, replaceConfirmed: true }).phase, 'unresolved');
});
test('receipt version is not current version; read success preserves dirty input until explicit replace', () => {
  let s = reduce(reduce(ready(), { type: 'begin_write', operationId: 'fictional-operation' }), { type: 'write_unknown' });
  s = reduce(s, { type: 'edit', input: { note: '继续编辑的虚构内容' } });
  s = reduce(s, { type: 'receipt', receipt: receipt() });
  assert.equal(s.phase, 'read_required'); assert.equal(s.lastSaved?.note, '虚构保存内容');
  s = reduce(s, { type: 'begin_read' });
  s = reduce(s, { type: 'loaded', input: { note: '当前服务器版本' }, replaceConfirmed: false });
  assert.equal(s.input?.note, '继续编辑的虚构内容'); assert.equal(s.dirty, true);
  s = reduce(s, { type: 'begin_read' });
  s = reduce(s, { type: 'loaded', input: { note: '当前服务器版本' }, replaceConfirmed: true });
  assert.equal(s.input?.note, '当前服务器版本'); assert.equal(s.dirty, false);
});
test('new edits during reload survive even an earlier discard acknowledgement', () => {
  let s = reduce(ready(), { type: 'begin_read' });
  s = reduce(s, { type: 'edit', input: { note: '读取途中编辑' } });
  s = reduce(s, { type: 'loaded', input: { note: '服务器新版本' }, replaceConfirmed: true });
  assert.equal(s.input?.note, '读取途中编辑'); assert.equal(s.lastSaved?.note, '服务器新版本');
});
test('refresh restores only references; receipt mismatch rejects and delete receipt survives missing plan', () => {
  let s = restoreReceiptRecovery<string>({ planId: null, operationId: 'fictional-operation' });
  assert.equal(s.input, null); assert.equal(s.lastSaved, null); assert.equal(s.phase, 'unresolved');
  assert.throws(() => reduce(s, { type: 'receipt', receipt: { ...receipt(), operationId: 'other-operation' } }), /RECEIPT_MISMATCH/);
  s = reduce(s, { type: 'receipt', receipt: receipt('delete') }); assert.equal(s.phase, 'deleted');
  assert.equal(reduce(s, { type: 'read_error', code: 'NOT_FOUND' }).phase, 'deleted');
});
test('known rejection and all recovery errors preserve input and prevent writes until successful read', () => {
  for (const code of ['UNAUTHENTICATED', 'NOT_FOUND', 'PLAN_CONFLICT', 'SERVICE_UNAVAILABLE'] as const) {
    const s = reduce(ready(), { type: 'read_error', code });
    assert.equal(s.input?.note, '虚构保存内容');
    assert.throws(() => reduce(s, { type: 'begin_write', operationId: 'new-operation' }), /RECOVERY_REQUIRED/);
  }
  const writing = reduce(ready(), { type: 'begin_write', operationId: 'fictional-operation' });
  const rejected: PlanOperationReceipt = { ...receipt(), outcome: 'rejected', planId: null, resultingRevision: null, failureCode: 'PLAN_CONFLICT' };
  const s = reduce(writing, { type: 'receipt', receipt: rejected });
  assert.equal(s.phase, 'read_required'); assert.equal(s.error, 'PLAN_CONFLICT'); assert.equal(s.input?.note, '虚构保存内容');
});
