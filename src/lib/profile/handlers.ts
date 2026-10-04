import type { ProfileData } from "../../types/job-copilot.ts";
import type { ProfileResource, SaveProfileRequest } from "../../types/api.ts";
import { ApiError, invalid, readJson, respond, success } from "../api/http.ts";
import { nullable, object, profileSchema, type Check } from "../report/schema.ts";

export interface ProfileRepository {
  load(userId: string): Promise<ProfileResource | null>;
  create(userId: string, profile: ProfileData): Promise<ProfileResource>;
  update(userId: string, profile: ProfileData, expectedVersion: number): Promise<ProfileResource>;
}
export const profileConflict = () => new ApiError(409, "PROFILE_VERSION_CONFLICT", "画像已有新版本，请保留草稿并重新加载后核对。");
export function parseProfileInput(value: unknown): SaveProfileRequest {
  const errors: string[] = [];
  const revision: Check = (v, p, e) => {
    if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 2147483647) e.push(`${p}: expected positive database revision`);
  };
  object({ profile: profileSchema, expectedVersion: nullable(revision) })(value, "input", errors);
  if (errors.length) throw invalid(errors);
  const input = value as SaveProfileRequest;
  if (new Set(input.profile.facts.map((f) => f.factId)).size !== input.profile.facts.length) throw invalid(["画像事实编号不能重复。"]);
  return input;
}
export function profileHandlers(getSession: () => Promise<{ userId: string; repository: ProfileRepository }>) {
  return {
    GET: () => respond(async () => {
      const { userId, repository } = await getSession();
      return success(await repository.load(userId));
    }),
    PUT: (request: Request) => respond(async () => {
      const input = parseProfileInput(await readJson(request));
      const { userId, repository } = await getSession();
      const saved = input.expectedVersion === null
        ? await repository.create(userId, input.profile)
        : await repository.update(userId, input.profile, input.expectedVersion);
      return success(saved);
    }),
  };
}
