import { JD_RULE_VERSION, type JdCategory, type JdDraftContent, type JdSegment } from "../../types/jd-review.ts";
import { JdError } from "./content.ts";

const titles: Record<string, JdCategory> = {
  岗位职责: "core_duty", 工作职责: "core_duty", 职位职责: "core_duty",
  任职要求: "qualification", 岗位要求: "qualification", 任职资格: "qualification",
  加分项: "preferred", 优先条件: "preferred", 优先要求: "preferred",
  公司介绍: "background", 公司简介: "background", 关于我们: "background",
};
const prefix = /^(?:#{1,6}\s*|[-*•●▪]\s*|(?:[（(]?[一二三四五六七八九十\d]+[）).、．])\s*)/;
/** No normalization, rewriting, model call or keyword guessing. */
export function segmentJd(rawText: string): JdDraftContent {
  if (!rawText.trim() || rawText.length > 20000) throw new JdError("INVALID_INPUT");
  const segments: JdSegment[] = [];
  let category: JdCategory | null = null;
  function add(start: number, end: number, sourceStart: number, sourceEnd: number, suggestion: JdCategory | null) {
    if (!rawText.slice(start, end).trim()) return;
    segments.push({ id: `JD${segments.length + 1}`, start, end, sourceStart, sourceEnd, suggestedCategory: suggestion, category: suggestion });
  }
  for (const line of rawText.matchAll(/[^\r\n]+/g)) {
    const start = line.index!;
    const end = start + line[0].length;
    const stripped = line[0].trim().replace(prefix, "").trim();
    const heading = stripped.split(/[:：]/, 1)[0].trim();
    if (Object.hasOwn(titles, heading)) {
      category = titles[heading];
      const colon = line[0].search(/[:：]/);
      if (colon >= 0 && line[0].slice(colon + 1).trim()) {
        add(start, start + colon + 1, start, end, "background");
        add(start + colon + 1, end, start, end, category);
      } else add(start, end, start, end, "background");
      continue;
    }
    // An unrecognized explicit heading ends inherited suggestions.
    if (/^#{1,6}\s/.test(line[0].trim()) || /[:：]\s*$/.test(stripped)) category = null;
    // Conservative inline boundaries: semicolons or spaced list markers; not commas/decimals.
    const boundaries = [start];
    for (const match of line[0].matchAll(/[；;]|\s+(?=(?:[-*•●▪]\s+|\d+[、)]\s*))/g)) {
      boundaries.push(start + match.index! + match[0].length);
    }
    boundaries.push(end);
    const unique = [...new Set(boundaries)].sort((a, b) => a - b);
    for (let i = 1; i < unique.length; i++) add(unique[i - 1], unique[i], start, end, category);
  }
  if (segments.length > 500) throw new JdError("INVALID_INPUT");
  return { ruleVersion: JD_RULE_VERSION, rawText, segments };
}
