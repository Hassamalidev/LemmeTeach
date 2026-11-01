/**
 * The whole path a visitor takes (§30), through the real app.
 *
 * Only the network is a stand-in. The rule that matters most here: solving
 * costs money, so a visitor with no plan and no key of their own must never
 * cause a request to a model.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { readShared, shareable } from './share';
import { replayAdapter, savedFigureIds } from '../providers/replay';
import { Session } from '../orchestrator/session';
import { DEFAULT_SETTINGS, forgetAllKeys, setLicense, setKey } from '../storage/settings';
import { MANAGED_PROVIDER_ID } from '../providers/managed';
import type { SolutionRecord } from '../storage/records';
import type { SandboxPort } from '../tools/context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let requests: { url: string; body: string }[];
/** What each address answers. Anything unlisted fails like a dropped connection. */
let routes: Record<string, (body: string) => Response | Promise<Response>>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One turn of a model's stream: a single tool call, in the OpenAI shape. */
function toolTurn(name: string, input: unknown): Response {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(input) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [] },
  ];
  const text = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const PLAN = {
  title: 'Adding two numbers',
  level: 'school',
  subject: 'math',
  problem: 'What is 2 + 2?',
  objectives: [{ id: 'obj-1', text: 'Add them' }, { id: 'obj-2', text: 'Check' }, { id: 'obj-3', text: 'State it' }],
  prerequisites: [],
  steps: [
    { objective: 'obj-1', representation: 'derivation', note: 'Add' },
    { objective: 'obj-2', representation: 'recap', note: 'Check' },
    { objective: 'obj-3', representation: 'recap', note: 'State' },
  ],
  estimatedMinutes: 3,
};

/** A model that solves any question in one step. */
function solvingModel(): (body: string) => Response {
  return (body) => {
    const req = JSON.parse(body) as { tools?: { function: { name: string } }[]; messages: { role: string }[] };
    const tools = (req.tools ?? []).map((t) => t.function.name);
    if (tools.includes('plan_lesson')) return toolTurn('plan_lesson', PLAN);
    const turns = req.messages.filter((m) => m.role === 'assistant').length;
    if (turns === 0) return toolTurn('teach_step', { say: 'Two and two make four.', board: [{ op: 'math', tex: '2 + 2 = {{2+2}}' }] });
    return toolTurn('end_lesson', { summary: 'It is four.' });
  };
}

beforeEach(() => {
  localStorage.clear();
  forgetAllKeys();
  requests = [];
  routes = {};
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : '';
    requests.push({ url, body });
    for (const [match, answer] of Object.entries(routes)) {
      if (url.includes(match)) return answer(body);
    }
    throw new TypeError('Failed to fetch');
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  forgetAllKeys();
});

function open(): void {
  act(() => root.render(createElement(App)));
}

const text = (): string => container.textContent ?? '';

function press(label: string): void {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`no button "${label}" on: ${text().slice(0, 200)}`);
  act(() => button.click());
}

function type(selector: string, value: string): void {
  const el = container.querySelector<HTMLTextAreaElement | HTMLInputElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function until(what: string, test: () => boolean, ms = 12_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (test()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  throw new Error(`timed out waiting for ${what}. On screen: ${text().slice(0, 300)}`);
}

function askFromHome(question = 'What is 2 + 2?'): void {
  type('.hero-ask textarea', question);
  press('Solve it');
}

function onPlan(): void {
  setKey(MANAGED_PROVIDER_ID, 'sk-or-v1-a-provisioned-key-for-this-test', true);
  setLicense({ licenseKey: 'txn_01hv8x2v3k4m5n6p7q8r9s0t1u', planId: 'regular', activatedAt: 1 });
}

const modelRequests = (): string[] =>
  requests.map((r) => r.url).filter((u) => !u.startsWith('/') && !u.startsWith('http://localhost'));

describe('a visitor with no plan and no key', () => {
  it('sees the question box first', () => {
    open();
    expect(container.querySelector('.hero-ask textarea')).toBeTruthy();
    expect(text()).toContain('With a plan or your own API key');
  });

  it('is never offered anything free but the demo', () => {
    open();
    expect(text()).not.toMatch(/free questions?|solve it free/i);
    expect(text()).toContain('Free demo, no sign-up');
  });

  it('does nothing with an empty or one-letter question', () => {
    open();
    type('.hero-ask textarea', ' a ');
    press('Solve it');
    expect(text()).not.toContain('Choose how to solve it');
  });

  it('is asked to choose how to pay, and nothing is sent to any model', async () => {
    open();
    askFromHome();
    await until('the choice', () => text().includes('Choose how to solve it'));
    expect(text()).toContain('Your question is saved');
    for (const way of ['Choose Regular', 'Use my own API key', 'Try the demo', 'I have an access code']) {
      expect(text()).toContain(way);
    }
    expect(modelRequests()).toEqual([]);
  });

  it('gets there from Attach a file too', async () => {
    open();
    press('Attach a file');
    await until('the choice', () => text().includes('Choose how to solve it'));
    expect(text()).not.toContain('Your question is saved');
  });

  it('can always take the demo instead, which makes no request', async () => {
    open();
    askFromHome();
    await until('the choice', () => text().includes('Choose how to solve it'));
    press('Try the demo');
    await until('the demo', () => text().includes('This is the demo.'));
    press('Solve it');
    await until('the board', () => !!container.querySelector('.board-page'));
    expect(modelRequests()).toEqual([]);
  });

  it('ignores what an earlier version left on this browser, even a working-looking key', () => {
    localStorage.setItem('chalk.trial', JSON.stringify({ apiKey: 'sk-or-v1-left-over', used: 0 }));
    open();
    askFromHome();
    expect(text()).toContain('Choose how to solve it');
    expect(modelRequests()).toEqual([]);
  });
});

describe('bringing their own key', () => {
  it('finds the question waiting, and solves it on that key alone', async () => {
    routes['api.groq.com/openai/v1/models'] = () => json(200, { data: [{ id: 'llama-3.3-70b-versatile' }] });
    routes['api.groq.com/openai/v1/chat'] = solvingModel();
    open();
    askFromHome();
    await until('the choice', () => text().includes('Choose how to solve it'));
    press('Use my own API key');
    type('input[type=password]', 'gsk_0123456789abcdef0123456789abcdef');
    press('Connect my key');
    await until('the question box', () => text().includes('What do you want solved?'));
    expect(container.querySelector('textarea')?.value).toBe('What is 2 + 2?');
    press('Solve it');
    await until('the solution', () => text().includes('That is the whole solution.'));
    expect(requests.some((r) => r.url.includes('openrouter.ai'))).toBe(false);
  }, 30_000);
});

describe('a subscriber', () => {
  it('goes straight from the home page to a solved question, and can share it', async () => {
    onPlan();
    routes['openrouter.ai'] = solvingModel();
    open();
    askFromHome();
    await until('the solution', () => text().includes('That is the whole solution.'));
    expect(requests.find((r) => r.url.includes('openrouter.ai'))?.body).toContain('claude-haiku');
    press('See the summary');
    expect(text()).toContain('Share this solution');
  }, 30_000);

  it('is told when the credit runs out, and keeps what was written', async () => {
    onPlan();
    routes['openrouter.ai'] = () => json(402, { error: { message: 'Insufficient credits' } });
    open();
    askFromHome();
    await until('the message', () => text().includes('used this month'));
    expect(text()).toContain('See bigger plans');
  }, 30_000);
});

describe('a shared link', () => {
  const noSandbox: SandboxPort = {
    available: () => false,
    unavailableReason: () => 'off',
    run: async () => ({ ok: false, stdout: '', result: '', figures: [], timedOut: false }),
  };
  const solution = {
    title: 'Adding two numbers',
    topic: 'What is 2 + 2?',
    subject: 'math',
    level: 'school',
    plan: PLAN,
    pages: [{ steps: [{ say: 'Two and two make four.', ops: [{ op: 'math', tex: '2 + 2 = 4' }] }] }],
    notes: [],
    ending: { summary: 'It is four.', objectivesMet: [], objectivesMissed: [], nextTopics: [] },
  };

  const openLink = (): void => {
    window.history.replaceState(null, '', '/?s=abcdefghijkl');
    open();
  };

  it('plays for someone with no key, makes no model request, and leads to their own question', async () => {
    routes['/api/share'] = () => json(200, { ok: true, solution });
    openLink();
    await until('the end of the solution', () => text().includes('That is the whole solution.'));
    expect(text()).toContain('Shared solution');
    expect(requests.some((r) => r.url.includes('openrouter.ai'))).toBe(false);
    expect(window.location.search).toBe('');
    press('See the summary');
    expect(text()).not.toContain('Share this solution');
    press('Solve your own question');
    expect(container.querySelector('.hero-ask')).toBeTruthy();
  }, 30_000);

  it('says so when the link has gone, on the home page', async () => {
    routes['/api/share'] = () => json(404, { ok: false, code: 'gone' });
    openLink();
    await until('the message', () => text().includes('That link no longer works'));
    expect(container.querySelector('.hero-ask')).toBeTruthy();
  });

  it('says so when it cannot be fetched', async () => {
    openLink();
    await until('the message', () => text().includes('Could not reach LemmeTeach'));
  });

  it('ignores a malformed id without asking', () => {
    window.history.replaceState(null, '', '/?s=../../etc');
    open();
    expect(requests.filter((r) => r.url.includes('/api/share'))).toHaveLength(0);
  });

  it('refuses a stored record of the wrong shape', () => {
    for (const bad of [null, 'x', 3, [], {}, { title: 'x' }, { title: 'x', topic: 'y', pages: 'z' }, { title: 'x', topic: 'y', pages: [] }]) {
      expect(readShared(bad)).toBeNull();
    }
  });

  it('draws a tampered record as text, and never as markup', async () => {
    const hostile = {
      ...solution,
      title: '<img src=x onerror=alert(1)>',
      pages: [
        {
          steps: [
            {
              say: 'Look.',
              ops: [
                { op: 'text', text: '<script>alert(1)</script><img src=x onerror=alert(1)>' },
                { op: 'math', tex: '\\href{javascript:alert(1)}{x}' },
              ],
            },
          ],
        },
      ],
    };
    routes['/api/share'] = () => json(200, { ok: true, solution: hostile });
    openLink();
    await until('the end of the solution', () => text().includes('That is the whole solution.'));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  }, 30_000);

  it('finishes on a record whose board operations are all invalid, without hanging', async () => {
    const record = readShared({
      ...solution,
      pages: [{ steps: [{ say: 'One.', ops: [{ op: 'nonsense' }] }, { say: 'Two.', ops: [{ op: 'math' }] }] }],
    });
    if (!record) throw new Error('no record');
    const session = replaying(record);
    await session.start();
    expect(['REVIEW', 'ABORTED']).toContain(session.state.phase);
  }, 30_000);

  it('finishes on a record with no usable plan, without hanging', async () => {
    const record = readShared({ ...solution, plan: { title: 3 } });
    if (!record) throw new Error('no record');
    const session = replaying(record);
    await session.start();
    expect(['REVIEW', 'ABORTED']).toContain(session.state.phase);
  }, 30_000);

  function replaying(record: SolutionRecord): Session {
    return new Session({
      ephemeral: true,
      topic: record.topic,
      subject: record.subject,
      level: record.level,
      provider: replayAdapter(record),
      adapterConfig: { apiKey: '' },
      settings: DEFAULT_SETTINGS,
      sandbox: noSandbox,
      knownFigures: savedFigureIds(record),
      models: { planner: 'replay', tutor: 'replay', repairer: 'replay' },
      contextWindow: 1_000_000,
    });
  }

  it('keeps only what a replay needs when one is made', () => {
    const record = {
      ...solution,
      id: 'x',
      startedAt: 1,
      transcript: [{ stepId: 's', say: 'hi', at: 1 }],
      tokens: { input: 9, output: 9 },
      pages: [{ index: 0, steps: [{ id: 'secret-step', say: 'Hi.', ops: [], objective: 'obj-1', extra: 'dropped' }] }],
    } as unknown as SolutionRecord;
    const out = JSON.stringify(shareable(record));
    expect(out).not.toContain('tokens');
    expect(out).not.toContain('transcript');
    expect(out).not.toContain('dropped');
    expect(out).not.toContain('secret-step');
  });
});

describe('the security policy', () => {
  it('lets Paddle checkout load everything it needs', async () => {
    const csp = await import('node:fs').then((fs) => fs.readFileSync('public/csp.js', 'utf8'));
    // A real browser found this one: the stylesheet was blocked, and the
    // checkout window would have opened broken.
    for (const directive of ['script-src', 'style-src', 'font-src', 'frame-src', 'img-src']) {
      const line = csp.split(/\r?\n/).find((l) => l.includes(`"${directive} `) || l.includes(`'${directive} `));
      expect(line, directive).toContain('PADDLE');
    }
    expect(csp).toContain('.concat(PROVIDERS, KNOWLEDGE, PYODIDE, PADDLE, extra)');
  });
});

describe('what a production build leaves out', () => {
  it('lists the development-only service only in development', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/providers/own-key.ts', 'utf8'));
    expect(source).toMatch(/import\.meta\.env\.DEV\s*\n?\s*\? \[compatible\('ollama'/);
    const csp = await import('node:fs').then((fs) => fs.readFileSync('public/csp.js', 'utf8'));
    expect(csp).toMatch(/if \(location\.hostname === 'localhost'\) PROVIDERS\.push\('http:\/\/localhost:11434'\)/);
  });
});
