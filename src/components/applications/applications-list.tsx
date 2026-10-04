import type { ApplicationRecord } from "@/types/job-copilot";
import {
  APPLICATION_STATUS_LABELS,
  EMPTY_FIELD,
  NOT_APPLIED,
  STATUS_TONES,
} from "./labels";
import styles from "./applications-list.module.css";

/**
 * Read-only renderer for a list of application records.
 *
 * Deliberate boundaries:
 * - The fixture order is displayed as given: no sorting, filtering, or grouping.
 * - Nothing is editable, deletable, or transitionable from here.
 * - `userId` is never rendered, even though it is present on the contract. The
 *   record `id` is shown because the task needs a stable handle for debugging.
 * - `analysisId` is displayed only when it holds a real value. A record without an
 *   analysis must not appear to link to a report.
 */

function Field({ label, value }: { label: string; value: string | null }) {
  const empty = value === null;
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={`${styles.fieldValue} ${empty ? styles.fieldValueMuted : ""}`}>
        {empty ? EMPTY_FIELD : value}
      </dd>
    </div>
  );
}

/**
 * `preparing` means no submission happened yet, so a missing date reads as
 * "尚未投递" rather than the generic "未填写". Other withdrawn dates fall back to
 * the generic placeholder.
 */
function AppliedOnField({ record }: { record: ApplicationRecord }) {
  const unresolved =
    record.appliedOn === null ? (record.status === "preparing" ? NOT_APPLIED : EMPTY_FIELD) : null;
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>投递日期</dt>
      <dd className={`${styles.fieldValue} ${unresolved ? styles.fieldValueMuted : ""}`}>
        {unresolved ?? record.appliedOn}
      </dd>
    </div>
  );
}

function ApplicationCard({ record }: { record: ApplicationRecord }) {
  const statusLabel = APPLICATION_STATUS_LABELS[record.status];

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardHeading}>
          <p className={styles.company}>{record.company}</p>
          <h2 className={styles.jobTitle}>{record.jobTitle}</h2>
        </div>
        <span className={`${styles.statusBadge} ${STATUS_TONES[record.status]}`}>{statusLabel}</span>
      </div>

      <dl className={styles.fields}>
        <Field label="城市" value={record.city} />
        <Field label="方向" value={record.direction} />
        <AppliedOnField record={record} />
      </dl>

      <div className={styles.notes}>
        <p className={styles.notesLabel}>下一步动作</p>
        <p className={`${styles.notesText} ${record.nextAction === null ? styles.fieldValueMuted : ""}`}>
          {record.nextAction ?? EMPTY_FIELD}
        </p>
      </div>

      <div className={styles.notes}>
        <p className={styles.notesLabel}>备注</p>
        <p className={`${styles.notesText} ${record.notes === null ? styles.fieldValueMuted : ""}`}>
          {record.notes ?? EMPTY_FIELD}
        </p>
      </div>

      <div className={styles.trace}>
        <span>记录 ID</span>
        <span className={styles.traceId}>{record.id}</span>
        <span aria-hidden="true">·</span>
        <span>关联分析</span>
        {record.analysisId === null ? (
          // No report was produced for this record. Show the absence plainly instead
          // of fabricating a link to a report that does not exist.
          <span className={styles.analysisAbsent}>未关联分析报告</span>
        ) : (
          <span className={styles.analysisLink}>{record.analysisId}</span>
        )}
      </div>
    </li>
  );
}

export function ApplicationsList({ records }: { records: ApplicationRecord[] }) {
  return (
    <ul className={styles.list}>
      {records.map((record) => (
        <ApplicationCard key={record.id} record={record} />
      ))}
    </ul>
  );
}
