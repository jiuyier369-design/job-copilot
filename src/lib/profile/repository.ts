import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileData } from "../../types/job-copilot.ts";
import type { ProfileResource } from "../../types/api.ts";
import { ApiError, unavailable } from "../api/http.ts";
import { profileSchema } from "../report/schema.ts";
import { profileConflict, type ProfileRepository } from "./handlers.ts";

const columns = "profile_data,version,updated_at";
function resource(value: unknown): ProfileResource {
  if (!value || typeof value !== "object") throw unavailable();
  const row = value as Record<string, unknown>;
  const issues: string[] = [];
  profileSchema(row.profile_data, "profile", issues);
  if (issues.length || !Number.isInteger(row.version) || Number(row.version) < 1 || typeof row.updated_at !== "string") throw unavailable();
  const profile = row.profile_data as ProfileData;
  if (new Set(profile.facts.map((f) => f.factId)).size !== profile.facts.length) throw unavailable();
  return { profile, version: Number(row.version), updatedAt: row.updated_at };
}
function checkError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw profileConflict();
  if (error.code === "23514" || error.code === "22003") throw new ApiError(422, "INVALID_INPUT", "画像未通过数据约束，请核对后重试。");
  throw unavailable();
}
/** Supply ONLY the per-request authenticated client; no admin key in this path. */
export function profileRepository(client: SupabaseClient): ProfileRepository {
  return {
    async load(userId) {
      const { data, error } = await client.from("profiles").select(columns).eq("user_id", userId).maybeSingle();
      checkError(error);
      return data === null ? null : resource(data);
    },
    async create(userId, profile) {
      const { data, error } = await client.from("profiles").insert({ user_id: userId, profile_data: profile }).select(columns).single();
      checkError(error);
      return resource(data);
    },
    async update(userId, profile, expectedVersion) {
      const { data, error } = await client.from("profiles").update({ profile_data: profile })
        .eq("user_id", userId).eq("version", expectedVersion).select(columns).maybeSingle();
      checkError(error);
      if (data === null) throw profileConflict();
      return resource(data);
    },
  };
}
