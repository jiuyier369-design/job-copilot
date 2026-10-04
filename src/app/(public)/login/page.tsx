"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SignInForm } from "@/components/sign-in/sign-in-form";
import { createAuthClient } from "@/lib/auth/client";

const auth = createAuthClient();
type State = "checking" | "guest" | "authenticated" | "unavailable";

export default function LoginPage() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    void auth.session().then((result) => {
      if (!active) return;
      if (result.ok) setState("authenticated");
      else if (result.error.code === "UNAUTHENTICATED") setState("guest");
      else { setState("unavailable"); setError(result.error.message); }
    });
    return () => { active = false; };
  }, []);

  async function retry() {
    setState("checking"); setError(null);
    const result = await auth.session();
    if (result.ok) setState("authenticated");
    else if (result.error.code === "UNAUTHENTICATED") setState("guest");
    else { setState("unavailable"); setError(result.error.message); }
  }
  async function signOut() {
    setSigningOut(true); setError(null);
    const result = await auth.signOut();
    if (result.ok) setState("guest");
    else setError(result.error.message);
    setSigningOut(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-5 py-12">
      <Link href="/" className="text-sm text-sky-700 underline">返回 Job Copilot</Link>
      <h1 className="text-3xl font-semibold">登录 Job Copilot</h1>
      <p className="text-sm leading-6 text-slate-600">使用已创建的测试账号登录。当前仅开放测试账号，尚未开放注册。</p>
      {state === "checking" && <p role="status">正在核验会话…</p>}
      {state === "guest" && <SignInForm onSubmit={auth.signIn} onSuccess={() => { setError(null); setState("authenticated"); }} />}
      {state === "authenticated" && <section className="rounded-xl border border-slate-200 p-5">
        <p role="status" className="font-medium">已登录，会话核验通过。</p>
        <Link href="/my-profile" className="my-3 block text-sky-700 underline">打开我的求职画像</Link>
        <p className="my-3 text-sm leading-6 text-slate-600">报告和投递展示页目前仍使用演示数据。</p>
        <button type="button" disabled={signingOut} onClick={() => void signOut()} className="rounded-lg bg-slate-900 px-4 py-3 text-white disabled:opacity-50">{signingOut ? "正在退出…" : "退出当前会话"}</button>
      </section>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
      {state === "unavailable" && <button type="button" onClick={() => void retry()} className="rounded-lg border p-3">重新检查服务</button>}
    </main>
  );
}
