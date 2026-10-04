import type { ProfileData, JdItem } from '../../types/job-copilot.ts';
import { reportSchema } from '../report/schema.ts';
import { validateGeneratedReport } from '../report/validate-generated.ts';
import { emitA2Diagnostic, type A2DiagnosticLog } from '../report/diagnostics.ts';
import { DeepSeekConfigurationError, DeepSeekInvalidReport, DeepSeekRejected, DeepSeekUncertain,
  deepSeekHttpError } from './deepseek-errors.ts';
import { deepSeekPrompt, deepSeekPreflight, DEEPSEEK_LIMITS, DEEPSEEK_PROMPT_VERSION, type ModelInput } from './deepseek-prompt.ts';
import { deepSeekEvent, deepSeekUsage, type DeepSeekCallEvent, type TokenUsage } from './deepseek-metrics.ts';
import { ASYNC_MAX_OUTPUT_TOKENS } from './async-config.ts';

export interface DeepSeekEnvironment {
  ENABLE_DEEPSEEK?: string; MODEL_PROVIDER?: string; MODEL_NAME?: string; MODEL_BASE_URL?: string; MODEL_API_KEY?: string;
  DEEPSEEK_MAX_OUTPUT_TOKENS?: string; DEEPSEEK_TIMEOUT_MS?: string;
}
/** Recommended v1 environment value. Missing/invalid configuration still fails closed. */
export const DEEPSEEK_DEFAULT_TIMEOUT_MS = 8000;
function integer(raw: string | undefined, min: number, max: number) {
  if (!raw || !/^\d+$/.test(raw)) throw new DeepSeekConfigurationError('CONFIG_INVALID');
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new DeepSeekConfigurationError('CONFIG_INVALID');
  return n;
}
export function deepSeekConfiguration(env: DeepSeekEnvironment, worker = false) {
  // Supabase Edge exposes window = globalThis without a DOM. A window alias alone is not a browser.
  if ((typeof window !== 'undefined' && 'document' in globalThis) || env.ENABLE_DEEPSEEK !== 'true')
    throw new DeepSeekConfigurationError('PROVIDER_DISABLED');
  if (env.MODEL_PROVIDER !== 'deepseek' || env.MODEL_NAME !== 'deepseek-flash' || env.MODEL_BASE_URL !== 'https://api.deepseek.com')
    throw new DeepSeekConfigurationError('CONFIG_INVALID');
  if (!env.MODEL_API_KEY) throw new DeepSeekConfigurationError('KEY_NOT_CONFIGURED');
  if (!/^[\x21-\x7e]{8,512}$/.test(env.MODEL_API_KEY)) throw new DeepSeekConfigurationError('CONFIG_INVALID');
  return { key: env.MODEL_API_KEY, maxTokens: integer(env.DEEPSEEK_MAX_OUTPUT_TOKENS, 256, worker ? ASYNC_MAX_OUTPUT_TOKENS : 4096),
    timeoutMs: integer(env.DEEPSEEK_TIMEOUT_MS, 1000, worker ? 45000 : DEEPSEEK_DEFAULT_TIMEOUT_MS) };
}
const finishReasons = ['stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'aborted'] as const;
/** Limit response bytes while streaming the HTTP body; API output itself is non-streaming JSON. */
async function bodyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new DeepSeekInvalidReport('EMPTY_CONTENT');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DeepSeekUncertain('MODEL_TIMEOUT');
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > DEEPSEEK_LIMITS.responseBytes) { cancel(); throw new DeepSeekInvalidReport('OUTPUT_TRUNCATED'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new DeepSeekInvalidReport('JSON_INVALID'); }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export const deepSeekMetadata = { reportStructureVersion: '1.0.0' as const, promptVersion: DEEPSEEK_PROMPT_VERSION,
  modelProvider: 'deepseek', modelName: 'deepseek-flash', testDataVersion: null };

/** Environment is supplied only by the server runtime. send is mandatory so tests never fall back to real fetch.
 * One attempt, no SDK, no retries, no tools, no URLs read from JD, no provider response/causes logged. */
export function createDeepSeekModel(env: DeepSeekEnvironment, send: typeof fetch,
  telemetry: (event: DeepSeekCallEvent) => void = () => {}, worker = false, a2Log?: A2DiagnosticLog) {
  const config = deepSeekConfiguration(env, worker);
  return { modelTimeoutMs: config.timeoutMs, preflight: deepSeekPreflight, metadata: deepSeekMetadata,
    async generate(input: ModelInput, _jobTitle: string, callerSignal: AbortSignal): Promise<unknown> {
      const messages = deepSeekPrompt(input); // defensive repeat; normally checked before reserve
      const controller = new AbortController(), signal = AbortSignal.any([callerSignal, controller.signal]);
      const started = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined;
      let usage: TokenUsage | null = null, finishReason: DeepSeekCallEvent['finishReason'] = null;
      let outcome: DeepSeekCallEvent['outcome'] = 'MODEL_RESULT_UNCERTAIN';
      let networkMs: number | null = null, validationMs: number | null = null, responseModelMatched: boolean | null = null;
      let abortHandler: (() => void) | undefined;
      try {
        const interrupted = new Promise<never>((_, reject) => {
          abortHandler = () => reject(new DeepSeekUncertain('MODEL_TIMEOUT'));
          if (signal.aborted) abortHandler(); else signal.addEventListener('abort', abortHandler, { once: true });
          timer = setTimeout(() => controller.abort(), config.timeoutMs);
        });
        const attempt = async () => {
          if (signal.aborted) throw new DeepSeekUncertain('MODEL_TIMEOUT');
          const response = await send('https://api.deepseek.com/chat/completions', { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
            body: JSON.stringify({ model: 'deepseek-flash', messages, thinking: { type: 'disabled' },
              reasoning_effort: 'none', response_format: { type: 'json_object' }, max_tokens: config.maxTokens, stream: false }),
            redirect: 'error', cache: 'no-store', signal });
          // Do not parse error bodies; status is enough for allowlisted classification.
          if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw deepSeekHttpError(response.status); }
          const raw = await bodyJson(response, signal) as Record<string, any>;
          networkMs = Math.round(performance.now() - started);
          if (!raw || typeof raw !== 'object') throw new DeepSeekInvalidReport('REPORT_STRUCTURE_INVALID');
          responseModelMatched = raw.model === 'deepseek-flash';
          usage = deepSeekUsage(raw.usage);
          if (!Array.isArray(raw.choices) || raw.choices.length !== 1) throw new DeepSeekInvalidReport('REPORT_STRUCTURE_INVALID');
          const choice = raw.choices[0];
          if (!choice || !finishReasons.includes(choice.finish_reason)) throw new DeepSeekUncertain('MODEL_RESULT_UNCERTAIN');
          finishReason = choice.finish_reason;
          if (finishReason === 'length') throw new DeepSeekInvalidReport('OUTPUT_TRUNCATED');
          if (finishReason === 'content_filter') throw new DeepSeekRejected('UPSTREAM_REJECTED');
          if (finishReason === 'tool_calls') throw new DeepSeekInvalidReport('REPORT_STRUCTURE_INVALID');
          if (finishReason !== 'stop') throw new DeepSeekUncertain('MODEL_RESULT_UNCERTAIN');
          const message = choice.message;
          if (!message || message.role !== 'assistant' || (message.tool_calls?.length ?? 0) > 0
            || (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()))
            throw new DeepSeekInvalidReport('REPORT_STRUCTURE_INVALID');
          const content = message.content;
          if (typeof content !== 'string' || !content.trim()) throw new DeepSeekInvalidReport('EMPTY_CONTENT');
          let candidate: unknown;
          const validating = performance.now();
          try { candidate = JSON.parse(content); } catch { throw new DeepSeekInvalidReport('JSON_INVALID'); }
          const issues: string[] = []; reportSchema(candidate, 'report', issues);
          if (issues.length) throw new DeepSeekInvalidReport('REPORT_STRUCTURE_INVALID');
          const data = JSON.parse(input.data);
          const profile: ProfileData = { structureVersion: '1.0.0', targetDirections: [], facts: data.profileFacts };
          try { validateGeneratedReport(candidate, { jdText: data.jdText, jdItems: data.reviewedJdItems as JdItem[], profile }); }
          catch (error) { emitA2Diagnostic(error, a2Log); throw new DeepSeekInvalidReport('A2_INVALID'); }
          validationMs = Math.round(performance.now() - validating);
          return candidate;
        };
        const result = await Promise.race([attempt(), interrupted]); outcome = 'valid'; return result;
      } catch (error) {
        const safe = error instanceof DeepSeekRejected || error instanceof DeepSeekInvalidReport || error instanceof DeepSeekUncertain
          ? error : new DeepSeekUncertain(signal.aborted ? 'MODEL_TIMEOUT' : 'NETWORK_FAILED');
        outcome = safe.category; throw safe;
      } finally {
        clearTimeout(timer); if (abortHandler) signal.removeEventListener('abort', abortHandler);
        // Telemetry failure cannot reinterpret a model call or trigger another one.
        try { telemetry(deepSeekEvent(usage, performance.now() - started, finishReason, outcome,
          { networkMs: networkMs ?? Math.round(performance.now() - started), validationMs, responseModelMatched })); } catch { /* no raw logger errors */ }
      }
    },
  };
}
