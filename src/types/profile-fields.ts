import type { ProfileFact } from "./job-copilot";

/** Presentation-only boundary. Ownership, IDs, save/version/reload logic belong to Codex. */
export interface ProfileFieldsProps {
  facts: readonly ProfileFact[];
  directions: string;
  disabled: boolean;
  invalidFactId: string | null;
  onDirectionsChange: (value: string) => void;
  onFactChange: (id: string, patch: Partial<Omit<ProfileFact, "factId">>) => void;
  onAddFact: () => void;
  onRemoveFact: (id: string) => void;
}
