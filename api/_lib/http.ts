/**
 * Small helpers shared by the two billing functions (§28).
 */

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** A server environment variable, or a thrown error naming the one missing. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}

export class ConfigError extends Error {
  constructor(readonly variable: string) {
    super(`Missing environment variable ${variable}`);
    this.name = 'ConfigError';
  }
}

/** A failure talking to Lemon Squeezy or OpenRouter. Carries no response body. */
export class UpstreamError extends Error {
  constructor(
    readonly service: 'lemonsqueezy' | 'openrouter',
    readonly status: number,
  ) {
    super(`${service} responded ${status}`);
    this.name = 'UpstreamError';
  }
}
