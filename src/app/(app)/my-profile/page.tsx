"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApiResult, ProfileResource } from "@/types/api";
import { createProfileClient } from "@/lib/profile/client";
import { ProfileWorkspace } from "@/components/profile-live/profile-workspace";

const client = createProfileClient();
export default function MyProfilePage() {
  const [result, setResult] = useState<ApiResult<ProfileResource | null> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void client.load().then((value) => { if (active) setResult(value); });
    return () => { active = false; };
  }, [attempt]);
  return <main className="mx-auto min-h-screen max-w-2xl space-y-6 px-5 py-10">
    <Link href="/" className="text-sky-700 underline">返回首页</Link>
    <h1 className="text-3xl font-semibold">我的求职画像</h1>
    <p className="text-slate-600">这里读取和保存当前登录账号的画像。开发验收阶段请使用脱敏测试内容。</p>
    {!result && <p role="status">正在读取画像…</p>}
    {result?.ok && <ProfileWorkspace initial={result.data} />}
    {result && !result.ok && <section className="space-y-4">
      <p role="alert">{result.error.message}</p>
      {result.error.code === "UNAUTHENTICATED" ? <Link href="/login" className="text-sky-700 underline">前往登录</Link>
        : <button type="button" className="rounded-lg border p-3" onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>重新读取</button>}
    </section>}
  </main>;
}
