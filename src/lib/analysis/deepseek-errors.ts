import { ApiError } from '../api/http.ts';
import { ReportValidationError } from '../report/validate.ts';
import { ModelRejected, ModelUncertain } from './runs.ts';

/** Internal categories only. Frozen HTTP/run codes remain unchanged. No raw causes. */
export type DeepSeekErrorCode = 'PROVIDER_DISABLED' | 'KEY_NOT_CONFIGURED' | 'CONFIG_INVALID' | 'INPUT_TOO_LARGE'
  | 'AUTH_FAILED' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'UPSTREAM_REJECTED' | 'UPSTREAM_5XX'
  | 'NETWORK_FAILED' | 'MODEL_TIMEOUT' | 'EMPTY_CONTENT' | 'JSON_INVALID' | 'OUTPUT_TRUNCATED'
  | 'REPORT_STRUCTURE_INVALID' | 'A2_INVALID' | 'MODEL_RESULT_UNCERTAIN';
export class DeepSeekConfigurationError extends ApiError {
  readonly category: DeepSeekErrorCode;
  constructor(category: DeepSeekErrorCode) {
    super(category === 'INPUT_TOO_LARGE' ? 413 : 503,
      category === 'INPUT_TOO_LARGE' ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE',
      category === 'INPUT_TOO_LARGE' ? '材料超过分析大小限制，请缩短后重新提交；系统不会截断材料。' : '模型服务暂不可用。');
    this.category = category;
  }
}
export class DeepSeekRejected extends ModelRejected {
  readonly category: DeepSeekErrorCode;
  constructor(category: DeepSeekErrorCode) { super(); this.category = category; }
}
export class DeepSeekInvalidReport extends ReportValidationError {
  readonly category: DeepSeekErrorCode;
  constructor(category: DeepSeekErrorCode) { super([category]); this.category = category; }
}
export class DeepSeekUncertain extends ModelUncertain {
  readonly category: DeepSeekErrorCode;
  constructor(category: DeepSeekErrorCode) { super(); this.category = category; }
}
export function deepSeekHttpError(status: number) {
  if (status === 401 || status === 403) return new DeepSeekRejected('AUTH_FAILED');
  if (status === 402) return new DeepSeekRejected('QUOTA_EXCEEDED');
  if (status === 429) return new DeepSeekRejected('RATE_LIMITED');
  if (status === 400 || status === 422) return new DeepSeekRejected('UPSTREAM_REJECTED');
  // 5xx/unknown may follow execution upstream; never claim no charge or automatically retry.
  return new DeepSeekUncertain(status >= 500 ? 'UPSTREAM_5XX' : 'MODEL_RESULT_UNCERTAIN');
}
