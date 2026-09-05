/**
 * Error taxonomy (§17.1).
 *
 * An agent loop has more failure modes than a request-response app and every
 * one of them happens in front of a learner. They live here as one real
 * taxonomy rather than as scattered try/catch, because the *handling* differs
 * per class: some retry with backoff, some stop the session, some are simply
 * handed back to the model as a tool result for it to route around.
 *
 * Every class carries a message written for a human. "Anthropic rejected that
 * key. Check it in Settings." — not "An error occurred."
 */

export type ChalkErrorKind =
  | 'AuthError'
  | 'RateLimitError'
  | 'OverloadedError'
  | 'NetworkError'
  | 'ContextError'
  | 'SchemaError'
  | 'ToolError'
  | 'SandboxError'
  | 'RefusalError'
  | 'BudgetError'
  | 'LoopError'
  | 'AbortError'
  | 'UnknownError';

export interface ChalkErrorShape {
  kind: ChalkErrorKind;
  /** Shown to the learner. Says what failed and what to do about it. */
  message: string;
  /** Extra context for the trace drawer. Never contains the API key. */
  detail?: string;
  /** Whether the runtime may retry the same call. */
  retryable: boolean;
  /** Seconds to wait before a retry, when the provider told us. */
  retryAfter?: number;
  /** HTTP status, where there was one. */
  status?: number;
}

export class ChalkError extends Error implements ChalkErrorShape {
  readonly kind: ChalkErrorKind;
  readonly detail?: string;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly status?: number;

  constructor(shape: ChalkErrorShape) {
    super(shape.message);
    this.name = shape.kind;
    this.kind = shape.kind;
    this.detail = shape.detail;
    this.retryable = shape.retryable;
    this.retryAfter = shape.retryAfter;
    this.status = shape.status;
  }

  toJSON(): ChalkErrorShape {
    return {
      kind: this.kind,
      message: this.message,
      detail: this.detail,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      status: this.status,
    };
  }
}

const mk =
  (kind: ChalkErrorKind, retryable: boolean) =>
  (message: string, extra: Partial<ChalkErrorShape> = {}): ChalkError =>
    new ChalkError({ kind, message, retryable, ...extra });

export const authError = mk('AuthError', false);
export const rateLimitError = mk('RateLimitError', true);
export const overloadedError = mk('OverloadedError', true);
export const networkError = mk('NetworkError', true);
export const contextError = mk('ContextError', true);
export const schemaError = mk('SchemaError', false);
export const toolError = mk('ToolError', false);
export const sandboxError = mk('SandboxError', false);
export const refusalError = mk('RefusalError', false);
export const budgetError = mk('BudgetError', false);
export const loopError = mk('LoopError', false);
export const abortError = mk('AbortError', false);
export const unknownError = mk('UnknownError', false);

export function isChalkError(e: unknown): e is ChalkError {
  return e instanceof ChalkError;
}

export function asChalkError(e: unknown): ChalkError {
  if (isChalkError(e)) return e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return abortError('The lesson was stopped.');
  }
  if (e instanceof Error) {
    return unknownError(e.message || 'Something went wrong.', { detail: e.stack });
  }
  return unknownError(String(e));
}

/**
 * Map an HTTP failure onto the taxonomy. Every adapter funnels through this so
 * a 429 from OpenRouter and a 429 from Gemini are handled by the same code.
 */
export function errorFromResponse(
  providerLabel: string,
  status: number,
  bodyText: string,
  headers?: Headers,
): ChalkError {
  const detail = truncate(bodyText, 700);
  const retryAfterHeader = headers?.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  if (status === 401 || status === 403) {
    return authError(
      `${providerLabel} rejected that key. Check it in Settings.`,
      { detail, status },
    );
  }
  if (status === 429) {
    return rateLimitError(
      `${providerLabel} is rate-limiting us. Retrying shortly.`,
      { detail, status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined },
    );
  }
  if (status === 529 || status === 503 || status === 502 || status === 504) {
    return overloadedError(`${providerLabel} is overloaded right now.`, { detail, status });
  }
  if (status === 400 && /context|too many tokens|maximum context|token count/i.test(bodyText)) {
    return contextError('The conversation outgrew the model context window.', {
      detail,
      status,
    });
  }
  if (status === 404) {
    return authError(
      `${providerLabel} has no model by that name. Pick another in Settings.`,
      { detail, status },
    );
  }
  if (status >= 500) {
    return overloadedError(`${providerLabel} returned a server error.`, { detail, status });
  }
  return unknownError(`${providerLabel} refused the request (${status}).`, { detail, status });
}

/**
 * Distinguishing a genuine CORS rejection from being offline matters: on
 * Anthropic a CORS failure almost always means the browser-access header is
 * missing, and saying "check your connection" would send someone hunting in
 * the wrong place entirely.
 */
export function errorFromFetchFailure(providerLabel: string, e: unknown): ChalkError {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return abortError('The lesson was stopped.');
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) {
    return networkError('You appear to be offline. Chalk needs a connection to reach the model.');
  }
  const detail = e instanceof Error ? e.message : String(e);
  return networkError(
    `Could not reach ${providerLabel}. This is usually a network problem or a browser blocking the request.`,
    { detail },
  );
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [${s.length - max} more characters]`;
}

/** Exponential backoff with jitter (§17.1): 3 attempts, honoring retry-after. */
export function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.min(30_000, retryAfterSeconds * 1000);
  }
  const base = Math.min(16_000, 1000 * 2 ** attempt);
  return base + Math.random() * 400;
}
