import type { ApiResult, ProfileResource } from "../../types/api.ts";
import type { ProfileData } from "../../types/job-copilot.ts";

export interface EditorState {
  draft: ProfileData; directions: string; version: number | null;
  dirty: boolean; busy: boolean; conflict: boolean; needsLogin: boolean;
  message: string | null; invalidFactId: string | null;
}
export function editorState(resource: ProfileResource | null): EditorState {
  const draft: ProfileData = structuredClone(resource?.profile ?? { structureVersion: "1.0.0" as const, targetDirections: [], facts: [] });
  return { draft, directions: draft.targetDirections.join("\n"), version: resource?.version ?? null,
    dirty: false, busy: false, conflict: false, needsLogin: false, message: null, invalidFactId: null };
}
export type EditorAction =
  | { type: "edit"; draft?: ProfileData; directions?: string }
  | { type: "start" }
  | { type: "invalid"; factId: string }
  | { type: "loaded"; resource: ProfileResource | null }
  | { type: "finish"; result: ApiResult<ProfileResource> };
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "loaded": return editorState(action.resource);
    case "edit": return state.busy ? state : { ...state, draft: action.draft ?? state.draft,
      directions: action.directions ?? state.directions, dirty: true, invalidFactId: null,
      message: state.conflict || state.needsLogin ? state.message : null };
    case "start": return { ...state, busy: true, message: null, invalidFactId: null };
    case "invalid": return { ...state, invalidFactId: action.factId, message: "请填写事实内容。" };
    case "finish": {
      if (action.result.ok) return { ...editorState(action.result.data), message: `已保存，当前版本 ${action.result.data.version}。` };
      return { ...state, busy: false, message: action.result.error.message,
        conflict: state.conflict || action.result.error.code === "PROFILE_VERSION_CONFLICT",
        needsLogin: action.result.error.code === "UNAUTHENTICATED" };
    }
  }
}
export function profilePayload(state: EditorState): ProfileData {
  return { ...state.draft, targetDirections: state.directions.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    facts: state.draft.facts.map((fact) => {
      const { period, organization, ...rest } = fact;
      return { ...rest, statement: fact.statement.trim(), ...(period?.trim() ? { period: period.trim() } : {}),
        ...(organization?.trim() ? { organization: organization.trim() } : {}) };
    }) };
}
