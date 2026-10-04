import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeepSeekCallEvent } from './deepseek-metrics.ts';

/** Local acceptance only. Ledger contains counters/allowlisted metrics, never inputs or identifiers. */
export const DS2_LEDGER = '.supabase-test-logs/deepseek-ds2-20261001.json';
export const DS2_RECHECK_LEDGER = '.supabase-test-logs/deepseek-ds2-8000-20261001.json';
export const DS2_SCENARIOS = ['smoke', 'product', 'customer-success', 'solutions'] as const;
export interface Ds2Ledger {
  active: number | null; stopped: boolean; attempts: number;
  cases: { scenario: typeof DS2_SCENARIOS[number]; promptBytes: number; inputUpper: number; upperUsd: number;
    attempted: boolean; accepted: boolean; metrics: DeepSeekCallEvent | null }[];
}
export function ds2Enabled(env: { NODE_ENV?: string; ENABLE_DEEPSEEK_DS2?: string; ENABLE_DEEPSEEK?: string; ENABLE_ANALYSIS_FIXTURE?: string }) {
  return env.NODE_ENV !== 'production' && env.ENABLE_DEEPSEEK_DS2 === 'true'
    && env.ENABLE_DEEPSEEK === 'true' && env.ENABLE_ANALYSIS_FIXTURE === 'false';
}
export function previousDs2Budget(root = process.cwd()) {
  const previous = readDs2Ledger(root);
  if (previous.attempts !== 2 || !previous.stopped || !previous.cases[0].accepted
    || previous.cases[0].metrics?.outcome !== 'valid' || previous.cases[1].metrics?.outcome !== 'MODEL_TIMEOUT')
    throw Error('DS2_HISTORY_INVALID');
  return { attempts: previous.attempts,
    knownEstimatedUsd: previous.cases.reduce((n, c) => n + (c.metrics?.estimatedUsd ?? 0), 0),
    usageUnavailableAttempts: previous.cases.filter(c => c.attempted && c.metrics?.estimatedUsd == null).length,
    upperUsd: previous.cases.reduce((n, c) => n + (c.attempted ? c.upperUsd : 0), 0) };
}
export function readDs2Ledger(root = process.cwd(), recheck = false): Ds2Ledger {
  const ledger = JSON.parse(readFileSync(resolve(root, recheck ? DS2_RECHECK_LEDGER : DS2_LEDGER), 'utf8')) as Ds2Ledger;
  const scenarios = recheck ? DS2_SCENARIOS.slice(1) : DS2_SCENARIOS;
  const previousUpper = recheck ? previousDs2Budget(root).upperUsd : 0;
  if (ledger.cases.length !== scenarios.length || ledger.cases.some((c, i) => c.scenario !== scenarios[i]
    || !Number.isSafeInteger(c.promptBytes) || c.promptBytes < 1 || c.promptBytes > 32768
    || !Number.isSafeInteger(c.inputUpper) || c.inputUpper < 1024 || c.inputUpper > 33792
    || c.upperUsd !== (c.inputUpper * .30 + 4096 * 1.20) / 1e6)
    || previousUpper + ledger.cases.reduce((n, c) => n + c.upperUsd, 0) > .10
    || !Number.isInteger(ledger.attempts) || ledger.attempts < 0 || ledger.attempts > scenarios.length
    || ledger.attempts !== ledger.cases.filter(c => c.attempted).length) throw Error('DS2_LEDGER_INVALID');
  return ledger;
}
export function changeDs2Ledger(change: (ledger: Ds2Ledger) => void, root = process.cwd(), recheck = false) {
  const path = resolve(root, recheck ? DS2_RECHECK_LEDGER : DS2_LEDGER), lock = `${path}.lock`;
  const fd = openSync(lock, 'wx');
  try {
    const ledger = readDs2Ledger(root, recheck); change(ledger);
    writeFileSync(`${path}.next`, JSON.stringify(ledger, null, 2)); renameSync(`${path}.next`, path);
  } finally { closeSync(fd); unlinkSync(lock); }
}
/** Consume permission durably BEFORE dispatch. A crash/timeout cannot grant a second attempt. */
export function ds2Fetch(send: typeof fetch, root = process.cwd(), recheck = false): typeof fetch {
  return async (url, init) => {
    if (String(url) !== 'https://api.deepseek.com/chat/completions' || init?.method !== 'POST') throw Error('DS2_TRANSPORT_BLOCKED');
    const body = JSON.parse(String(init.body));
    if (body.model !== 'deepseek-flash' || body.thinking?.type !== 'disabled' || body.reasoning_effort !== 'none'
      || body.response_format?.type !== 'json_object' || body.max_tokens !== 4096 || body.stream !== false)
      throw Error('DS2_PARAMETERS_BLOCKED');
    changeDs2Ledger(ledger => {
      const i = ledger.active;
      if (ledger.stopped || i === null || !Number.isInteger(i) || i !== ledger.attempts || i < 0 || i >= ledger.cases.length
        || ledger.cases[i].attempted || ledger.cases.slice(0, i).some(c => !c.accepted)
        || Buffer.byteLength(JSON.stringify(body.messages), 'utf8') !== ledger.cases[i].promptBytes
        || body.messages.reduce((n:number,m:{content:string})=>n+Buffer.byteLength(m.content,'utf8'),0)+1024>ledger.cases[i].inputUpper)
        throw Error('DS2_BUDGET_BLOCKED');
      ledger.active = null; ledger.cases[i].attempted = true; ledger.attempts++;
    }, root, recheck);
    return send(url, init); // exactly once; never retry or fall back
  };
}
export function ds2Telemetry(event: DeepSeekCallEvent, root = process.cwd(), recheck = false) {
  const previousUpper = recheck ? previousDs2Budget(root).upperUsd : 0;
  changeDs2Ledger(ledger => {
    const c = ledger.cases[ledger.attempts - 1];
    if (!c?.attempted || c.metrics) throw Error('DS2_METRICS_BLOCKED');
    c.metrics = event;
    if (event.outcome !== 'valid' || event.inputTokens === null || event.outputTokens === null
      || event.totalTokens === null || event.estimatedUsd === null || !event.responseModelMatched
      || event.inputTokens > c.inputUpper || event.outputTokens > 4096
      || event.estimatedUsd > c.upperUsd || previousUpper + ledger.cases.reduce((n, x) => n + (x.metrics?.estimatedUsd ?? (x.attempted ? x.upperUsd : 0)), 0) > .10)
      ledger.stopped = true;
  }, root, recheck);
}
