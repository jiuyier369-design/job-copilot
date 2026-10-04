"use client";

import { useRef, useState } from "react";
import { ProfileFields } from "@/components/profile-live/profile-fields";
import { profileEditorDemo } from "@/fixtures/profile-demo";
import type { ProfileFact } from "@/types/job-copilot";

const scenarios = ["普通", "空白", "禁用", "字段错误"] as const;
type Scenario = (typeof scenarios)[number];
export default function ProfileFieldsDemo() {
  const [scenario, setScenario] = useState<Scenario>("普通");
  const [facts, setFacts] = useState<ProfileFact[]>(() => structuredClone(profileEditorDemo.profile.facts));
  const [directions, setDirections] = useState("客户成功\nAI 产品");
  const [lastAction, setLastAction] = useState("尚未编辑");
  const sequence = useRef(0);
  function select(next: Scenario) {
    setScenario(next); setLastAction("场景已切换");
    setDirections(next === "空白" ? "" : "客户成功\nAI 产品");
    const nextFacts = next === "空白" ? [] : structuredClone(profileEditorDemo.profile.facts);
    if (next === "字段错误" && nextFacts[0]) nextFacts[0].statement = "";
    setFacts(nextFacts);
  }
  return <main className="mx-auto max-w-2xl space-y-6 px-5 py-10">
    <h1 className="text-2xl font-semibold">画像字段布局演示</h1>
    <p>仅使用虚构样例，不保存到账号。</p>
    <div className="flex flex-wrap gap-3">{scenarios.map((item) => <button key={item} type="button" aria-pressed={scenario === item} onClick={() => select(item)} className="rounded-lg border p-3">{item}</button>)}</div>
    <ProfileFields facts={facts} directions={directions} disabled={scenario === "禁用"}
      invalidFactId={scenario === "字段错误" ? facts[0]?.factId ?? null : null}
      onDirectionsChange={(value) => { setDirections(value); setLastAction("修改方向"); }}
      onFactChange={(id, patch) => { setFacts((current) => current.map((fact) => fact.factId === id ? { ...fact, ...patch, factId: fact.factId } : fact)); setLastAction(`编辑 ${id}`); }}
      onAddFact={() => { const id = `DEMO-LAYOUT-${++sequence.current}`; setFacts((current) => [...current, { factId: id, category: "project", context: "personal_project", statement: "" }]); setLastAction(`添加 ${id}`); }}
      onRemoveFact={(id) => { setFacts((current) => current.filter((fact) => fact.factId !== id)); setLastAction(`删除 ${id}`); }} />
    <p role="status">{lastAction}</p>
  </main>;
}
