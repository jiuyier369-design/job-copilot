"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProfileEditorProps, ProfileResource } from "@/types/api";
import type { FactCategory, FactContext } from "@/types/job-copilot";
import {
  blankFact,
  profileToFieldState,
  serializeProfileData,
  serializeSaveRequest,
  toProfileData,
  type FactFieldState,
  type ProfileFieldState,
} from "./field-state";
import { categoryLabel, categoryOptions, contextLabel, contextOptions } from "./labels";
import styles from "./profile-editor.module.css";

/** Demonstration scenarios. They exist only for this page. */
export type ScenarioName = "saved" | "empty" | "success" | "conflict" | "invalid" | "exception";

export interface Scenario {
  name: ScenarioName;
  label: string;
  description: string;
}

export const scenarios: Scenario[] = [
  { name: "saved", label: "已有画像", description: "保存成功，版本递增。" },
  { name: "empty", label: "空画像", description: "首次保存，expectedVersion=null。" },
  { name: "success", label: "保存成功", description: "返回新版本与演示时间。" },
  { name: "conflict", label: "保存冲突", description: "409：保留草稿，不覆盖。" },
  { name: "invalid", label: "校验失败", description: "422：展示 issues。" },
  { name: "exception", label: "请求异常", description: "Promise 抛错，可重试。" },
];

interface FailureState {
  kind: "error" | "conflict";
  code: string;
  message: string;
  issues?: string[];
}

export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function FactIdChip({ factId, isNew }: { factId: string; isNew: boolean }) {
  return (
    <span className={styles.factIds}>
      <span className={styles.factId} title={factId}>
        {factId}
      </span>
      {isNew ? (
        <span className={styles.badgeNew}>本次新增</span>
      ) : (
        <span className={styles.badgeContext}>原有编号</span>
      )}
    </span>
  );
}

export function ProfileEditor({ initial, onSave }: ProfileEditorProps) {
  const baseId = useId();

  const [state, setState] = useState<ProfileFieldState>(() => profileToFieldState(initial?.profile ?? null));
  const [directionDraft, setDirectionDraft] = useState("");
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(initial?.version ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial?.updatedAt ?? null);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(initial?.version ?? null);
  const [dirty, setDirty] = useState(false);

  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [fieldError, setFieldError] = useState<{ factId: string; message: string } | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<string | null>(null);

  /**
   * Fact IDs removed in this session. Tracking them here (rather than diffing against
   * the loaded sample) makes the list exact: deleting the first fact still shows its
   * ID, so a user can verify what is about to be dropped, and it is never reused.
   */
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  // Refs keep async handlers reading the newest values without re-creating callbacks.
  const stateRef = useRef(state);
  stateRef.current = state;
  const expectedVersionRef = useRef(expectedVersion);
  expectedVersionRef.current = expectedVersion;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  /**
   * The newest known-good facts for this editing session, used only to restore a
   * deleted row. Updated on every fact edit so a restore returns what the user had,
   * not the original sample text.
   */
  const sessionSnapshotRef = useRef<{ profile: { facts: FactFieldState[] } }>({ profile: { facts: [] } });
  const initialSnapshotRef = useRef<ProfileResource | null>(initial);
  initialSnapshotRef.current = initial;

  // `initial` is the reload channel: every demo state change arrives as a new
  // reference, which is treated as an explicit reload and never merged.
  const previousInitial = useRef(initial);
  useEffect(() => {
    if (previousInitial.current === initial) return;
    previousInitial.current = initial;
    setState(profileToFieldState(initial?.profile ?? null));
    setDirectionDraft("");
    setAcceptedVersion(initial?.version ?? null);
    setUpdatedAt(initial?.updatedAt ?? null);
    setExpectedVersion(initial?.version ?? null);
    setDirty(false);
    setFailure(null);
    setFieldError(null);
    setSuccessNotice(null);
    setLastPayload(null);
    setRemovedIds([]);
  }, [initial]);

  // Warn before a browser refresh discards the demonstration draft.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const serialized = useMemo(() => serializeProfileData(toProfileData(state)), [state]);
  const contextSummary = state.facts.map((fact) => contextLabel(fact.context)).join("、");

  // Keep the restorable snapshot in step with the current facts (including edits).
  useEffect(() => {
    const known = new Map(sessionSnapshotRef.current.profile.facts.map((f) => [f.factId, f]));
    for (const fact of state.facts) known.set(fact.factId, fact);
    sessionSnapshotRef.current = { profile: { facts: [...known.values()] } };
  }, [state.facts]);

  const updateFact = useCallback(
    (factId: string, patch: Partial<Omit<FactFieldState, "factId" | "isNew">>) => {
      setDirty(true);
      setState((current) => ({
        ...current,
        facts: current.facts.map((fact) => (fact.factId === factId ? { ...fact, ...patch } : fact)),
      }));
      if (patch.statement !== undefined) {
        setFieldError((current) => (current?.factId === factId ? null : current));
      }
    },
    [],
  );

  const addFact = useCallback((preset?: { category: FactCategory; context: FactContext }) => {
    setDirty(true);
    const next = blankFact();
    if (preset) {
      next.category = preset.category;
      next.context = preset.context;
    }
    setState((current) => ({ ...current, facts: [...current.facts, next] }));
    window.setTimeout(() => {
      document.getElementById(`${baseId}-statement-${next.factId}`)?.focus();
    }, 0);
  }, [baseId]);

  const removeFact = useCallback((factId: string) => {
    setDirty(true);
    setState((current) => ({ ...current, facts: current.facts.filter((f) => f.factId !== factId) }));
    setRemovedIds((current) => (current.includes(factId) ? current : [...current, factId]));
    setFieldError((current) => (current?.factId === factId ? null : current));
  }, []);

  /** Puts a removed fact back with its original ID; the ID is restored, never reused for another fact. */
  const restoreFact = useCallback((factId: string, source: FactFieldState) => {
    setDirty(true);
    setState((current) =>
      current.facts.some((fact) => fact.factId === factId) ? current : { ...current, facts: [...current.facts, source] },
    );
    setRemovedIds((current) => current.filter((id) => id !== factId));
  }, []);

  const addDirection = useCallback(() => {
    const value = directionDraft.trim();
    if (value.length === 0) return;
    setDirty(true);
    setState((current) =>
      current.targetDirections.includes(value)
        ? current
        : { ...current, targetDirections: [...current.targetDirections, value] },
    );
    setDirectionDraft("");
  }, [directionDraft]);

  const removeDirection = useCallback((value: string) => {
    setDirty(true);
    setState((current) => ({
      ...current,
      targetDirections: current.targetDirections.filter((d) => d !== value),
    }));
  }, []);

  /** Sends the current draft through the injected onSave contract. */
  const runSave = useCallback(async () => {
    if (pendingRef.current) return;
    const draft = stateRef.current;

    // Local pre-submit check only. It does not replace server validation.
    const firstBlank = draft.facts.find((fact) => fact.statement.trim().length === 0);
    if (firstBlank) {
      setFailure(null);
      setSuccessNotice(null);
      setFieldError({ factId: firstBlank.factId, message: "请填写事实内容后再提交。" });
      window.setTimeout(() => {
        document.getElementById(`${baseId}-statement-${firstBlank.factId}`)?.focus();
      }, 0);
      return;
    }

    const profile = toProfileData(draft);
    const versionSnapshot = expectedVersionRef.current;
    setLastPayload(serializeSaveRequest(profile, versionSnapshot));
    setFieldError(null);
    setSuccessNotice(null);
    setFailure(null);
    setPending(true);
    try {
      const result = await onSave({ profile, expectedVersion: versionSnapshot });
      if (result.ok) {
        setAcceptedVersion(result.data.version);
        setUpdatedAt(result.data.updatedAt);
        setExpectedVersion(result.data.version);
        setDirty(false);
        setSuccessNotice(
          `演示保存成功，适配器返回版本 ${result.data.version}（${formatTimestamp(result.data.updatedAt)}）。刷新页面仍会丢失本次编辑。`,
        );
      } else if (result.error.code === "PROFILE_VERSION_CONFLICT") {
        // Conflict keeps the draft untouched; reload requires explicit confirmation.
        setFailure({
          kind: "conflict",
          code: result.error.code,
          message: result.error.message,
          issues: result.error.issues,
        });
      } else {
        setFailure({
          kind: "error",
          code: result.error.code,
          message: result.error.message,
          issues: result.error.issues,
        });
      }
    } catch (error) {
      setFailure({
        kind: "error",
        code: "CLIENT_DEMO_EXCEPTION",
        message: error instanceof Error ? error.message : "演示适配器抛出了未预期的错误。",
      });
    } finally {
      setPending(false);
    }
  }, [baseId, onSave]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void runSave();
    },
    [runSave],
  );

  /**
   * Reloading restores the fixed sample and discards the draft, so it always asks
   * first. The editor never silently overwrites unsaved input.
   */
  const requestReload = useCallback((reason: "user" | "conflict") => {
    const message =
      reason === "conflict"
        ? "重新加载会丢弃当前草稿并恢复固定演示样例，不会把草稿合并进样例。是否继续？"
        : "删除草稿并重新加载固定演示样例会丢失当前未保存的编辑。是否继续？";
    if (window.confirm(message)) {
      window.location.reload();
    }
  }, []);

  const isFirstSave = expectedVersion === null;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.notice} role="note">
          <strong>演示数据，仅当前页面内有效，不保存到云端。</strong>
          <span className={styles.noticeRefresh}>
            刷新页面后所有编辑都会丢失；画像内容不会提交到服务端。
          </span>
        </p>

        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true">
                J
              </span>
              <span className={styles.brandText}>Job Copilot · 求职画像</span>
            </div>
            <span className={styles.chip}>本地演示适配器</span>
          </div>
          <div className={styles.headerBody}>
            <p className={styles.eyebrow}>PROFILE DEMO</p>
            <h1 className={styles.title}>求职画像（演示）</h1>
            <p className={styles.subtitle}>
              按真实契约编辑求职方向与事实，保存只写入当前页面的内存演示适配器。本页不判断资格、不评价证据、不生成报告。
            </p>
            <div className={styles.headerMeta}>
              <span className={styles.chip}>契约 structureVersion 1.0.0</span>
              <span className={styles.chip}>acceptedVersion {acceptedVersion ?? "null"}</span>
              <span className={styles.chip}>
                {isFirstSave ? "下次保存 expectedVersion=null" : `下次保存 expectedVersion=${expectedVersion}`}
              </span>
              <span className={styles.chip}>草稿 {dirty ? "有未保存编辑" : "无未保存编辑"}</span>
            </div>
          </div>
        </header>

        <div className={styles.layout}>
          <form className={styles.card} onSubmit={onSubmit} noValidate>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>画像内容</h2>
              <span className={styles.counter}>
                {state.targetDirections.length} 个方向 · {state.facts.length} 条事实
              </span>
            </div>
            <p className={styles.cardHint}>
              字段与契约一致：求职方向 + 事实（编号、类别、发生场景、内容，可选时间与组织）。留空也能保存，但空画像不能生成报告。
            </p>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>
                求职方向
                <span className={styles.labelHint}>
                  类别与场景标签只是中文显示，提交时仍写回 contract 原值。
                </span>
              </legend>
              {state.targetDirections.length > 0 ? (
                <ul className={styles.tagList}>
                  {state.targetDirections.map((direction) => (
                    <li key={direction} className={styles.statusTag}>
                      <span className={styles.tagText}>{direction}</span>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => removeDirection(direction)}
                        disabled={pending}
                        aria-label={`删除求职方向 ${direction}`}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  <span className={styles.emptyTitle}>尚未填写求职方向</span>
                  空的方向数组可以保存，但生成报告前需要补充至少一条事实。可在下方填写后点击“添加方向”。
                </p>
              )}
              <div className={styles.inlineForm}>
                <label className={styles.label} htmlFor={`${baseId}-direction-input`}>
                  新增求职方向
                  <input
                    id={`${baseId}-direction-input`}
                    className={styles.input}
                    value={directionDraft}
                    onChange={(event) => setDirectionDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addDirection();
                      }
                    }}
                    placeholder="例如：AI 产品经理"
                    disabled={pending}
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={addDirection}
                  disabled={pending || directionDraft.trim().length === 0}
                >
                  添加方向
                </button>
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>
                事实
                <span className={styles.labelHint}>
                  事实编号创建后不随编辑或排序改变，删除后不复用；本次新增使用 DEMO- 前缀。
                </span>
              </legend>

              <div className={styles.actionGrid}>
                <button type="button" className={styles.button} onClick={() => addFact()} disabled={pending}>
                  添加空白事实
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => addFact({ category: "education", context: "education" })}
                  disabled={pending}
                >
                  添加教育背景
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => addFact({ category: "project", context: "personal_project" })}
                  disabled={pending}
                >
                  添加个人项目
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => addFact({ category: "work", context: "formal_work" })}
                  disabled={pending}
                >
                  添加正式工作
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => addFact({ category: "project", context: "entrepreneurship" })}
                  disabled={pending}
                >
                  添加创业/工作室
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => addFact({ category: "award", context: "competition" })}
                  disabled={pending}
                >
                  添加竞赛经历
                </button>
              </div>

              {state.facts.length === 0 ? (
                <p className={styles.empty}>
                  <span className={styles.emptyTitle}>当前没有任何事实</span>
                  空事实数组可以保存，但生成报告至少需要一条非空事实。用上面的按钮添加一条后再编辑内容。
                </p>
              ) : (
                <ul className={styles.facts}>
                  {state.facts.map((fact, index) => {
                    const statementId = `${baseId}-statement-${fact.factId}`;
                    const categoryId = `${baseId}-category-${fact.factId}`;
                    const contextId = `${baseId}-context-${fact.factId}`;
                    const periodId = `${baseId}-period-${fact.factId}`;
                    const organizationId = `${baseId}-organization-${fact.factId}`;
                    const hasFieldError = fieldError?.factId === fact.factId;
                    return (
                      <li key={fact.factId} className={styles.fact}>
                        <div className={styles.factHead}>
                          <FactIdChip factId={fact.factId} isNew={fact.isNew} />
                          <span className={styles.counter}>第 {index + 1} 条</span>
                        </div>

                        <div className={styles.row}>
                          <label className={styles.label} htmlFor={categoryId}>
                            类别
                            <select
                              id={categoryId}
                              className={styles.select}
                              value={fact.category}
                              onChange={(event) =>
                                updateFact(fact.factId, { category: event.target.value as FactCategory })
                              }
                              disabled={pending}
                            >
                              {categoryOptions.map((option) => (
                                <option key={option} value={option}>
                                  {categoryLabel(option)}（{option}）
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.label} htmlFor={contextId}>
                            发生场景
                            <select
                              id={contextId}
                              className={styles.select}
                              value={fact.context}
                              onChange={(event) =>
                                updateFact(fact.factId, { context: event.target.value as FactContext })
                              }
                              disabled={pending}
                            >
                              {contextOptions.map((option) => (
                                <option key={option} value={option}>
                                  {contextLabel(option)}（{option}）
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className={styles.label} htmlFor={statementId}>
                          事实内容（本地检查必填）
                          <textarea
                            id={statementId}
                            className={`${styles.textarea} ${hasFieldError ? styles.inputInvalid : ""}`}
                            value={fact.statement}
                            onChange={(event) => updateFact(fact.factId, { statement: event.target.value })}
                            disabled={pending}
                            aria-invalid={hasFieldError || undefined}
                            aria-describedby={hasFieldError ? `${statementId}-error` : undefined}
                            placeholder="用一句可核查的话描述这段经历"
                          />
                        </label>
                        {hasFieldError ? (
                          <p className={styles.inlineError} id={`${statementId}-error`} role="alert">
                            {fieldError?.message}
                          </p>
                        ) : null}

                        <div className={styles.row}>
                          <label className={styles.label} htmlFor={periodId}>
                            时间（可选）
                            <input
                              id={periodId}
                              className={styles.input}
                              value={fact.period}
                              onChange={(event) => updateFact(fact.factId, { period: event.target.value })}
                              disabled={pending}
                              placeholder="例如：2024.09 - 2025.06"
                              autoComplete="off"
                            />
                          </label>
                          <label className={styles.label} htmlFor={organizationId}>
                            组织（可选）
                            <input
                              id={organizationId}
                              className={styles.input}
                              value={fact.organization}
                              onChange={(event) =>
                                updateFact(fact.factId, { organization: event.target.value })
                              }
                              disabled={pending}
                              placeholder="例如：某某公司 / 某某大学"
                              autoComplete="off"
                            />
                          </label>
                        </div>

                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonDanger}`}
                            onClick={() => removeFact(fact.factId)}
                            disabled={pending}
                            aria-label={`删除事实 ${fact.factId}`}
                          >
                            删除该事实
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {removedIds.length > 0 ? (
                <div className={styles.empty} role="status">
                  <span className={styles.emptyTitle}>本次会话中被删除的事实编号</span>
                  这些编号保留在此以便核对，可以选择放回；它们不会再被分配给其它事实。
                  <ul className={styles.tagList}>
                    {removedIds.map((id) => {
                      const source = sessionSnapshotRef.current?.profile.facts.find((f) => f.factId === id);
                      const fieldState: FactFieldState = source
                        ? {
                            factId: source.factId,
                            isNew: !initialSnapshotRef.current?.profile.facts.some(
                              (f: { factId: string }) => f.factId === id,
                            ),
                            category: source.category,
                            context: source.context,
                            statement: source.statement,
                            period: source.period ?? "",
                            organization: source.organization ?? "",
                          }
                        : {
                            factId: id,
                            isNew: true,
                            category: "education",
                            context: "education",
                            statement: "",
                            period: "",
                            organization: "",
                          };
                      return (
                        <li key={id} className={styles.statusTag}>
                          <span className={`${styles.factId} ${styles.tagText}`} title={id}>
                            {id}
                          </span>
                          <button
                            type="button"
                            className={styles.ghostButton}
                            onClick={() => restoreFact(id, fieldState)}
                            disabled={pending}
                            aria-label={`放回事实 ${id}`}
                          >
                            放回
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </fieldset>

            {fieldError ? (
              <p className={styles.alert} role="alert">
                <span className={styles.alertTitle}>本地提交前检查未通过</span>
                {fieldError.message} 这只是本地检查，不替代服务器校验。
              </p>
            ) : null}

            {failure ? (
              <div className={`${styles.alert} ${failure.kind === "conflict" ? styles.alertWarn : ""}`} role="alert">
                <span className={styles.alertTitle}>
                  {failure.kind === "conflict"
                    ? "保存冲突 409 PROFILE_VERSION_CONFLICT"
                    : `请求未成功 ${failure.code}`}
                </span>
                {failure.message}
                {failure.issues && failure.issues.length > 0 ? (
                  <ul className={styles.alertList}>
                    {failure.issues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
                {failure.kind === "conflict" ? (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      onClick={() => requestReload("conflict")}
                      disabled={pending}
                    >
                      确认后重新加载固定样例
                    </button>
                    <span className={styles.cardHint}>
                      草稿仍保留在页面内；重新加载需要二次确认，不会自动覆盖你的输入。
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {successNotice ? (
              <p className={`${styles.alert} ${styles.alertSuccess}`} role="status">
                <span className={styles.alertTitle}>演示保存成功</span>
                {successNotice}
              </p>
            ) : null}

            <div className={styles.actions}>
              <button type="submit" className={styles.button} disabled={pending} aria-busy={pending || undefined}>
                {pending
                  ? "正在保存…"
                  : isFirstSave
                    ? "保存画像（expectedVersion=null）"
                    : `保存画像（expectedVersion=${expectedVersion}）`}
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => requestReload("user")}
                disabled={pending}
              >
                删除草稿并重新加载样例
              </button>
            </div>

            <details className={styles.details}>
              <summary>查看本次提交的 ProfileData 与 expectedVersion</summary>
              <pre className={styles.payload}>{lastPayload ?? serialized}</pre>
              <p className={styles.cardHint}>
                最近一次提交显示 SaveProfileRequest；尚未提交时显示当前 ProfileData。下次 expectedVersion 为{" "}
                {expectedVersion === null ? "null" : expectedVersion}。
              </p>
            </details>
          </form>

          <aside className={styles.card} aria-label="演示状态">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>演示场景</h2>
            </div>
            <p className={styles.cardHint}>
              切换场景由页面替换样例数据。存在未保存编辑时页面会先确认，不会无提示清空草稿。
            </p>

            <div className={styles.statusRow}>
              <span className={`${styles.statusTag} ${styles.versionTag}`}>
                acceptedVersion: {acceptedVersion ?? "null"}
              </span>
              <span className={`${styles.statusTag} ${styles.versionTag}`}>
                expectedVersion: {expectedVersion ?? "null"}
              </span>
              <span className={styles.statusTag}>{pending ? "提交中，已禁用重复提交" : "空闲"}</span>
            </div>

            {updatedAt ? (
              <p className={styles.summary}>
                <span className={styles.summaryLabel}>演示记录时间：</span>
                {formatTimestamp(updatedAt)}
              </p>
            ) : (
              <p className={styles.summary}>暂无演示记录时间：本地还没有成功保存过。</p>
            )}
            <p className={styles.summary}>
              <span className={styles.summaryLabel}>场景统计：</span>
              {state.facts.length} 条事实
              {contextSummary.length > 0 ? `，涉及 ${contextSummary}。` : "，尚未填写发生场景。"}
            </p>
            <p className={styles.summary}>
              <span className={styles.summaryLabel}>草稿状态：</span>
              {dirty ? "有未保存编辑，刷新或重新加载会丢失。" : "无未保存编辑，与已接受版本一致。"}
            </p>

            <p className={styles.cardHint} style={{ marginTop: 16 }}>
              本页不扩展 ProfileFact 字段，也不判断资格、证据或报告逻辑。字段不够用时记录问题交回 Codex，不在此处修改契约。
            </p>
          </aside>
        </div>

        <p className={styles.footerNote}>
          本地内存演示适配器 · 无 fetch / Supabase / 模型调用 · 不使用 localStorage 冒充保存 · 不持久化任何内容
        </p>
      </div>
    </main>
  );
}
