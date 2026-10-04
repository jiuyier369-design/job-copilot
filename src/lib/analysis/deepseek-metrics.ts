import { DEEPSEEK_PROMPT_VERSION } from './deepseek-prompt.ts';
import type { DeepSeekErrorCode } from './deepseek-errors.ts';

export const DEEPSEEK_PRICING_VERSION = 'deepseek-flash-2026-10-01-peak-upper';
// USD per million tokens. Peak rate estimates deliberately do not promise off-peak savings.
export const DEEPSEEK_RATES = { hit: 0.006, miss: 0.30, output: 1.20 } as const;
export interface TokenUsage { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens: number | null }
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function deepSeekUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const u = value as Record<string, unknown>;
  if (!count(u.prompt_tokens) || !count(u.completion_tokens) || !count(u.total_tokens)
    || u.total_tokens !== u.prompt_tokens + u.completion_tokens) return null;
  const cached = u.prompt_cache_hit_tokens;
  return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens,
    cacheHitTokens: count(cached) && cached <= u.prompt_tokens ? cached : null };
}
export function estimateDeepSeekUsd(usage: TokenUsage | null): number | null {
  if (!usage) return null;
  const hit = usage.cacheHitTokens ?? 0;
  return (hit * DEEPSEEK_RATES.hit + (usage.inputTokens - hit) * DEEPSEEK_RATES.miss
    + usage.outputTokens * DEEPSEEK_RATES.output) / 1_000_000;
}
export interface DeepSeekCallEvent {
  event: 'analysis-model-call'; provider: 'deepseek'; model: 'deepseek-flash'; promptVersion: typeof DEEPSEEK_PROMPT_VERSION;
  reportStructureVersion: '1.0.0'; pricingVersion: typeof DEEPSEEK_PRICING_VERSION;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cacheHitTokens: number | null;
  elapsedMs: number; finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'insufficient_system_resource' | 'aborted' | null;
  outcome: 'valid' | DeepSeekErrorCode; estimatedUsd: number | null; estimateBasis: 'peak-upper' | null;
  networkMs: number | null; validationMs: number | null; responseModelMatched: boolean | null;
}
/** Rebuild an allowlisted event. Never spread provider payloads, IDs, errors or input objects into logs. */
export function deepSeekEvent(usage: TokenUsage | null, elapsedMs: number, finishReason: DeepSeekCallEvent['finishReason'], outcome: DeepSeekCallEvent['outcome'],
  timing: Pick<DeepSeekCallEvent, 'networkMs' | 'validationMs' | 'responseModelMatched'> = { networkMs: null, validationMs: null, responseModelMatched: null }): DeepSeekCallEvent {
  return { event: 'analysis-model-call', provider: 'deepseek', model: 'deepseek-flash', promptVersion: DEEPSEEK_PROMPT_VERSION,
    reportStructureVersion: '1.0.0', pricingVersion: DEEPSEEK_PRICING_VERSION, inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null, cacheHitTokens: usage?.cacheHitTokens ?? null,
    elapsedMs: Math.max(0, Math.round(elapsedMs)), finishReason, outcome, estimatedUsd: estimateDeepSeekUsd(usage),
    estimateBasis: usage ? 'peak-upper' : null, networkMs: timing.networkMs, validationMs: timing.validationMs,
    responseModelMatched: timing.responseModelMatched };
}
