"use client";
import { useState } from "react";
import { JdReviewWorkspace } from "@/components/jd-review/jd-review-workspace";
import { createJdDemoAdapter } from "@/lib/jd/demo-adapter";
import { jdConfirmedDemo, jdSuggestedDemo, jdUnclassifiedDemo } from "@/fixtures/jd-review-demo";
import type { JdDraft, JdReviewErrorCode } from "@/types/jd-review";

const scenarios: { label: string; initial: JdDraft | null; failure?: JdReviewErrorCode; delay?: number }[] = [
  { label: "空白", initial: null },
  { label: "规则建议", initial: jdSuggestedDemo },
  { label: "待分类", initial: jdUnclassifiedDemo },
  { label: "已确认（演示）", initial: jdConfirmedDemo },
  { label: "错误（下次操作）", initial: jdSuggestedDemo, failure: "SERVICE_UNAVAILABLE" },
  { label: "冲突（下次操作）", initial: jdSuggestedDemo, failure: "JD_DRAFT_CONFLICT" },
  { label: "登录失效（下次操作）", initial: jdSuggestedDemo, failure: "UNAUTHENTICATED" },
  { label: "慢请求", initial: jdSuggestedDemo, delay: 1500 },
];
function createScenario(index: number) {
  const scenario = scenarios[index];
  return { initial: structuredClone(scenario.initial), adapter: createJdDemoAdapter({ initial: scenario.initial, failOnce: scenario.failure, delayMs: scenario.delay ?? 200 }) };
}
export default function JdReviewDemoPage() {
  const [value, setValue] = useState(() => ({ key: 0, props: createScenario(0) }));
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">JD 核对演示</h1>
    <p>仅使用虚构样例与内存适配器，刷新即丢失；不保存到账号、不产生模型费用。请勿粘贴敏感资料。</p>
    <div className="flex flex-wrap gap-2">{scenarios.map((scenario, index) => <button type="button" className="rounded border px-3 py-2" key={scenario.label}
      onClick={() => setValue((previous) => ({ key: previous.key + 1, props: createScenario(index) }))}>{scenario.label}</button>)}</div>
    <JdReviewWorkspace key={value.key} {...value.props} />
  </main>;
}
