/**
 * An in-memory stand-in for the store, for tests only. Nothing outside a test
 * imports this.
 */
export interface Fakes {
  data: Map<string, unknown>;
  storeDown: boolean;
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const STORE_URL = 'https://store.test';

export function fakes(): Fakes {
  const f: Fakes = {
    data: new Map(),
    storeDown: false,
    fetch: async () => respond(500, {}),
  };

  const run = (cmd: (string | number)[]): unknown => {
    const [op, key, ...rest] = cmd.map(String) as [string, string, ...string[]];
    const d = f.data;
    switch (op) {
      case 'INCR': {
        const v = Number(d.get(key) ?? 0) + 1;
        d.set(key, v);
        return v;
      }
      case 'EXPIRE':
        return 1;
      case 'GET':
        return d.has(key) ? String(d.get(key)) : null;
      case 'SET':
        d.set(key, rest[0]);
        return 'OK';
      case 'DEL':
        return d.delete(key) ? 1 : 0;
      case 'PFADD': {
        const s = (d.get(key) as Set<string> | undefined) ?? new Set<string>();
        d.set(key, s);
        s.add(rest[0] ?? '');
        return 1;
      }
      case 'PFCOUNT':
        return (d.get(key) as Set<string> | undefined)?.size ?? 0;
      default:
        throw new Error(`the fake store has no ${op}`);
    }
  };

  f.fetch = async (input, init = {}) => {
    const url = new URL(String(input));

    if (url.origin === STORE_URL) {
      if (f.storeDown) return respond(503, {});
      const commands = JSON.parse(String(init.body)) as (string | number)[][];
      return respond(200, commands.map((c) => ({ result: run(c) })));
    }

    throw new Error(`unexpected request to ${url.host}`);
  };
  return f;
}
