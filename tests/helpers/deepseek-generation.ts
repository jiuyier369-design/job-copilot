import { randomUUID } from 'node:crypto';
import type { GenerationPorts, InternalRun, RunRepository } from '../../src/lib/analysis/runs.ts';
import { ApiError } from '../../src/lib/api/http.ts';
import { buildModelInput } from '../../src/lib/report/model-input.ts';
import { confirmedAnalysisFixture } from './confirmed-analysis.ts';
import type { ProfileData } from '../../src/types/job-copilot.ts';
import type { DeepSeekEnvironment } from '../../src/lib/analysis/deepseek.ts';

export const mockDeepSeekEnv: DeepSeekEnvironment = { ENABLE_DEEPSEEK: 'true', MODEL_PROVIDER: 'deepseek', MODEL_NAME: 'deepseek-flash',
  MODEL_BASE_URL: 'https://api.deepseek.com', MODEL_API_KEY: 'MOCK_KEY_NEVER_REAL', DEEPSEEK_TIMEOUT_MS: '5000', DEEPSEEK_MAX_OUTPUT_TOKENS: '4096' };
export function deepSeekTestInput() {
  const f = confirmedAnalysisFixture();
  const profile: ProfileData = { structureVersion: '1.0.0', targetDirections: [], facts: [
    { factId: 'P1', category: 'project', context: 'personal_project', statement: '虚构个人实践，仅限本地mock。' },
  ] };
  return { ...f, profile, input: buildModelInput({ jdText: f.draft.rawText, jdItems: f.jdItems, profile }) };
}
export function deepSeekEnvelope(content: unknown = deepSeekTestInput().report, finish = 'stop', usage: unknown = {
  prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, prompt_cache_hit_tokens: 200,
}) {
  return { choices: [{ finish_reason: finish, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage };
}
/** In-memory transactional test port, no Supabase or network. */
export function deepSeekGenerationFixture(model: Pick<GenerationPorts, 'model' | 'metadata' | 'modelTimeoutMs' | 'preflight'>) {
  const x = deepSeekTestInput(); let profileVersion = 1, draft = x.draft, writes = 0, reserves = 0;
  const rows = new Map<string, InternalRun>();
  const runs: RunRepository = {
    load: async (u, id) => structuredClone(rows.get(`${u}:${id}`) ?? null),
    reserve: async r => {
      reserves++; const key = `${r.userId}:${r.request.requestId}`, old = rows.get(key);
      if (old) { if (old.fingerprint !== r.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'safe'); return { acquired: false, run: structuredClone(old) }; }
      const run: InternalRun = { id: randomUUID(), requestId: r.request.requestId, fingerprint: r.fingerprint, digest: r.digest,
        status: 'processing', analysisId: null, failureCode: null, startedAt: new Date().toISOString(), finishedAt: null };
      rows.set(key, run); return { acquired: true, run: structuredClone(run) };
    },
    complete: async (u, id) => { const r = rows.get(`${u}:${id}`)!; if (r.status === 'processing') {
      writes++; r.status = 'completed'; r.analysisId = randomUUID(); r.finishedAt = new Date().toISOString(); } return structuredClone(r); },
    finish: async (u, id, status, code) => { const r = rows.get(`${u}:${id}`)!; if (r.status === 'processing') {
      r.status = status; r.failureCode = code; r.finishedAt = new Date().toISOString(); } return structuredClone(r); },
  };
  const ports: GenerationPorts = { ...model, runs, drafts: { load: async () => structuredClone(draft),
    create: async () => { throw Error(); }, replace: async () => { throw Error(); }, remove: async () => { throw Error(); } },
    loadProfile: async () => ({ version: profileVersion, updatedAt: new Date().toISOString(), profile: structuredClone(x.profile) }) };
  const request = { requestId: randomUUID(), draftId: x.draft.id, expectedDraftRevision: x.draft.revision, expectedProfileVersion: 1,
    company: '虚构公司', jobTitle: '虚构岗位', city: null, direction: null, jdSourceUrl: null };
  return { ...x, ports, request, rows, writes: () => writes, reserves: () => reserves,
    changeProfile: () => { profileVersion++; }, changeDraft: () => { draft = { ...draft, revision: draft.revision + 1, confirmation: null }; } };
}
