"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ApiResult, ProfileResource, SaveProfileRequest } from "@/types/api";
import { profileConflictDemo, profileEditorDemo, profileInvalidDemo } from "@/fixtures/profile-demo";
import { ProfileEditor, scenarios, type ScenarioName } from "@/components/profile/profile-editor";
import styles from "@/components/profile/profile-demo-page.module.css";

/**
 * Local, in-memory demonstration adapter.
 *
 * Boundaries this adapter deliberately respects:
 * - It never calls fetch, Supabase or a model.
 * - It performs no server-side validation. Statement/emptiness rules belong to the
 *   API contract (`docs/api-contract.md`), not to this demo.
 * - Accepting a save only echoes the submitted profile back with a bumped version
 *   and the current time. Nothing is persisted; a refresh loses everything.
 */
function buildSuccess(input: SaveProfileRequest): ApiResult<ProfileResource> {
  return {
    ok: true,
    data: {
      profile: input.profile,
      version: (input.expectedVersion ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

function scenarioFixture(name: ScenarioName): ProfileResource | null {
  return name === "empty" ? null : profileEditorDemo;
}

/**
 * A fresh shallow copy per switch. `initial` is a reload channel for the editor,
 * and a new object identity is what tells it to replace the form state.
 */
function scenarioInitial(name: ScenarioName): ProfileResource | null {
  const fixture = scenarioFixture(name);
  if (!fixture) return null;
  return {
    version: fixture.version,
    updatedAt: fixture.updatedAt,
    profile: {
      structureVersion: fixture.profile.structureVersion,
      targetDirections: [...fixture.profile.targetDirections],
      facts: fixture.profile.facts.map((fact) => ({ ...fact })),
    },
  };
}

const scenarioNotes: Record<ScenarioName, string> = {
  saved: "载入固定样例（version 1）；保存会提交 expectedVersion=1。",
  empty: "initial 为 null；首次保存提交 expectedVersion=null。",
  success: "适配器返回输入画像、版本 +1 与当前时间。",
  conflict: "适配器固定返回 409 PROFILE_VERSION_CONFLICT，草稿保留。",
  invalid: "适配器固定返回 422 INVALID_INPUT 并带 issues。",
  exception: "适配器 Promise 抛错，页面展示可重试消息。",
};

export default function ProfilePage() {
  const [scenario, setScenario] = useState<ScenarioName>("saved");
  const [initial, setInitial] = useState<ProfileResource | null>(() => scenarioInitial("saved"));

  // The adapter reads the latest scenario without needing to be rebuilt on each render.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const onSave = useCallback((input: SaveProfileRequest): Promise<ApiResult<ProfileResource>> => {
    switch (scenarioRef.current) {
      case "conflict":
        return Promise.resolve(profileConflictDemo);
      case "invalid":
        return Promise.resolve(profileInvalidDemo);
      case "exception":
        return Promise.reject(new Error("演示适配器模拟请求异常：可以点“保存画像”重试。"));
      default:
        return Promise.resolve(buildSuccess(input));
    }
  }, []);

  const onSaveStable = useMemo(() => onSave, [onSave]);

  /**
   * Scenario switching is a page concern. It replaces the sample wholesale, so it
   * asks before discarding a draft the user may still want.
   */
  const handleScenarioChange = useCallback((next: ScenarioName) => {
    if (next === scenario) return;
    const confirmed = window.confirm(
      "切换演示场景会卸载当前样例并载入另一份固定样例，未保存的编辑将丢失。是否继续？",
    );
    if (!confirmed) return;
    setScenario(next);
    setInitial(scenarioInitial(next));
  }, [scenario]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.scenarioBar}>
          <span className={styles.scenarioLabel} id="demo-scenario-label">
            演示场景
          </span>
          <div className={styles.scenarioButtons} role="group" aria-labelledby="demo-scenario-label">
            {scenarios.map((item) => (
              <button
                key={item.name}
                type="button"
                className={styles.scenarioButton}
                aria-pressed={scenario === item.name}
                onClick={() => handleScenarioChange(item.name)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.scenarioNote}>
          <span className={styles.scenarioNoteLabel}>当前：{scenario}</span>
          {scenarioNotes[scenario]}
        </p>

        <ProfileEditor initial={initial} onSave={onSaveStable} />
      </div>
    </main>
  );
}
