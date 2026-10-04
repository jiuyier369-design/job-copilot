"use client";

import { useEffect, useRef, useState } from "react";
import type { ApplicationRecord } from "@/types/job-copilot";
import {
  applicationsDemo,
  applicationsEmptyDemo,
  applicationsErrorDemo,
} from "@/fixtures/applications-demo";
import { ApplicationsList } from "@/components/applications/applications-list";
import styles from "@/components/applications/applications-list.module.css";

/**
 * Read-only demonstration route for the application records list.
 *
 * The three scenarios are local constants. This page never calls a service: the
 * list endpoint is not implemented yet, and the task is limited to display. Switching
 * scenarios only swaps which constant is rendered — nothing is fetched, cached, or
 * persisted, so a refresh always returns to the default scenario.
 */

const scenarios = [
  { name: "records", label: "示例记录" },
  { name: "empty", label: "空记录" },
  { name: "error", label: "读取失败" },
] as const;

type ScenarioName = (typeof scenarios)[number]["name"];

const scenarioNotes: Record<ScenarioName, string> = {
  records: "固定样例 5 条，按样例顺序原样展示。",
  empty: "投递记录为空时的空状态。",
  error: "固定读取失败，展示冻结的 error.code 与 message。",
};

export default function ApplicationsPage() {
  const [scenario, setScenario] = useState<ScenarioName>("records");
  const errorRef = useRef<HTMLDivElement | null>(null);

  const failed = scenario === "error" ? applicationsErrorDemo : null;
  const error = failed && !failed.ok ? failed.error : null;
  const records: ApplicationRecord[] | null = error
    ? null
    : scenario === "empty"
      ? applicationsEmptyDemo
      : applicationsDemo;

  /**
   * The failing state arrives without a user-facing navigation step, so move focus
   * to the alert once it mounts. It is focusable but never a permanent tab stop.
   */
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  /** The demo has no writes; "重试" only returns the view to the demo records. */
  function handleRetry() {
    setScenario("records");
  }

  function selectScenario(next: ScenarioName) {
    setScenario(next);
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.scenarioBar}>
          <span className={styles.scenarioLabel} id="applications-scenario-label">
            演示场景
          </span>
          <div className={styles.scenarioButtons} role="group" aria-labelledby="applications-scenario-label">
            {scenarios.map((item) => (
              <button
                key={item.name}
                type="button"
                className={styles.scenarioButton}
                aria-pressed={scenario === item.name}
                onClick={() => selectScenario(item.name)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.scenarioNote} role="status" aria-live="polite">
          <span className={styles.scenarioNoteLabel}>当前：{scenario}</span>
          {scenarioNotes[scenario]}
        </p>

        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <p className={styles.eyebrow}>APPLICATIONS</p>
              <h1 className={styles.title}>投递记录</h1>
            </div>
            <span className={styles.readonlyBadge}>只读</span>
          </div>
          <p className={styles.subtitle}>
            这里汇总你记录过的投递进度。本页只做展示：不能新增、编辑、删除或改变状态。
            数据为固定演示样例，不代表任何真实投递；场景切换只在本页生效，刷新后回到示例记录。
          </p>
          <div className={styles.summaryRow}>
            {records ? (
              <>
                <span className={styles.countChip}>共 {records.length} 条</span>
                <span className={styles.summaryHint}>按样例给定顺序展示，未按时间或状态排序。</span>
              </>
            ) : (
              <span className={styles.summaryHint}>读取失败，暂时没有可展示的记录。</span>
            )}
          </div>
        </header>

        {error ? (
          <>
            <div
              ref={errorRef}
              className={styles.errorCard}
              role="alert"
              tabIndex={-1}
            >
              <h2 className={styles.errorTitle}>读取投递记录失败</h2>
              <code className={styles.errorCode}>{error.code}</code>
              <p className={styles.errorMessage}>{error.message}</p>
              <button type="button" className={styles.errorAction} onClick={handleRetry}>
                重试演示
              </button>
            </div>
            <p className={styles.footerNote}>
              演示中“重试演示”只会切回示例记录，不会发起真实请求。
            </p>
          </>
        ) : records && records.length > 0 ? (
          <ApplicationsList records={records} />
        ) : (
          <div className={styles.stateCard}>
            <h2 className={styles.stateTitle}>还没有投递记录</h2>
            <p className={styles.stateText}>
              记录投递后可以在这里查看进度、下一步动作和备注。新增投递功能尚未开放，
              当前页面只做展示。
            </p>
            <button type="button" className={styles.stateActionDisabled} disabled>
              新增投递（未开放）
            </button>
          </div>
        )}

        <p className={styles.footerNote}>
          只读演示页面：记录 ID 仅用于排查问题，页面不展示用户标识，也不写入任何数据。
        </p>
      </div>
    </main>
  );
}
