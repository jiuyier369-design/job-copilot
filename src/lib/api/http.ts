import type { ApiErrorCode, ApiResult } from "../../types/api.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly issues?: string[];
  constructor(status: number, code: ApiErrorCode, message: string, issues?: string[]) {
    super(message); this.status = status; this.code = code; this.issues = issues;
  }
}
export const unavailable = () => new ApiError(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试。");
export const invalid = (issues?: string[]) => new ApiError(422, "INVALID_INPUT", "请检查输入内容。", issues);
export function success<T>(data: T): Response {
  return Response.json({ ok: true, data } satisfies ApiResult<T>, { headers: { "Cache-Control": "private, no-store" } });
}
export async function respond(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); } catch (error) {
    const e = error instanceof ApiError ? error : unavailable();
    return Response.json({ ok: false, error: { code: e.code, message: e.message, ...(e.issues ? { issues: e.issues } : {}) } },
      { status: e.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
/** Configure canonical origin in deployment; do not trust forwarded Host for CSRF. */
export function checkOrigin(request: Request): void {
  let expected = process.env.APP_ORIGIN;
  if (!expected && process.env.NODE_ENV !== "production") {
    const url = new URL(request.url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) expected = url.origin;
  }
  if (!expected) throw unavailable();
  let canonical: string;
  try { canonical = new URL(expected).origin; } catch { throw unavailable(); }
  if (request.headers.get("origin") !== canonical) {
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "请求来源不被允许。");
  }
}
/** Counts streamed bytes as well as Content-Length. Never echoes the submitted body. */
export async function readJson(request: Request): Promise<unknown> {
  checkOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw invalid();
  const limit = 64 * 1024;
  const tooLarge = () => new ApiError(413, "INVALID_INPUT", "输入超过 64 KiB，请缩短内容。");
  if (Number(request.headers.get("content-length")) > limit) throw tooLarge();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw invalid(); }
}
