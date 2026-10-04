"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import type { ProfileResource } from "@/types/api";
import { createProfileClient } from "@/lib/profile/client";
import { editorReducer, editorState, profilePayload } from "@/lib/profile/editor-state";
import { ProfileFields } from "./profile-fields";

const client = createProfileClient();
export function ProfileWorkspace({ initial }: { initial: ProfileResource | null }) {
  const [state, dispatch] = useReducer(editorReducer, initial, editorState);
  const [reloadMessage, setReloadMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (!state.dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state.dirty]);
  async function save() {
    if (locked.current || state.conflict) return;
    const profile = profilePayload(state);
    const blank = profile.facts.find((f) => !f.statement);
    if (blank) { dispatch({ type: "invalid", factId: blank.factId }); return; }
    locked.current = true; dispatch({ type: "start" }); setReloadMessage(null);
    const result = await client.save({ profile, expectedVersion: state.version });
    dispatch({ type: "finish", result }); locked.current = false;
  }
  async function reload() {
    if (locked.current) return;
    if ((state.dirty || state.conflict) && !window.confirm("重新读取成功后将替换当前草稿。请先保留需要的内容，是否继续？")) return;
    locked.current = true; setReloading(true); setReloadMessage(null);
    const result = await client.load();
    if (result.ok) dispatch({ type: "loaded", resource: result.data });
    else setReloadMessage(result.error.message);
    locked.current = false; setReloading(false);
  }
  const disabled = state.busy || reloading;
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p>当前版本：{state.version ?? "尚未保存"} · {state.dirty ? "有未保存修改" : "无未保存修改"}</p>
    <ProfileFields facts={state.draft.facts} directions={state.directions} disabled={disabled} invalidFactId={state.invalidFactId}
      onDirectionsChange={(directions) => dispatch({ type: "edit", directions })}
      onFactChange={(id, patch) => dispatch({ type: "edit", draft: { ...state.draft, facts: state.draft.facts.map((f) => f.factId === id ? { ...f, ...patch, factId: f.factId } : f) } })}
      onAddFact={() => dispatch({ type: "edit", draft: { ...state.draft, facts: [...state.draft.facts, { factId: `P-${crypto.randomUUID()}`, category: "project", context: "personal_project", statement: "" }] } })}
      onRemoveFact={(id) => dispatch({ type: "edit", draft: { ...state.draft, facts: state.draft.facts.filter((f) => f.factId !== id) } })} />
    {state.message && <p role="status" className="rounded-lg bg-slate-100 p-4">{state.message}</p>}
    {state.needsLogin && <Link className="block text-sky-700 underline" href="/login" target="_blank" rel="noopener noreferrer">在新页面登录，保留当前草稿</Link>}
    {reloadMessage && <p role="alert" className="text-red-700">{reloadMessage}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={disabled || state.conflict} className="rounded-lg bg-slate-900 px-4 py-3 text-white disabled:opacity-50">{state.busy ? "正在保存…" : "保存画像"}</button>
      <button type="button" disabled={disabled} onClick={() => void reload()} className="rounded-lg border px-4 py-3">{reloading ? "正在读取…" : "重新读取画像"}</button>
    </div>
  </form>;
}
