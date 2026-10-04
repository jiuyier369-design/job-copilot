"use client";

import { useEffect, useId, useRef } from "react";
import type { ProfileFieldsProps } from "@/types/profile-fields";
import type { FactCategory, FactContext } from "@/types/job-copilot";
import {
  categoryLabels,
  categoryOptions,
  contextLabels,
  contextOptions,
} from "@/components/profile/labels";
import styles from "./profile-fields.module.css";

/**
 * Profile field layout.
 *
 * Presentation only. It renders the facts it is given and reports edits through the
 * frozen callbacks; it owns no copy of the list, mints no fact ids, and knows nothing
 * about versions, conflicts or saving. The controller (the real host or the preview
 * route) stays the single source of truth.
 *
 * The host already renders a <form>, so this uses a <fieldset> rather than adding a
 * nested form.
 */

/** Shown for the fact named by `invalidFactId`; the wording matches the reducer. */
const STATEMENT_ERROR = "请填写事实内容。";

export function ProfileFields({
  facts,
  directions,
  disabled,
  invalidFactId,
  onDirectionsChange,
  onFactChange,
  onAddFact,
  onRemoveFact,
}: ProfileFieldsProps) {
  const baseId = useId();

  // Statement boxes by fact id, so the invalid fact can be focused without relying on
  // index-derived ids that would change when a fact is removed.
  const statementRefs = useRef(new Map<string, HTMLTextAreaElement | null>());
  // The fact we last moved focus to. Focus only on a change of target so typing in a
  // flagged field does not keep pulling focus back on every keystroke.
  const focusedFactRef = useRef<string | null>(null);

  useEffect(() => {
    if (invalidFactId === null) {
      focusedFactRef.current = null;
      return;
    }
    if (focusedFactRef.current === invalidFactId) return;
    focusedFactRef.current = invalidFactId;
    statementRefs.current.get(invalidFactId)?.focus();
  }, [invalidFactId]);

  return (
    <fieldset disabled={disabled} className={styles.group}>
      <legend className={styles.legend}>画像内容</legend>

      <div className={styles.block}>
        <label className={styles.label} htmlFor={`${baseId}-directions`}>
          求职方向（每行一个）
        </label>
        <textarea
          id={`${baseId}-directions`}
          className={styles.textarea}
          rows={3}
          value={directions}
          disabled={disabled}
          onChange={(event) => onDirectionsChange(event.target.value)}
        />
        <p className={styles.hint}>每行一个方向。保存时会去掉首尾空格和空行。</p>
      </div>

      {facts.length === 0 ? (
        <p className={styles.empty}>
          尚无事实。可以先保存空画像；生成报告前至少需要一条真实经历。
        </p>
      ) : (
        <ul className={styles.factList} role="list">
          {facts.map((fact, index) => {
            const ids = {
              category: `${baseId}-${index}-category`,
              context: `${baseId}-${index}-context`,
              statement: `${baseId}-${index}-statement`,
              statementError: `${baseId}-${index}-statement-error`,
              period: `${baseId}-${index}-period`,
              organization: `${baseId}-${index}-organization`,
              heading: `${baseId}-${index}-heading`,
            };
            const invalid = invalidFactId === fact.factId;

            return (
              <li
                key={fact.factId}
                className={`${styles.fact} ${invalid ? styles.factInvalid : ""}`}
                aria-labelledby={ids.heading}
              >
                {/* The id is assigned by the controller and is never edited here. */}
                <p className={styles.factId} id={ids.heading}>
                  <span className={styles.factIdLabel}>事实编号</span>
                  <span className={styles.factIdValue}>{fact.factId}</span>
                </p>

                <div className={styles.pair}>
                  <div className={styles.block}>
                    <label className={styles.label} htmlFor={ids.category}>
                      类别
                    </label>
                    <select
                      id={ids.category}
                      className={styles.select}
                      value={fact.category}
                      disabled={disabled}
                      onChange={(event) =>
                        onFactChange(fact.factId, {
                          category: event.target.value as FactCategory,
                        })
                      }
                    >
                      {categoryOptions.map((value) => (
                        <option key={value} value={value}>
                          {categoryLabels[value]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.block}>
                    <label className={styles.label} htmlFor={ids.context}>
                      发生场景
                    </label>
                    <select
                      id={ids.context}
                      className={styles.select}
                      value={fact.context}
                      disabled={disabled}
                      onChange={(event) =>
                        onFactChange(fact.factId, {
                          context: event.target.value as FactContext,
                        })
                      }
                    >
                      {contextOptions.map((value) => (
                        <option key={value} value={value}>
                          {contextLabels[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.block}>
                  <label className={styles.label} htmlFor={ids.statement}>
                    事实内容
                  </label>
                  <textarea
                    id={ids.statement}
                    className={styles.textarea}
                    rows={3}
                    value={fact.statement}
                    disabled={disabled}
                    ref={(element) => {
                      if (element) statementRefs.current.set(fact.factId, element);
                      else statementRefs.current.delete(fact.factId);
                    }}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? ids.statementError : undefined}
                    onChange={(event) =>
                      onFactChange(fact.factId, { statement: event.target.value })
                    }
                  />
                  {invalid ? (
                    <p className={styles.error} id={ids.statementError} role="alert">
                      {STATEMENT_ERROR}
                    </p>
                  ) : null}
                </div>

                <div className={styles.pair}>
                  <div className={styles.block}>
                    <label className={styles.label} htmlFor={ids.period}>
                      时间（可选）
                    </label>
                    <input
                      id={ids.period}
                      className={styles.input}
                      value={fact.period ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onFactChange(fact.factId, { period: event.target.value })
                      }
                    />
                  </div>

                  <div className={styles.block}>
                    <label className={styles.label} htmlFor={ids.organization}>
                      组织（可选）
                    </label>
                    <input
                      id={ids.organization}
                      className={styles.input}
                      value={fact.organization ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onFactChange(fact.factId, { organization: event.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Last in the card so keyboard users reach the destructive action
                    only after passing the fields it would remove. */}
                <div className={styles.factFooter}>
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={disabled}
                    onClick={() => onRemoveFact(fact.factId)}
                  >
                    删除此事实
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className={styles.addButton}
        disabled={disabled}
        onClick={onAddFact}
      >
        添加事实
      </button>
    </fieldset>
  );
}
