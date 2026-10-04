"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  JdCategory,
  JdDraft,
  JdDraftCommand,
  JdReviewProps,
  JdReviewResult,
} from "@/types/jd-review";
import { jdCategoryLabels } from "@/types/jd-review";
import { settleJdState } from "@/lib/jd/editor-state";
import { jdClientFailure } from "@/lib/jd/client";
import { jdReviewView } from "@/lib/jd/view-state";
import styles from "./jd-review-workspace.module.css";

/**
 * JD paste and manual review.
 *
 * The component only collects input: the text to segment, the chosen category, the
 * caret position used to split, and the acknowledgement. Every rule that decides what
 * is valid — boundaries, blank children, coverage, confirmation eligibility — lives in
 * the frozen adapter, `transition` and `view-state`. Nothing here re-implements or
 * pre-empts them, mints an id, edits a revision, or calls a model.
 */

/** `null` (待分类) plus the four frozen categories. */
const categoryOptions: { value: string; label: string }[] = [
  { value: "", label: "待分类" },
  ...(Object.keys(jdCategoryLabels) as JdCategory[]).map((value) => ({
    value,
    label: jdCategoryLabels[value],
  })),
];

export function JdReviewWorkspace({ initial, adapter, mode = "demo", restoreId = null, onSaved }: JdReviewProps) {
  const baseId = useId();

  const [rawText, setRawText] = useState(initial?.rawText ?? "");
  const [draft, setDraft] = useState<JdDraft | null>(initial);
  // Set on the first keystroke and never derived from a comparison, so reverting the
  // text by hand still counts as edited until a resegment succeeds.
  const [edited, setEdited] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Guards a second submit that lands before the disabled state is rendered.
  const pendingRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const splitRefs = useRef(new Map<string, HTMLTextAreaElement | null>());

  const view = jdReviewView(draft, edited, pending);

  // Move focus to the message so a keyboard user learns why the action failed.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (mode !== "saved" || !edited) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest?.("a");
      if (link && link.target !== "_blank" && !window.confirm("原文有未提交修改，离开后将丢失。是否继续？")) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", navigate, true); };
  }, [mode, edited]);

  function accept(result: JdReviewResult, replaceText: boolean) {
    const next = settleJdState({ draft, rawText, edited }, result, replaceText);
    setDraft(next.draft); setRawText(next.rawText); setEdited(next.edited);
    if (result.ok) { setAcknowledged(false); onSaved?.(result.data); }
  }
  async function reload(automatic = false) {
    const id = draft?.id ?? restoreId;
    if (id === null || !adapter.load || pendingRef.current) return;
    if (!automatic && (edited || rawText !== draft?.rawText) && !window.confirm("重新读取会替换当前未提交的原文。是否继续？")) return;
    pendingRef.current = true; setPending(true); setError(null);
    let result: JdReviewResult;
    try { result = await adapter.load(id); } catch { result = jdClientFailure(); }
    pendingRef.current = false; setPending(false);
    if (result.ok) accept(result, true); else fail(result);
  }
  const restored = useRef(false);
  useEffect(() => { if (!restored.current && restoreId !== null) { restored.current = true; void reload(true); } }, [restoreId]);

  function fail(result: Extract<JdReviewResult, { ok: false }>) {
    setError({ code: result.error.code, message: result.error.message });
  }

  /**
   * Sends one command. A failure keeps the input and the last accepted draft: only a
   * success response is allowed to replace the draft.
   */
  async function run(command: JdDraftCommand): Promise<JdReviewResult | null> {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let result: JdReviewResult;
    try {
      result = await adapter.execute(command);
    } catch {
      // The contract reports failure through the result union; this only keeps an
      // unexpected throw from leaving the form stuck in a pending state.
      result = { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "请求未能确认完成，当前输入已保留。请主动重新读取或重试。" } };
    }
    pendingRef.current = false;
    setPending(false);
    if (!result.ok) fail(result);
    accept(result, ["create", "replace_text", "delete"].includes(command.action));
    return result;
  }

  async function segment() {
    if (draft) {
      const confirmed = window.confirm(
        "重新分段会清除现有分类和确认记录，之后需要逐条重新核对。是否继续？",
      );
      if (!confirmed) return;
    }
    const result = await run(
      draft
        ? { action: "replace_text", id: draft.id, expectedRevision: draft.revision, rawText }
        : { action: "create", rawText },
    );

  }

  async function classify(segmentId: string, category: JdCategory | null) {
    if (!draft) return;
    setAcknowledged(false);
    const result = await run({
      action: "classify",
      id: draft.id,
      expectedRevision: draft.revision,
      segmentId,
      category,
    });

  }

  async function split(segmentId: string) {
    if (!draft) return;
    const box = splitRefs.current.get(segmentId);
    const segment = draft.segments.find((s) => s.id === segmentId);
    if (!box || !segment) return;
    // Only the caret position is collected; whether it is a usable boundary is the
    // adapter's decision.
    const offset = segment.start + (box.selectionStart ?? 0);
    setAcknowledged(false);
    const result = await run({
      action: "split",
      id: draft.id,
      expectedRevision: draft.revision,
      segmentId,
      offset,
    });

  }

  async function confirm() {
    if (!draft) return;
    const result = await run({
      action: "confirm",
      id: draft.id,
      expectedRevision: draft.revision,
      acknowledged: true,
    });

  }

  async function remove() {
    if (!draft) return;
    const confirmed = window.confirm("删除草稿后会清空当前原文与全部分类。是否继续？");
    if (!confirmed) return;
    const result = await run({
      action: "delete",
      id: draft.id,
      expectedRevision: draft.revision,
    });

  }

  // Resegmenting is required after any text edit; until then the review controls stay
  // inert so nothing is classified against text that no longer matches the segments.
  const reviewLocked = pending || view.mustResegment;

  return (
    <section className={styles.workspace}>
      <div className={styles.pastePanel}>
        <h2 className={styles.panelTitle}>完整 JD 原文</h2>
        <label className={styles.label} htmlFor={`${baseId}-raw`}>
          粘贴完整 JD（保留换行，不做改写或删减）
        </label>
        <textarea
          id={`${baseId}-raw`}
          className={styles.rawInput}
          rows={8}
          value={rawText}
          disabled={pending}
          onChange={(event) => {
            setRawText(event.target.value);
            setEdited(true);
            setAcknowledged(false);
          }}
        />
        <p className={styles.hint}>
          分段、分类和确认都以这段原文为准。原文一旦修改，必须重新分段后才能继续核对。
        </p>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={pending || rawText.trim() === ""}
            onClick={() => void segment()}
          >
            {draft ? "重新分段" : "免费分段"}
          </button>
          {draft ? (
            <button
              type="button"
              className={styles.dangerButton}
              disabled={pending}
              onClick={() => void remove()}
            >
              {mode === "saved" ? "删除草稿" : "删除演示草稿"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>
          <span className={styles.errorCode}>{error.code}</span>
          {error.message}
        </p>
      ) : null}

      {mode === "saved" ? <div className={styles.buttonRow}>
        <a href="/login" target="_blank" rel="noopener noreferrer" className={styles.secondaryButton}>在新标签页登录</a>
        {draft || restoreId ? <button type="button" disabled={pending} className={styles.secondaryButton} onClick={() => void reload()}>重新读取服务器版本</button> : null}
        {error?.code === "SERVICE_UNAVAILABLE" && !draft && !restoreId ? <button type="button" disabled={pending} className={styles.secondaryButton} onClick={() => { if (window.confirm("上次创建结果尚未确认，重试可能产生另一份草稿。是否继续？")) void segment(); }}>重试免费分段</button> : null}
        {error?.code === "NOT_FOUND" || error?.code === "INVALID_INPUT" ? <button type="button" disabled={pending} className={styles.secondaryButton} onClick={() => { if ((!rawText && !draft) || window.confirm("清空当前输入并开始新草稿？")) { setError(null); accept({ ok: true, data: null }, true); } }}>开始新草稿</button> : null}
      </div> : null}
      {mode === "saved" && draft ? <p className={styles.hint}>草稿已保存到当前账号 · 当前版本 {draft.revision}{edited ? " · 原文有未提交修改" : ""}</p> : null}
      <div className={styles.statusRow} role="status">
        <span className={styles.statusChip}>未分类 {view.remaining} 项</span>
        {pending ? <span className={styles.statusNote}>处理中…</span> : null}
        {view.mustResegment ? (
          <span className={styles.statusWarn}>原文已修改：请先重新分段，再继续分类或确认。</span>
        ) : null}
        {view.isConfirmed ? (
          <span className={styles.statusOk}>{mode === "saved" ? "已确认" : "已确认（演示）"}</span>
        ) : view.mustResegment || pending ? null : (
          <span className={styles.statusNote}>未确认</span>
        )}
        {!view.hasRequirement && draft ? (
          <span className={styles.statusWarn}>至少需要一条非“背景信息”的要求才能确认。</span>
        ) : null}
      </div>

      {draft === null ? (
        <p className={styles.empty}>
          {rawText.trim() === ""
            ? "尚无草稿：粘贴完整 JD 后点击“免费分段”。"
            : "尚无草稿：点击“免费分段”生成条目后再逐条核对。"}
        </p>
      ) : (
        <div className={styles.columns}>
          <section className={styles.sourcePanel} aria-label="已分段原文">
            <h2 className={styles.panelTitle}>已分段原文</h2>
            <p className={styles.hint}>
              共 {draft.segments.length} 条 · 草稿版本 {draft.revision} · 规则版本{" "}
              {draft.ruleVersion}
            </p>
            {/* Rendered as text with preserved line breaks; never injected as markup. */}
            <pre className={styles.sourceText}>{draft.rawText}</pre>
          </section>

          <section className={styles.segmentPanel} aria-label="条目与分类">
            <h2 className={styles.panelTitle}>条目与分类</h2>
            <ol className={styles.segmentList}>
              {draft.segments.map((segment) => {
                const text = draft.rawText.slice(segment.start, segment.end);
                const source = draft.rawText.slice(segment.sourceStart, segment.sourceEnd);
                const isBackground = segment.category === "background";
                return (
                  <li key={segment.id} className={styles.segment}>
                    <div className={styles.segmentHead}>
                      <span className={styles.segmentId}>{segment.id}</span>
                      <span className={styles.segmentRange}>
                        位置 {segment.start}–{segment.end}
                      </span>
                    </div>

                    <p className={styles.fieldLabel}>条目原文</p>
                    <p className={styles.segmentText}>{text}</p>

                    <p className={styles.fieldLabel}>整行来源</p>
                    <p className={styles.sourceLine}>{source}</p>

                    <div className={styles.suggestionRow}>
                      <span className={styles.suggestion}>
                        规则建议：{segment.suggestedCategory ? jdCategoryLabels[segment.suggestedCategory] : "无明确建议"}
                      </span>
                      <span className={styles.currentChoice}>
                        当前选择：{segment.category ? jdCategoryLabels[segment.category] : "待分类"}
                      </span>
                    </div>

                    <div className={styles.fieldBlock}>
                      <label className={styles.label} htmlFor={`${baseId}-${segment.id}-category`}>
                        分类（{segment.id}）
                      </label>
                      <select
                        id={`${baseId}-${segment.id}-category`}
                        className={styles.select}
                        value={segment.category ?? ""}
                        disabled={reviewLocked}
                        onChange={(event) =>
                          void classify(
                            segment.id,
                            event.target.value === "" ? null : (event.target.value as JdCategory),
                          )
                        }
                      >
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isBackground ? (
                      <p className={styles.backgroundNote}>
                        背景信息仅作说明，不进入匹配结论。
                      </p>
                    ) : null}

                    <div className={styles.fieldBlock}>
                      <label className={styles.label} htmlFor={`${baseId}-${segment.id}-split`}>
                        拆分位置（{segment.id}，把光标放在要断开的地方）
                      </label>
                      <textarea
                        id={`${baseId}-${segment.id}-split`}
                        className={styles.splitBox}
                        rows={2}
                        readOnly
                        value={text}
                        ref={(element) => {
                          if (element) splitRefs.current.set(segment.id, element);
                          else splitRefs.current.delete(segment.id);
                        }}
                      />
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={reviewLocked}
                        onClick={() => void split(segment.id)}
                      >
                        在光标处分为两项
                      </button>
                      <p className={styles.hint}>
                        只提交光标位置；边界是否可用由服务端规则判断。
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}

      <section className={styles.confirmPanel} aria-label="确认要求清单">
        <h2 className={styles.panelTitle}>确认要求清单</h2>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={acknowledged}
            disabled={pending || view.mustResegment}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>我已核对全部条目，这份要求清单可以用于分析。</span>
        </label>
        <p className={styles.warnText}>
          确认不代表岗位仍在招聘，也不代表你符合资格。
        </p>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!view.canConfirm || !acknowledged || view.isConfirmed}
            onClick={() => void confirm()}
          >
            确认要求清单
          </button>
          {/* Always disabled: real generation is not connected and must not be simulated. */}
          <button type="button" className={styles.disabledButton} disabled>
            生成报告
          </button>
        </div>
        <p className={styles.hint}>
          {mode === "saved" ? "确认只代表要求清单已核对。生成报告尚未接入，不调用模型。已保存草稿可通过当前页面地址恢复。" : "本页仅演示 JD 核对，真实生成尚未接入，不调用模型。所有内容为内存演示状态，不保存到账号，刷新即丢失。"}
        </p>
      </section>
    </section>
  );
}
