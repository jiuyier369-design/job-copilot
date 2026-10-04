import type { JdDraft, JdDraftCommand, JdReviewResult, JdReviewErrorCode } from '../../types/jd-review.ts';
import { contentOf, validateContent } from './content.ts';
import { parseJdCommand } from './transition.ts';
import { object, text, integer, nullable } from '../report/schema.ts';

export const validDraftId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const messages: Record<JdReviewErrorCode, string> = {
  INVALID_INPUT: '草稿编号或输入内容无效，请核对后重试，或开始新草稿。',
  NOT_FOUND: '草稿不存在、已删除或不属于当前账号。可以开始新草稿。',
  UNAUTHENTICATED: '登录已失效，当前输入仍保留。请在新标签页登录后主动重新读取。',
  JD_DRAFT_CONFLICT: '服务器已有新版本，当前输入和上次读取的草稿已保留。请重新读取服务器版本后核对。',
  JD_REVIEW_REQUIRED: '请核对全部分类，并勾选确认；至少保留一条非背景要求。',
  FORBIDDEN_ORIGIN: '请求来源无法验证，请从本站打开页面。',
  SERVICE_UNAVAILABLE: '暂时无法确认请求结果，当前输入已保留。请主动重新读取或重试。',
};
export const jdClientFailure = (code: JdReviewErrorCode = 'SERVICE_UNAVAILABLE'): JdReviewResult => ({ ok: false, error: { code, message: messages[code] } });
export async function validJdResource(value: unknown): Promise<boolean> {
  try {
    const errors: string[] = [];
    object({ id: text, revision: integer, ruleVersion: text, rawText: text,
      segments: () => {}, confirmation: nullable(object({ revision: integer, digest: text, confirmedAt: text })) })(value, 'draft', errors);
    if (errors.length) return false;
    const d = value as JdDraft;
    validateContent(contentOf(d));
    if (!validDraftId(d.id) || !Number.isSafeInteger(d.revision) || d.revision < 1 || d.revision > 2147483647) return false;
    if (d.confirmation) {
      if (d.confirmation.revision !== d.revision || !/^[a-f0-9]{64}$/.test(d.confirmation.digest)
        || !Number.isFinite(Date.parse(d.confirmation.confirmedAt)) || d.segments.some(s => s.category === null)
        || !d.segments.some(s => s.category !== 'background')) return false;
      const canonical = ['jd-digest-v1',d.id,d.revision,d.ruleVersion,d.rawText,d.segments.map(s=>[s.id,s.start,s.end,s.sourceStart,s.sourceEnd,s.suggestedCategory,s.category])];
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
      if (Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('') !== d.confirmation.digest) return false;
    }
    return true;
  } catch { return false; }
}
export function createJdClient(send: typeof fetch = fetch, timeoutMs = 15000) {
  async function request(id?: string, input?: JdDraftCommand): Promise<JdReviewResult> {
    if (id !== undefined && !validDraftId(id)) return jdClientFailure('INVALID_INPUT');
    if (input) { try { parseJdCommand(input); } catch { return jdClientFailure('INVALID_INPUT'); } }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([ (async (): Promise<JdReviewResult> => {
        const response = await send(id ? `/api/jd-drafts?id=${encodeURIComponent(id)}` : '/api/jd-drafts', {
          method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
          ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
        });
        const result = await response.json();
        if (response.status === 200 && result?.ok === true && Object.keys(result).sort().join(',') === 'data,ok') {
          if (input?.action === 'delete') return result.data === null ? { ok: true, data: null } : jdClientFailure();
          if (!await validJdResource(result.data)) return jdClientFailure();
          const d = result.data as JdDraft;
          if (id && d.id !== id) return jdClientFailure();
          if (input) {
            if (d.revision !== (input.action === 'create' ? 1 : input.expectedRevision + 1)) return jdClientFailure();
            if (input.action !== 'create' && d.id !== input.id) return jdClientFailure();
            if ((input.action === 'create' || input.action === 'replace_text') && d.rawText !== input.rawText) return jdClientFailure();
            if (input.action === 'confirm' ? !d.confirmation : d.confirmation !== null) return jdClientFailure();
          }
          return { ok: true, data: d };
        }
        const status: Record<string, number[]> = { INVALID_INPUT:[413,422],NOT_FOUND:[404],UNAUTHENTICATED:[401],JD_DRAFT_CONFLICT:[409],JD_REVIEW_REQUIRED:[409],FORBIDDEN_ORIGIN:[403],SERVICE_UNAVAILABLE:[503] };
        const code = result?.error?.code;
        return result?.ok === false && typeof code === 'string' && Object.hasOwn(messages,code) && status[code].includes(response.status)
          ? jdClientFailure(code as JdReviewErrorCode) : jdClientFailure();
      })(), new Promise<JdReviewResult>(resolve => { timer = setTimeout(()=>{controller.abort();resolve(jdClientFailure());},timeoutMs); }) ]);
    } catch { return jdClientFailure(); } finally { clearTimeout(timer); }
  }
  return { load: (id: string) => request(id), execute: (command: JdDraftCommand) => request(undefined, command) };
}
