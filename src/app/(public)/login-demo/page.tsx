"use client";

import { useCallback, useRef, useState } from "react";
import type { SignInInput, SignInResult } from "@/types/sign-in";
import {
  signInRateLimitedDemo,
  signInRejectedDemo,
  signInSuccessDemo,
  signInUnavailableDemo,
} from "@/fixtures/sign-in-demo";
import { SignInForm } from "@/components/sign-in/sign-in-form";
import styles from "@/components/sign-in/sign-in-demo-page.module.css";

/**
 * Demonstration route for the sign-in form.
 *
 * The form itself knows nothing about these scenarios: this page injects the
 * simulated `onSubmit`/`onSuccess` callbacks. Codex replaces them with the real
 * HTTP integration; nothing here authenticates, stores a token, or opens a session.
 */

const DEMO_DELAY_MS = 600;

const scenarios = [
  { name: "success", label: "成功" },
  { name: "rejected", label: "凭证错误" },
  { name: "rateLimited", label: "限流" },
  { name: "unavailable", label: "服务不可用" },
  { name: "exception", label: "请求异常" },
] as const;

type ScenarioName = (typeof scenarios)[number]["name"];

const scenarioNotes: Record<ScenarioName, string> = {
  success: "回调返回成功；表单只调用一次 onSuccess，不建立会话。",
  rejected: "回调返回 401 UNAUTHENTICATED，展示冻结 message 并保留邮箱。",
  rateLimited: "回调返回 429 RATE_LIMITED，可稍后重试。",
  unavailable: "回调返回 503 SERVICE_UNAVAILABLE，可重试。",
  exception: "回调 Promise 抛错；表单展示通用可重试提示，不显示原始异常。",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves the frozen fixture for the selected scenario. */
async function resolveScenario(name: ScenarioName): Promise<SignInResult> {
  switch (name) {
    case "success":
      return signInSuccessDemo;
    case "rejected":
      return signInRejectedDemo;
    case "rateLimited":
      return signInRateLimitedDemo;
    case "unavailable":
      return signInUnavailableDemo;
    case "exception":
      throw new Error("演示适配器模拟请求异常。");
  }
}

export default function LoginDemoPage() {
  const [scenario, setScenario] = useState<ScenarioName>("success");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Demonstration diagnostics. They exist so the demo behaviour is checkable
  // without ever echoing the submitted password or request body.
  const [submitCalls, setSubmitCalls] = useState(0);
  const [successCalls, setSuccessCalls] = useState(0);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [passwordInfo, setPasswordInfo] = useState<{ length: number; hasEdgeWhitespace: boolean } | null>(null);

  // The simulated adapter reads the current scenario without being rebuilt each render.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  /**
   * Simulated request. It reports only what cannot be replayed from the password:
   * its length and whether edge whitespace survived, which shows the input was
   * forwarded as typed rather than trimmed.
   */
  const onSubmit = useCallback(async (input: SignInInput): Promise<SignInResult> => {
    setSubmitCalls((count) => count + 1);
    setPasswordInfo({
      length: input.password.length,
      hasEdgeWhitespace: input.password !== input.password.trim(),
    });
    setLastCode(null);
    setCompleted(false);
    // Waiting lets the form's submitting state be observed.
    setBusy(true);
    try {
      await delay(DEMO_DELAY_MS);
      const result = await resolveScenario(scenarioRef.current);
      setLastCode(result.ok ? "ok" : result.error.code);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const onSuccess = useCallback(() => {
    setSuccessCalls((count) => count + 1);
    setCompleted(true);
  }, []);

  /** Switching modes mid-request is blocked so a result cannot be misattributed. */
  function selectScenario(next: ScenarioName) {
    if (busy) return;
    setScenario(next);
    setCompleted(false);
    setLastCode(null);
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.demoWarning}>仅演示，不会登录；请勿输入真实密码</p>

        <div className={styles.scenarioBar}>
          <span className={styles.scenarioLabel} id="sign-in-scenario-label">
            演示场景
          </span>
          <div className={styles.scenarioButtons} role="group" aria-labelledby="sign-in-scenario-label">
            {scenarios.map((item) => (
              <button
                key={item.name}
                type="button"
                className={styles.scenarioButton}
                aria-pressed={scenario === item.name}
                disabled={busy}
                onClick={() => selectScenario(item.name)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.scenarioNote}>
          <span className={styles.scenarioNoteLabel}>当前：{scenario}</span>
          {scenarioNotes[scenario]}
        </p>

        <div className={styles.card}>
          <header className={styles.cardHeader}>
            <p className={styles.eyebrow}>SIGN IN</p>
            <h1 className={styles.title}>登录演示</h1>
            <p className={styles.subtitle}>
              本页只用于演示登录表单的交互和状态。它不会建立真实会话，也不会保存你输入的内容；
              刷新页面即清空。真实登录接口尚未接入。
            </p>
          </header>

          <SignInForm onSubmit={onSubmit} onSuccess={onSuccess} />

          {completed ? (
            <p className={styles.successNotice} role="status">
              演示完成，未建立真实会话。
            </p>
          ) : null}

          <dl className={styles.diagnostics}>
            <div className={styles.diagnosticRow}>
              <dt className={styles.diagnosticLabel}>提交回调调用次数</dt>
              <dd className={styles.diagnosticValue}>{submitCalls}</dd>
            </div>
            <div className={styles.diagnosticRow}>
              <dt className={styles.diagnosticLabel}>成功回调调用次数</dt>
              <dd className={styles.diagnosticValue}>{successCalls}</dd>
            </div>
            <div className={styles.diagnosticRow}>
              <dt className={styles.diagnosticLabel}>最近返回</dt>
              <dd className={styles.diagnosticValue}>{lastCode ?? "—"}</dd>
            </div>
            <div className={styles.diagnosticRow}>
              <dt className={styles.diagnosticLabel}>收到的密码</dt>
              <dd className={styles.diagnosticValue}>
                {passwordInfo
                  ? `长度 ${passwordInfo.length}，含首尾空白：${passwordInfo.hasEdgeWhitespace ? "是" : "否"}`
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className={styles.diagnosticsNote}>
            诊断只显示计数和长度等派生信息，用于验证演示行为，不回显密码或请求体。
          </p>
        </div>
      </div>
    </main>
  );
}
