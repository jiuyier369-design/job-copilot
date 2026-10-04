"use client";
import { useEffect, useMemo, useState } from "react";
import { JdReviewWorkspace } from "@/components/jd-review/jd-review-workspace";
import { createJdClient } from "@/lib/jd/client";
import { jdPageUrl } from "@/lib/jd/editor-state";
export default function JdReviewPage() {
  const adapter = useMemo(() => createJdClient(), []);
  const [location, setLocation] = useState<{ id: string | null } | null>(null);
  useEffect(() => { setLocation({ id: new URL(window.location.href).searchParams.get("draft") }); }, []);
  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
    <header><p className="text-sm text-slate-500">JOB COPILOT · 测试账号</p><h1 className="text-2xl font-semibold">JD 核对</h1>
    <p className="mt-2 text-sm text-slate-600">粘贴岗位描述，完成免费分段、人工分类和确认。保存到当前登录账号。</p></header>
    {location ? <JdReviewWorkspace initial={null} adapter={adapter} mode="saved" restoreId={location.id}
      onSaved={draft => { window.history.replaceState(window.history.state, "", jdPageUrl(window.location.href, draft)); if (!draft) setLocation({ id: null }); }} /> : <p role="status">正在准备草稿…</p>}
  </main>;
}
