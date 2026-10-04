/** Local timing only. No source statements, identities, keys or row IDs in the measurement. */
export interface TrialState {
  phase: 'idle' | 'running' | 'paused' | 'finished';
  startedAt: number | null;
  resumedAt: number | null;
  finishedAt: number | null;
  activeMs: number;
  activations: number;
  noteEdits: number;
  checked: number;
  total: number;
  confirmed: boolean;
  viewed: number;
  pending: number;
  markedPending: number;
  eligible: number;
}
export const initialTrial: TrialState = { phase: 'idle', startedAt: null, resumedAt: null, finishedAt: null,
  activeMs: 0, activations: 0, noteEdits: 0, checked: 0, total: 14, confirmed: false,
  viewed: 0, pending: 14, markedPending: 0, eligible: 0 };
export function activeTrialMs(state: TrialState, now: number) {
  return state.activeMs + (state.phase === 'running' && state.resumedAt !== null ? Math.max(0, now - state.resumedAt) : 0);
}
export type TrialEvent = { type: 'start' | 'pause' | 'resume' | 'finish'; now: number }
  | { type: 'activation' | 'note_edit' }
  | ({ type: 'progress'; now: number; checked: number; total: number; confirmed: boolean }
    & Partial<Pick<TrialState, 'viewed' | 'pending' | 'markedPending' | 'eligible'>>);
export function trialReducer(state: TrialState, event: TrialEvent): TrialState {
  switch (event.type) {
    case 'start': return { ...initialTrial, phase: 'running', startedAt: event.now, resumedAt: event.now };
    case 'pause': return state.phase !== 'running' ? state : { ...state, phase: 'paused', activeMs: activeTrialMs(state, event.now), resumedAt: null };
    case 'resume': return state.phase !== 'paused' ? state : { ...state, phase: 'running', resumedAt: event.now };
    case 'finish': return state.phase === 'idle' || state.phase === 'finished' ? state
      : { ...state, phase: 'finished', activeMs: activeTrialMs(state, event.now), finishedAt: event.now, resumedAt: null };
    case 'activation': return state.phase === 'running' ? { ...state, activations: state.activations + 1 } : state;
    case 'note_edit': return state.phase === 'running' ? { ...state, noteEdits: state.noteEdits + 1 } : state;
    case 'progress': {
      const updated = { ...state, checked: event.checked, total: event.total, confirmed: event.confirmed,
        viewed: event.viewed ?? state.viewed, pending: event.pending ?? state.pending,
        markedPending: event.markedPending ?? state.markedPending, eligible: event.eligible ?? state.eligible };
      return event.confirmed && state.phase === 'running' ? trialReducer(updated, { type: 'finish', now: event.now }) : updated;
    }
  }
}
