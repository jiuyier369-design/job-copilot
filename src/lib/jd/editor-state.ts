import type { JdDraft, JdReviewResult } from '../../types/jd-review.ts';
export interface JdEditorState { draft: JdDraft | null; rawText: string; edited: boolean }
/** Failures never discard local edits or the last accepted server version. */
export function settleJdState(state: JdEditorState, result: JdReviewResult, replaceText: boolean): JdEditorState {
  if (!result.ok) return state;
  return { draft: result.data, rawText: replaceText ? result.data?.rawText ?? '' : state.rawText, edited: replaceText ? false : state.edited };
}
export function jdPageUrl(current: string, draft: JdDraft | null): string {
  const url = new URL(current);
  if (draft) url.searchParams.set('draft',draft.id); else url.searchParams.delete('draft');
  return url.pathname + url.search + url.hash;
}
