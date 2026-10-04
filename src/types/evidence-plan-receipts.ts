import type { PlanErrorCode } from './evidence-plan-protocol';

/** Offline contract only; no route, database or browser persistence implements this yet. */
export type PlanOperation = 'create_plan' | 'review_row' | 'confirm_plan' | 'delete';
export type PlanWriteFailure = PlanErrorCode | 'OPERATION_CONFLICT';
interface ReceiptBase {
  contractVersion: 'evidence-plan-receipt/2';
  operationId: string;
  operation: PlanOperation;
  resolvedAt: string;
}
export type PlanOperationReceipt = ReceiptBase & (
  | { outcome: 'applied'; planId: string; resultingRevision: number; failureCode: null }
  | { outcome: 'rejected'; planId: null; resultingRevision: null; failureCode: PlanWriteFailure }
);
/** References alone may survive refresh; no JD, profile or notes in browser storage. */
export interface PlanRecoveryReference { planId: string | null; operationId: string | null }
