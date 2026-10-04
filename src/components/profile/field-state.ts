import {
  PROFILE_STRUCTURE_VERSION,
  type FactCategory,
  type FactContext,
  type ProfileData,
  type ProfileFact,
} from "@/types/job-copilot";

/**
 * Local, page-only editing state. It is intentionally *not* the wire contract:
 * empty strings are allowed here so that a user can clear a field while typing,
 * while ProfileData / ProfileFact only ever carry trimmed, non-empty strings.
 */
export interface FactFieldState {
  /** Stable ID. Never regenerated while the fact exists in this editing session. */
  factId: string;
  /** true for IDs minted in this session; false for IDs that arrived in `initial`. */
  isNew: boolean;
  category: FactCategory;
  context: FactContext;
  statement: string;
  period: string;
  organization: string;
}

export interface ProfileFieldState {
  targetDirections: string[];
  facts: FactFieldState[];
}

const defaultCategory: FactCategory = "education";
const defaultContext: FactContext = "education";

/** Defaults for a fact that has no demonstration sample to start from. */
export function blankFact(): FactFieldState {
  return {
    factId: newFactId(),
    isNew: true,
    category: defaultCategory,
    context: defaultContext,
    statement: "",
    period: "",
    organization: "",
  };
}

/** Mints a demonstration-only ID. Template is fixed by the task card. */
export function newFactId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `DEMO-${crypto.randomUUID()}`;
  }
  // Only used if randomUUID is unavailable; still unique per session and prefixed DEMO-.
  return `DEMO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toFieldState(fact: ProfileFact): FactFieldState {
  return {
    factId: fact.factId,
    isNew: false,
    category: fact.category,
    context: fact.context,
    statement: fact.statement,
    period: fact.period ?? "",
    organization: fact.organization ?? "",
  };
}

/**
 * Normalizes a demonstration sample into editing state, filling in any field the
 * sample omitted. No fact is invented: an omitted fact is simply not present.
 */
export function profileToFieldState(profile: ProfileData | null): ProfileFieldState {
  if (!profile) return { targetDirections: [], facts: [] };
  return {
    targetDirections: [...profile.targetDirections],
    facts: profile.facts.map(toFieldState),
  };
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Projects editing state back onto the frozen wire contract.
 * Optional fields are omitted (not set to undefined) when blank, so the payload
 * keeps the same JSON shape the server contract expects.
 * Fact IDs are carried through verbatim; nothing is regenerated or reused here.
 */
export function toProfileData(state: ProfileFieldState): ProfileData {
  const facts: ProfileFact[] = state.facts.map((fact) => {
    const next: ProfileFact = {
      factId: fact.factId,
      category: fact.category,
      context: fact.context,
      statement: fact.statement.trim(),
    };
    const period = trimmedOrUndefined(fact.period);
    const organization = trimmedOrUndefined(fact.organization);
    if (period !== undefined) next.period = period;
    if (organization !== undefined) next.organization = organization;
    return next;
  });

  return {
    structureVersion: PROFILE_STRUCTURE_VERSION,
    targetDirections: state.targetDirections.map((d) => d.trim()).filter((d) => d.length > 0),
    facts,
  };
}

/** Demonstrates that serialized JSON actually matches ProfileData, not the editing state. */
export function serializeProfileData(profile: ProfileData): string {
  return JSON.stringify(profile, null, 2);
}

/** Renders the exact SaveProfileRequest body the demonstration adapter receives. */
export function serializeSaveRequest(profile: ProfileData, expectedVersion: number | null): string {
  return JSON.stringify({ profile, expectedVersion }, null, 2);
}
