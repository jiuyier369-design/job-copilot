import type { ApplicationStatus } from "@/types/job-copilot";

/**
 * Display-only strings for the read-only applications list.
 *
 * Status wording comes from the frozen fixture (`APPLICATION_STATUS_LABELS`) and is
 * re-exported here so the list components have a single import surface. The values
 * are never submitted anywhere; this route performs no writes.
 */
export { APPLICATION_STATUS_LABELS } from "@/fixtures/applications-demo";

/** Placeholder for an optional field the record carries as `null`. */
export const EMPTY_FIELD = "未填写";

/**
 * `appliedOn` is a second, stricter case: `preparing` means the user has not sent
 * anything yet, so "未填写" would read like missing data rather than a real state.
 */
export const NOT_APPLIED = "尚未投递";

/**
 * Badge colours per status. `preparing` is deliberately muted and neutral — it must
 * not read as progress, and it must never be rendered as "已投递".
 */
export const STATUS_TONES: Record<ApplicationStatus, string> = {
  preparing: "bg-slate-100 text-slate-700 ring-slate-300",
  applied: "bg-sky-50 text-sky-800 ring-sky-200",
  assessment: "bg-violet-50 text-violet-800 ring-violet-200",
  interview: "bg-amber-50 text-amber-800 ring-amber-200",
  offer: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  closed: "bg-slate-100 text-slate-600 ring-slate-200",
};
