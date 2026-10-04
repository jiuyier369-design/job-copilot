import type { PlanOperationReceipt, PlanRecoveryReference, PlanWriteFailure } from '../../types/evidence-plan-receipts.ts';

/** Pure local model of the agreed recovery policy; not a fetch client or persistence adapter. */
export interface ReceiptRecovery<T> {
  reference: PlanRecoveryReference;
  phase: 'ready' | 'writing' | 'unresolved' | 'read_required' | 'deleted';
  input: T | null;
  lastSaved: T | null;
  dirty: boolean;
  editSerial: number;
  readSerial: number;
  error: PlanWriteFailure | null;
}
export function restoreReceiptRecovery<T>(reference: PlanRecoveryReference): ReceiptRecovery<T> {
  return { reference: { ...reference }, phase: reference.operationId ? 'unresolved' : 'read_required',
    input: null, lastSaved: null, dirty: false, editSerial: 0, readSerial: 0, error: null };
}
export type ReceiptRecoveryEvent<T> =
  | { type: 'edit'; input: T }
  | { type: 'begin_write'; operationId: string }
  | { type: 'write_unknown' }
  | { type: 'receipt'; receipt: PlanOperationReceipt }
  | { type: 'begin_read' }
  | { type: 'loaded'; input: T; replaceConfirmed: boolean }
  | { type: 'read_error'; code: ReceiptRecovery<T>['error'] };
export function receiptRecoveryReducer<T>(s: ReceiptRecovery<T>, e: ReceiptRecoveryEvent<T>): ReceiptRecovery<T> {
  switch (e.type) {
    case 'edit': return { ...s, input: structuredClone(e.input), dirty: true, editSerial: s.editSerial + 1 };
    case 'begin_write':
      if (s.phase !== 'ready' || s.error !== null) throw new Error('RECOVERY_REQUIRED');
      return { ...s, phase: 'writing', reference: { ...s.reference, operationId: e.operationId }, error: null };
    case 'write_unknown': return { ...s, phase: 'unresolved', error: 'SERVICE_UNAVAILABLE' };
    case 'receipt': {
      if (e.receipt.operationId !== s.reference.operationId) throw new Error('RECEIPT_MISMATCH');
      if (e.receipt.outcome === 'rejected') return { ...s, phase: 'read_required', error: e.receipt.failureCode,
        reference: { ...s.reference, operationId: null } };
      return { ...s, reference: { planId: e.receipt.planId, operationId: null },
        phase: e.receipt.operation === 'delete' ? 'deleted' : 'read_required', error: null };
    }
    case 'begin_read': return { ...s, readSerial: s.editSerial };
    case 'loaded':
      if (s.phase === 'unresolved' || s.phase === 'writing' || s.phase === 'deleted') return s;
      return { ...s, phase: 'ready', lastSaved: structuredClone(e.input), error: null,
        ...(s.editSerial === s.readSerial && (!s.dirty || e.replaceConfirmed)
          ? { input: structuredClone(e.input), dirty: false } : {}) };
    case 'read_error': return { ...s, error: e.code }; // Receipt 404 is not a proof of write rejection.
  }
}
