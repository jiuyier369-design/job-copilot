"use client";

import { useId } from "react";
import type {
  AnalysisRunJobField,
  AnalysisRunPanelProps,
  AnalysisRunUiState,
} from "@/types/analysis-run-ui";
import { analysisRunJobLabels } from "@/types/analysis-run-ui";
import { canShowAnalysisReport } from "@/lib/analysis-run/demo-state";
import styles from "./analysis-run-panel.module.css";

/**
 * Analysis run panel.
 *
 * Display only. It renders the strings the Host hands it and forwards clicks; it never
 * fetches or polls, holds no request identity, derives no version or eligibility, maps
 * no error codes, and stores neither the JD nor the profile. Every permission — whether
 * generation may start, whether status may be queried, whether a report may open — is
 * read from the Host props rather than recomputed here.
 */

const fieldOrder: readonly AnalysisRunJobField[] = [
  "company",
  "jobTitle",
  "city",
  "direction",
  "jdSourceUrl",
];

/**
 * Marks the two fields the frozen contract defines as required so the label can carry a
 * visible marker. This is a display hint only: the wording of any problem still comes
 * from the Host's `fieldErrors`.
 */
const requiredFields: readonly AnalysisRunJobField[] = ["company", "jobTitle"];

/** Visual weight for the current state. The wording always comes from the Host. */
function stateTone(kind: AnalysisRunUiState["kind"]) {
  switch (kind) {
    case "failed":
      return styles.toneFailed;
    case "uncertain":
      return styles.toneUncertain;
    case "requestError":
      return styles.toneError;
    case "blocked":
      return styles.toneBlocked;
    case "completed":
      return styles.toneCompleted;
    case "submitting":
    case "processing":
      return styles.toneBusy;
    default:
      return styles.toneReady;
  }
}

export function AnalysisRunPanel(props: AnalysisRunPanelProps) {
  const baseId = useId();
  const { fields, fieldErrors, state, fieldsDisabled } = props;

  // Whether a report may be opened is a Host decision; the frozen helper also requires a
  // live, saved reference, so a demonstration result can never expose a report link.
  const showReportAction = canShowAnalysisReport(props);

  // The start button belongs to the states that have not started or are starting. It is
  // withheld entirely once a run is under way, finished or uncertain, so it can never be
  // used to fire a second generation; the separate new-request action covers those.
  const showGenerateAction =
    state.kind === "ready" ||
    state.kind === "blocked" ||
    state.kind === "requestError" ||
    state.kind === "submitting";
  const generateEnabled = state.kind === "ready" && props.canGenerate;

  // Rendered whenever the Host allows a query, and kept mounted while one is running so
  // the waiting state is visible. Never polls: a query only happens on this click.
  const showQueryAction = props.canQueryStatus || props.isQuerying;
  const queryEnabled = props.canQueryStatus && !props.isQuerying;

  const busy =
    state.kind === "submitting" || state.kind === "processing" || props.isQuerying;

  const hasActions =
    showGenerateAction ||
    showQueryAction ||
    showReportAction ||
    props.canCreateNewRequest ||
    props.showReviewJd ||
    props.showEditProfile;

  return (
    <section className={styles.panel} aria-label="分析生成面板">
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>岗位信息</h2>
        <div className={styles.fieldGrid}>
          {fieldOrder.map((field) => {
            const inputId = `${baseId}-${field}`;
            const errorId = `${inputId}-error`;
            const error = fieldErrors[field];
            const required = requiredFields.includes(field);
            return (
              <div
                key={field}
                className={`${styles.field} ${field === "jdSourceUrl" ? styles.fieldWide : ""}`}
              >
                <label className={styles.label} htmlFor={inputId}>
                  {analysisRunJobLabels[field]}
                  {required ? (
                    <span className={styles.requiredMark} aria-hidden="true">
                      *
                    </span>
                  ) : null}
                </label>
                <input
                  id={inputId}
                  className={styles.input}
                  type={field === "jdSourceUrl" ? "url" : "text"}
                  value={fields[field]}
                  disabled={fieldsDisabled}
                  aria-required={required || undefined}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => props.onFieldChange(field, event.target.value)}
                />
                {error ? (
                  <p className={styles.fieldError} id={errorId} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className={styles.hint}>带 * 的为必填项。可选项留空即可。</p>
      </div>

      {/* Single live region for the run state: one announcement per change, with no
          second copy of the same message elsewhere on the panel. */}
      <div className={`${styles.stateCard} ${stateTone(state.kind)}`} role="status">
        <h2 className={styles.stateTitle}>{state.title}</h2>
        <p className={styles.stateMessage}>{state.message}</p>
        {props.actionNotice ? (
          <p className={styles.actionNotice}>{props.actionNotice}</p>
        ) : null}
      </div>

      {/* aria-busy marks the whole action area as unavailable while a run or a query is
          in flight; the state card above carries the explanation. */}
      {hasActions ? (
        <div className={styles.actions} aria-busy={busy || undefined}>
          {showGenerateAction ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!generateEnabled}
              onClick={props.onGenerate}
            >
              {props.generateLabel}
            </button>
          ) : null}

          {showQueryAction ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!queryEnabled}
              onClick={props.onQueryStatus}
            >
              查询当前状态
            </button>
          ) : null}

          {showReportAction ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={props.onViewReport}
            >
              查看报告
            </button>
          ) : null}

          {props.canCreateNewRequest ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={props.onCreateNewRequest}
            >
              {props.newRequestLabel}
            </button>
          ) : null}

          {props.showReviewJd ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={props.onReviewJd}
            >
              返回 JD 核对
            </button>
          ) : null}

          {props.showEditProfile ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={props.onEditProfile}
            >
              返回画像页面
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Static Host copy; kept out of the live region so it is not announced twice. */}
      {props.safetyNotice ? <p className={styles.safety}>{props.safetyNotice}</p> : null}
    </section>
  );
}
