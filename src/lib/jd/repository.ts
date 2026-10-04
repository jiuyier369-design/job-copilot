import type { SupabaseClient } from "@supabase/supabase-js";
import type { JdDraft } from "../../types/jd-review.ts";
import { unavailable } from "../api/http.ts";
import { contentOf, JdError, validateContent } from "./content.ts";
import type { JdRepository } from "./service.ts";

function resource(value: unknown): JdDraft {
  if (!value || typeof value !== "object") throw unavailable();
  const row = value as { id: string; revision: number; draft: JdDraft };
  const draft = row.draft;
  if (!draft || draft.id !== row.id || draft.revision !== row.revision || !Number.isSafeInteger(row.revision) || row.revision < 1) throw unavailable();
  try { validateContent(contentOf(draft)); } catch { throw unavailable(); }
  if (draft.confirmation !== null && (!draft.confirmation || draft.confirmation.revision !== draft.revision
    || !/^[a-f0-9]{64}$/.test(draft.confirmation.digest) || !Number.isFinite(Date.parse(draft.confirmation.confirmedAt)))) throw unavailable();
  return draft;
}
/** Server-only privileged client, all operations explicitly filter the verified session owner. */
export function jdRepository(client: SupabaseClient): JdRepository {
  const columns = "id,revision,draft";
  return {
    async load(userId, id) {
      const { data, error } = await client.from("jd_drafts").select(columns).eq("user_id", userId).eq("id", id).maybeSingle();
      if (error) throw unavailable();
      return data === null ? null : resource(data);
    },
    async create(userId, draft) {
      const { data, error } = await client.from("jd_drafts").insert({ id: draft.id, user_id: userId, revision: draft.revision, draft }).select(columns).single();
      if (error) throw unavailable();
      return resource(data);
    },
    async replace(userId, expectedRevision, draft) {
      const { data, error } = await client.from("jd_drafts").update({ revision: draft.revision, draft })
        .eq("user_id", userId).eq("id", draft.id).eq("revision", expectedRevision).select(columns).maybeSingle();
      if (error) throw unavailable();
      if (data === null) throw new JdError("JD_DRAFT_CONFLICT");
      return resource(data);
    },
    async remove(userId, id, expectedRevision) {
      const { data, error } = await client.from("jd_drafts").delete().eq("user_id", userId).eq("id", id).eq("revision", expectedRevision).select("id");
      if (error) throw unavailable();
      if (!data?.length) throw new JdError("JD_DRAFT_CONFLICT");
    },
  };
}
