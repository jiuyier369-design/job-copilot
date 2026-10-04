import { ApiError, invalid, readJson, respond, success } from "../api/http.ts";
import { JdError } from "./content.ts";
import { jdService, type JdRepository } from "./service.ts";

const messages = {
  INVALID_INPUT: "请核对 JD 原文、条目或拆分位置。",
  JD_REVIEW_REQUIRED: "请完成全部分类并确认要求清单；至少需要一条非背景要求。",
  JD_DRAFT_CONFLICT: "草稿已更新，请保留当前输入并重新读取后核对。",
  NOT_FOUND: "草稿不存在或不可访问。",
};
function handled(run: () => Promise<Response>) {
  return respond(async () => {
    try { return await run(); } catch (error) {
      if (error instanceof JdError) throw new ApiError(error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 422 : 409, error.code, messages[error.code]);
      throw error;
    }
  });
}
export function jdHandlers(session: () => Promise<{ userId: string; repository: JdRepository }>) {
  return {
    GET: (request: Request) => handled(async () => {
      const id = new URL(request.url).searchParams.get("id");
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid();
      const { userId, repository } = await session();
      const draft = await repository.load(userId, id);
      if (!draft) throw new JdError("NOT_FOUND");
      return success(draft);
    }),
    POST: (request: Request) => handled(async () => {
      const input = await readJson(request);
      const { userId, repository } = await session();
      return success(await jdService(repository).execute(userId, input));
    }),
  };
}
