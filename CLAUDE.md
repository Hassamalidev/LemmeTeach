# CLAUDE.md — LemmeTeach

Build spec for **LemmeTeach**: a paid, subscription AI tutor that solves the learner's own questions. They type a question, paste a screenshot of it, or attach the file it is in; it is worked through on an animated whiteboard one step at a time and explained aloud, and they can stop it at any point to ask something.

Solving runs entirely in the browser. There are two ways to pay for it. A **subscription** buys a monthly AI credit, delivered as a spend-capped key that is provisioned automatically (§28), so the learner never sees an API key. Or the learner pastes **their own API key** (§5.8), pays their provider directly, and we charge nothing. The deployed artifact is a folder of static files plus two small serverless functions that exist only for billing.

LemmeTeach began as *Chalk*, an open-source tutor that taught lessons on a topic, quizzed the learner, and kept a record of what they knew. That product is gone: the lesson flow, the checks, the exam, the learner record and the materials library were all removed. Internal identifiers still carry the history — `chalk.*` storage keys, `ChalkError`, `chalk-*` CSS classes, and the agent and tool names noted in §3 — because renaming them would orphan stored data and churn every trace for no user-visible gain. Everything a learner can read says LemmeTeach.

This file is the source of truth. Where it conflicts with a default habit, this file wins. Where it is silent, ask before inventing.

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Hard constraints and anti-goals](#2-hard-constraints-and-anti-goals)
3. [Architecture](#3-architecture)
4. [Stack](#4-stack)
5. [Provider layer](#5-provider-layer)
6. [Tool-call normalization](#6-tool-call-normalization)
7. [The agent runtime](#7-the-agent-runtime)
8. [Agent roster](#8-agent-roster)
9. [Tool catalog](#9-tool-catalog)
10. [The board contract](#10-the-board-contract)
11. [Sandboxed code execution](#11-sandboxed-code-execution)
12. [What is kept about the learner](#12-what-is-kept-about-the-learner)
13. [Attachments](#13-attachments)
14. [Voice and synchronization](#14-voice-and-synchronization)
15. [Screens and interaction](#15-screens-and-interaction)
16. [Design direction](#16-design-direction)
17. [Failure handling](#17-failure-handling)
18. [Budget and cost control](#18-budget-and-cost-control)
19. [Security and privacy](#19-security-and-privacy)
20. [Storage](#20-storage)
21. [File layout](#21-file-layout)
22. [Testing](#22-testing)
23. [Status and what is next](#23-status-and-what-is-next)
24. [Deployment](#24-deployment)
25. [Definition of done](#25-definition-of-done)
26. [Assumptions to confirm](#26-assumptions-to-confirm)
27. [Product, plans and pricing](#27-product-plans-and-pricing)
28. [Billing backend](#28-billing-backend)
29. [Landing page](#29-landing-page)
30. [Growth: sharing and counts](#30-growth-sharing-and-counts)

---

## 1. What this is

A visitor lands on the home page (§29) and types their question straight into it. To have a real question solved they pick a plan (§27), which they pay for through Paddle's checkout without leaving the page and which sets itself up on that device, or they paste their own API key (§5.8). The prepared demo is free for anyone. There are no free real questions: nothing a visitor does can spend the operator's money (§30). Every question works the same way:

1. They **bring a question**: typed, pasted as a screenshot, or attached as a photo, PDF or text file. There is no subject to pick and no level to set.
2. A **reader agent** reads the question and anything attached, restates it in full, works out the subject and level from the question itself, and plans the solution. If part of an upload cannot be read, or the question is ambiguous in a way that changes the answer, it asks one clarifying question and waits. Otherwise it asks nothing.
3. A **solver agent** works the question through on the board, one move per step: why this move, the move, what it gave. It draws the situation before any algebra, computes every number, and finishes with the answer, its units, and a check that it is sensible. A voice explains each step as it is written.
4. The learner can **stop it and ask** at any moment, by typing or by voice. The solver answers that question in one step, the learner is asked whether the answer made sense, and only when they say yes does the solution pick up from exactly where it stopped. If they say no, it is explained again a different way.
5. Everything written stays on the board, which grows downwards; the learner can scroll up to any earlier step.
6. It ends on a summary and the worked solution, which the learner can copy or download. They can still ask about it after it has finished.

There are no quizzes, no checks for understanding, and no closing exam. The solver has no tool for asking the learner anything.

**The distinction that matters:** the model is not asked to produce an answer. It is handed a whiteboard, a code sandbox, a calculator and a voice, and asked to solve the question in front of someone. The solution is whatever the trace of tool calls turns out to be.

---

## 2. Hard constraints and anti-goals

| Constraint | Meaning |
|---|---|
| **Minimal backend** | Serverless functions for billing (§28) and for growth (§30): usage counts and shared links. No question, upload, prompt or solution passes through them, except a solution the learner chose to share. No database of users: Paddle and OpenRouter are the system of record for money, and one small optional key-value store holds counts, rate limits and shared links. |
| **Managed credit, or your own key** | A subscriber never sees a provider console: their plan funds a per-learner OpenRouter key whose spending cap equals their credit. Someone who already has a key from a supported provider can paste it instead and skip the subscription (§5.8). Either way the browser calls the provider directly. |
| **The learner decides when they have understood** | After a question is answered the solution waits for the learner to say it made sense. The model may not decide that for them and may not quiz them to find out (§15). |
| **Fixed margin** | Every plan is priced so that $2 per subscriber per month remains after payment fees, a hosting allowance, and the full cost of the credit (§27). The numbers live in one file. |
| **Capped exposure** | A learner can never spend more than they paid for. The cap is enforced by OpenRouter on the key itself, not by client code. |
| **As many questions as the credit allows** | The cost of a solved question is an engineering target, not a given: the cheapest model that solves well, prompt caching, short prompts, attachments sent once, and exact cost accounting (§18). |
| **Agentic** | A multi-turn tool-use loop. Not a prompt that returns an answer. |
| **Every step is spoken, in order** | The model is held to the pace of the voice. Nothing is skipped and the summary waits for the last step (§14). |
| **Simple deploy** | Connect the repo to Vercel, set the environment variables in §24, done. The static build itself still needs none, so the demo works anywhere. |
| **Runs anywhere** | Any modern browser, desktop and mobile. The static build works at any URL path; paid use additionally needs the `/api` functions on the same origin. |
| **Degrades, never dies** | Every capability has a defined fallback. A failed tool, an expired subscription, spent credit, a browser without speech synthesis — none of these produce a blank screen. |

### Anti-goals

Do not build: quizzes, checks for understanding, an exam, a learner profile or mastery record, spaced review, a materials library with retrieval, a subject or level picker, a reduced "scripted" mode. All of these existed in the earlier teach-a-topic product and were deliberately removed; do not bring them back without being asked.

Do not build: user accounts or passwords (the access code is the credential), a user database, a model proxy (the browser calls OpenRouter directly), cloud sync, a general-purpose chatbot, a provider or model picker (an own key's provider is read off the key, and its model is chosen for it). Do not add a client-side router. Do not add a state management library.

The backend is allowed to do exactly what §28 and §30 list. If you find yourself about to route model traffic, store anything a learner did not choose to share, or add a user database, stop and raise it rather than building it. The usage counts are a fixed list of words and a distinct-count: never text, never an address (§30).

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER TAB   (everything below ships as static files)             │
│                                                                     │
│  ┌───────────────┐   turns    ┌──────────────────────────────────┐  │
│  │  Session      │◄──────────►│  Agent runtime                   │  │
│  │  (phase FSM)  │            │  loop · budget · abort · pacing  │  │
│  └───────┬───────┘            └───────┬──────────────────────────┘  │
│          │                            │ normalized messages + tools  │
│          │                            ▼                             │
│          │                    ┌───────────────┐   HTTPS             │
│          │                    │  Provider     │──────────────►  ☁   │
│          │                    │  adapter      │   capped key        │
│          │                    └───────┬───────┘                     │
│          │                            │ tool calls                  │
│          ▼                            ▼                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Tool bus —  validate → authorize → dispatch → result          │ │
│  ├──────────┬──────────┬──────────┬───────────┬──────────┬────────┤ │
│  │ Board    │ Sandbox  │ Compute  │ Learner   │ Notes    │ Wiki   │ │
│  │ writer   │ iframe   │ (mathjs) │ prompt    │          │ lookup │ │
│  │          │ + worker │          │ (waits)   │          │ (CORS) │ │
│  └────┬─────┴──────────┴──────────┴───────────┴──────────┴────────┘ │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────┐   reveal sync  ┌───────────────────────────────┐ │
│  │ Board render │◄──────────────►│ Speech (Web Speech API)       │ │
│  └──────────────┘   + pacing     └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

The billing functions (§28) sit outside this picture on purpose: they run once at activation and on payment events, never while a question is being solved.

**Layer rules.** The runtime knows nothing about solving questions. The tools know nothing about which model called them. The board renderer knows nothing about agents — it takes board operations and draws them, and can be driven entirely from a fixture file. Keep these seams clean; they are what make the thing testable without a key.

### Phase state machine

The session is a finite state machine, not another model. Model autonomy lives *inside* a phase; transitions between phases are code (`src/orchestrator/machine.ts`).

```
IDLE → PLANNING → TEACHING ⇄ INTERRUPTED
          ⇅          │  ▲      (stop and ask)
       CHECKING      ▼  │           ▲
     (clarify)     REVIEW ──────────┘
                              (a question after it has finished)

any phase ──► ABORTED   (user stop · fatal error)
```

- `PLANNING` — the reader, ≤ 6 turns, ends when `plan_lesson` is called.
- `CHECKING` — entered only from `PLANNING`, when the reader calls `ask_learner`. The loop suspends awaiting real human input, with no timeout, then returns to `PLANNING`.
- `TEACHING` — the solver, ≤ 40 turns, ends on `end_lesson` or budget.
- `INTERRUPTED` — the learner stopped it to ask. Speech stops, the question is injected as the next user message, `TEACHING` resumes.
- `REVIEW` — the solution is finished. No model calls, unless the learner asks about it: then the solver is run again from where it ended, answers, and returns here.
- `ABORTED` — always reachable, always leaves the board readable with whatever was written so far saved.

The phase names `PLANNING` and `TEACHING`, the agent ids `planner` and `tutor`, and the tool names `plan_lesson`, `teach_step` and `end_lesson` predate the solve-only product. They are kept because traces, tool allowlists and the bundled walkthroughs are keyed on them; the prose calls them the reader and the solver.

Every transition is written to the session trace (§22).

---

## 4. Stack

- **Vite + React 18 + TypeScript** — `strict: true`, `noUncheckedIndexedAccess: true`.
- **Tailwind CSS**.
- **KaTeX** — math typesetting.
- **mathjs** — expression evaluation for plots and the `compute` tool.
- **Shiki** — code highlighting on the board, loaded on first use.
- **idb-keyval** — thin IndexedDB wrapper.
- **Pyodide** — loaded lazily, only on the first Python execution.
- **Zod** — runtime validation of every tool input. Non-negotiable: the model *will* send malformed arguments, and every one of them must be caught at the tool bus rather than deep inside the renderer.
- **Web Speech API** — voice. Built in, free, no key, no network.
- **Vercel Functions** — Node runtime, Web-standard `Request`/`Response` handlers in `api/`. Billing only (§28).
- **Paddle** — checkout (Paddle.js, an overlay on our own page), subscriptions, and tax as merchant of record. Replaced Lemon Squeezy: its fee is lower and it is the provider chosen for the business. Loaded only when someone pays.
- **OpenRouter** — the model gateway, and its management API for per-learner capped keys.

No state library, no router, no component kit, no animation library, no server framework, no database, no PDF library (PDFs go to the model as they are). Anything else needs a justification in the commit message.

---

## 5. Provider layer

One interface, six adapters. All stream, all support tool calls.

```ts
export interface ProviderAdapter {
  id: ProviderId;                 // 'anthropic'|'openai'|'gemini'|'openrouter'|'compatible'|'mock'
  label: string;
  defaultModel: string;
  models(): Promise<ModelInfo[]>; // live list where the API offers one, static otherwise
  keyPlaceholder: string;
  keyHelpUrl: string;
  supportsToolChoice: boolean;
  supportsParallelToolCalls: boolean;
  run(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

export interface AgentRequest {
  model: string;
  system: string;
  messages: AgentMessage[];       // normalized, see §6
  tools: ToolSpec[];
  maxTokens: number;
  temperature: number;
  toolChoice?: 'auto' | 'required' | { name: string };
}

export type AgentEvent =
  | { t: 'text';       delta: string }
  | { t: 'tool_start'; id: string; name: string }
  | { t: 'tool_delta'; id: string; json: string }        // partial arguments
  | { t: 'tool_end';   id: string; input: unknown }
  | { t: 'usage';      inputTokens: number; outputTokens: number }
  | { t: 'stop';       reason: 'end_turn'|'tool_use'|'max_tokens'|'refusal' }
  | { t: 'error';      error: ChalkError };
```

Everything above this layer sees only `AgentEvent`. Nothing above this layer may contain a provider name in a conditional.

**What the product uses.** A subscriber's questions run on the OpenRouter adapter with their provisioned key, and the demo runs on the mock adapter. A learner's own key (§5.8) runs on whichever of the Anthropic, OpenAI, Gemini or OpenRouter adapters issued it. No screen offers a provider picker or a model field: a subscriber's models are fixed in `src/providers/managed.ts` (a standard tier and a deeper tier), and an own key's are chosen in `src/providers/own-key.ts`. The compatible adapter (a custom base URL) is not reachable from the UI.

The OpenRouter adapter adds three request fields that the others do not (§18): `cache_control` for prompt caching, `usage` for the real cost of each turn, and `models` for a same-priced fallback. A `usage` event may carry `cachedInputTokens` and `costUsd` alongside the token counts.

### 5.1 Anthropic

Browser calls need an opt-in header. Without it the request fails CORS, so this is not optional:

```ts
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  signal,
  headers: {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model, max_tokens: maxTokens, temperature, stream: true,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools,                       // [{ name, description, input_schema }]
    tool_choice: { type: 'auto' },
    messages,
  }),
});
```

"Dangerous" refers to shipping *your own* key in client code. Here the key belongs to the user and never leaves their browser, which is the case this header exists for. Say exactly that in settings if a user asks.

Stream shape to consume: `content_block_start` (block type `text` or `tool_use`), then `content_block_delta` carrying either `text_delta.text` or `input_json_delta.partial_json`, then `content_block_stop`, then `message_delta` with `stop_reason` and usage. Accumulate `partial_json` per block index and parse at `content_block_stop`.

Mark the system prompt and tool definitions with `cache_control` — they are byte-identical on every turn of a solution, and this is where most of the token spend would otherwise go.

Default `claude-sonnet-5`. Offer `claude-opus-5` for hard derivations and `claude-haiku-4-5-20251001` for cheap revision and for the repair pass (§17.3).

### 5.2 OpenAI

`POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer {key}`, `stream: true`, `stream_options: { include_usage: true }`. Tools as `[{ type: 'function', function: { name, description, parameters } }]`. Tool calls arrive in `choices[0].delta.tool_calls[]`, where `index` identifies the call, `id` and `function.name` appear on the first fragment, and `function.arguments` streams as a string that must be concatenated then parsed.

### 5.3 Google Gemini

`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={key}`. Tools as `[{ functionDeclarations: [{ name, description, parameters }] }]`.

Differences that will bite, all of which the adapter absorbs: roles are `user` and `model`; the system prompt goes in `systemInstruction`; results return as a `functionResponse` part; and the accepted JSON Schema subset is narrower than the others'. Run every tool schema through `narrowSchemaForGemini()`, which strips `$ref`, `oneOf`, `additionalProperties`, and unsupported `format` keywords.

### 5.4 OpenRouter

OpenAI-shaped at `https://openrouter.ai/api/v1`, plus `HTTP-Referer` and `X-Title` headers. Fetch the live model list from `/api/v1/models` and filter to models that advertise tool support. This is the adapter that lets a learner use any model without a code change, so surface that filter clearly rather than showing 300 models, most of which will fail on turn one.

### 5.5 Compatible

OpenAI wire format, user-supplied base URL: Groq, Together, DeepSeek, vLLM, Ollama (`http://localhost:11434/v1`), LM Studio. Warn on `http://` origins other than localhost. Many small local models handle tool calls badly — which is one reason the product does not offer them.

### 5.6 Mock

Replays a prepared walkthrough from `src/fixtures/lessons/` — or a recorded tape from `src/fixtures/tapes/` when one exists — emitting the same `AgentEvent` sequence with realistic timing. No key, no network. The whole UI — board, voice, sandbox, pacing, interruption — must be exercisable through the mock adapter. The five bundled walkthroughs are authored, not recorded, and are labelled as such; recording real tapes is still to do (§23).

### 5.7 Key handling

Two secrets live in the learner's browser: the **access code** (their proof of purchase: the id of a Paddle transaction on their subscription, `txn_…`) and the **model key** (the capped OpenRouter key issued for it).

- Both in `localStorage` — `chalk.license` and `chalk.key.openrouter`. A learner's own key (§5.8) lives beside them as `chalk.key.{provider}` and is held to the same rules.
- Never logged, never placed in a URL, never included in an exception message, a trace export, or a saved solution. Ship a unit test asserting neither string appears in any serialized artifact.
- The model key is sent only to `openrouter.ai`. The access code is sent only to our own `/api/activate`.
- Settings has **Sign out of this device**: clears both and returns to the landing page. The subscription itself is untouched.
- The model key is worth at most the learner's remaining credit. That bound is what makes holding it in the browser acceptable; never issue an uncapped key.
- The OpenRouter **management key** and the webhook signing secret exist only as server environment variables. They must never be imported by anything under `src/`.
- A `<meta http-equiv="Content-Security-Policy">` whose `connect-src` allows only our own origin, the services a key can belong to (§5.8), the Wikipedia API, and the Pyodide CDN.


### 5.8 Your own key

Someone who already has an API key can use LemmeTeach without subscribing (`src/providers/own-key.ts`, `src/ui/OwnKey.tsx`).

- **Many services, two kinds.** Anthropic, OpenAI, Gemini and OpenRouter each have an adapter of their own. Mistral, Groq, DeepSeek, xAI, Together, Fireworks, Cerebras, Cohere, Alibaba (Qwen), Moonshot (Kimi) and Hyperbolic speak the OpenAI wire format at their own address and run on the `compatible` adapter. Only services that accept requests straight from a browser are listed; each was checked for the CORS headers that needs.
- **One field.** They paste a key. Which service issued it is read off its shape where a shape exists: `sk-or-` OpenRouter, `sk-ant-` Anthropic, `AIza…` Gemini, `gsk_` Groq, `xai-` xAI, `fw_` Fireworks, `csk-` Cerebras, `sk-` plus 32 hex digits DeepSeek, any other `sk-` OpenAI, 32 letters and digits Mistral, 40 Cohere, 64 hex Together. Three services have no shape of their own and are reached only by choosing them.
- **A list, for when the guess is wrong.** Some shapes are shared and some keys have none, so the screen has a "which service is it from?" list. It is left alone unless the key is not recognised or the guessed service refuses it, in which case the message says to use it.
- **Checked once, with one service only.** One read-only request to that service — its model list, or OpenRouter's key endpoint — tells a bad key from a good one and a network failure from both. The key travels in a header, never in a URL, the reply is never echoed, and the key is **never tried against other services to see which accepts it**: that would hand a secret to companies that did not issue it.
- **The model is chosen for them:** a preferred small model if the key can reach it; otherwise, on the compatible services, whatever the service's own list offers that looks like a small chat model, so a renamed model does not break a working key; and only then a fixed guess.
- **Quirks are per service, not guessed.** `AdapterQuirks` records where a service differs from OpenAI: Mistral rejects `stream_options`, calls a forced tool choice `any`, and will not take a user message straight after a tool result (the adapter slips a one-word assistant turn in between); Cohere rejects `stream_options`. A new service with a new quirk gets a new field, with a test.
- **Stored** in the key vault under its adapter's id, with `settings.ownKey` recording the service, its label, its address, its quirks and the models chosen. **Remove my key from this device** in Settings clears it.
- **Our servers are not involved.** No activation, no webhook, no credit cap, no plan line. The meter shows an estimate from the static price table where the model is in it, and nothing otherwise.
- **A plan wins.** If a plan is active on the device, the plan is used and the own key is ignored.
- **Attachments** are sent in each provider's own shape (§6). Whether a given compatible service can read an image depends on the model chosen there.
- **The CSP must allow every service** (`public/csp.js`). `OWN_KEY_ORIGINS` lists them and a test holds the two together.

Limits to be honest about: the OpenAI-shaped adapter sends `max_tokens` and a temperature, which OpenAI's newer reasoning models reject, so only the older chat models are offered there; prompt caching and exact cost reporting are OpenRouter features, so an own key elsewhere costs more per question and shows an estimate; and none of these services has run against a live key in this product. A service that is not listed is not supported — a key from it is refused, not guessed at.
---

## 6. Tool-call normalization

The internal message format every adapter converts to and from:

```ts
type AgentMessage =
  | { role: 'user';      content: string; attachments?: Attachment[] }   // §13
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool';      results: ToolResult[] };

interface ToolCall   { id: string; name: string; input: unknown }
interface ToolResult { id: string; name: string; ok: boolean; content: string }
interface Attachment { kind: 'image' | 'file'; name: string; dataUrl: string }
```

`ToolResult.content` is always a string, JSON-stringified for structured results. Keep results small: anything over 2 KB is truncated with a trailing note saying what was dropped. Tool results are the largest avoidable cost in an agent loop, because every one of them is re-sent on every subsequent turn.

| Concept | Anthropic | OpenAI / OpenRouter / compatible | Gemini |
|---|---|---|---|
| System prompt | top-level `system` | message `role:'system'` | `systemInstruction` |
| Assistant role | `assistant` | `assistant` | `model` |
| Tool definition | `{ name, description, input_schema }` | `{ type:'function', function:{...} }` | `functionDeclarations[]` |
| Tool call | block `tool_use { id, name, input }` | `message.tool_calls[]`, args as **string** | part `functionCall { name, args }` — **no id** |
| Tool result | user message, block `tool_result { tool_use_id, content }` | message `role:'tool'` with `tool_call_id` | part `functionResponse { name, response }` |
| Parallel calls | yes | yes | yes |
| Streamed arguments | `input_json_delta.partial_json` | `delta.tool_calls[].function.arguments` | whole part per chunk |

Gemini returns no call id. Synthesize `${name}#${turnIndex}#${callIndex}` and keep a per-turn map so results match back. Never let a synthesized id reach anything user-visible.

### Streaming argument rendering

`tool_delta` carries partial JSON. For `teach_step` specifically, feed the partial string through a tolerant incremental JSON parser so the board can start drawing the first operations while the rest of the arguments are still arriving. This is what makes the tutor feel live rather than turn-based, and it is worth the effort — but treat it as an optimization: if the tolerant parse fails at any point, discard the partial state and wait for `tool_end`. Never render an operation twice; every op carries an index and the renderer is idempotent per index.

### Attachments

A user message with `attachments` becomes content parts on the OpenAI-shaped wire: `{ type: 'text' }`, then `{ type: 'image_url', image_url: { url } }` for an image or `{ type: 'file', file: { filename, file_data } }` for a PDF. On Anthropic they are `image` and `document` blocks with a base64 source, placed before the text; on Gemini, `inlineData` parts. A message without attachments is sent exactly as before. Only the reader's first message ever carries them (§13).

---

## 7. The agent runtime

```ts
async function runAgent(cfg: AgentConfig, ctx: RunContext): Promise<AgentOutcome> {
  const messages = [...cfg.seedMessages];

  for (let turn = 0; turn < cfg.maxTurns; turn++) {
    ctx.budget.assertNotExhausted();
    await ctx.beforeTurn?.();            // pacing: the session may hold this (§14)
    ctx.signal.throwIfAborted();

    const injection = ctx.injectBeforeTurn?.();   // raised hand, wrap-up warning
    if (injection) messages.push({ role: 'user', content: injection });

    const { text, toolCalls, usage } = await consume(
      provider.run({ ...cfg.request, messages: compact(messages, ctx) }, ctx.signal),
      ctx,
    );
    ctx.budget.add(usage);
    messages.push({ role: 'assistant', content: text, toolCalls });

    if (toolCalls.length === 0) continue;         // nudged, then tool_choice forced (§17.3)

    const results = await ctx.toolBus.dispatch(toolCalls, ctx);
    messages.push({ role: 'tool', results });

    const terminal = results.find(r => TERMINAL_TOOLS.has(r.name) && r.ok);
    if (terminal) return { reason: 'terminal_tool', tool: terminal.name, messages };
  }
  return { reason: 'max_turns', messages };
}
```

### Rules

- **The loop is code, not a prompt.** No agent decides how many turns it gets.
- **Suspension.** `ask_learner` returns a promise that resolves only when the human answers. The loop genuinely suspends; the tab can sit there for an hour. No timeout, and no fabricated answer, ever.
- **Pacing.** `beforeTurn` is awaited at the top of every turn. The session resolves it only when the voice is within one step of the board, and never while an answer to the learner's question is waiting on them to say whether it made sense (§14, §15).
- **Parallel dispatch.** Tools declare `parallelSafe`. Safe ones (`compute`, `wiki_lookup`) run under `Promise.all`. Anything touching the board or the learner runs sequentially in the order the model emitted them, because order is meaning.
- **Validation at the bus.** Every input is parsed by its Zod schema. Failure returns `ok: false` with a message naming the offending field and the expected shape, and the loop continues so the model can repair its own call. Two consecutive board failures escalate to §17.3.
- **Authorization at the bus.** The access matrix in §8.1 is enforced here, not merely by which specs were sent. So are capabilities switched off for the session (`run_code` with no sandbox, `wiki_lookup` when disabled).
- **Abort.** One `AbortController` per session. Aborting cancels the fetch, cancels speech, halts the sandbox, releases any pacing hold, and freezes the board where it stands. What was written is saved.
- **Trace.** Every event — turn boundary, text, tool call, tool result, phase transition, error, usage — appends to an in-memory trace, capped and exportable (§22).
- **Context growth.** Before each turn, if estimated tokens exceed 60% of the configured window, compact: keep the system prompt, the plan, and the last six turns verbatim, and replace everything older with a summary block the runtime generates *deterministically* from the plan and the board history. Do not spend a model call summarizing. The configured window is 60k tokens, far below the model's real one, because short prompts are cheap prompts (§18).

---

## 8. Agent roster

Three agents. Each is a system prompt plus a tool allowlist plus a budget (`src/agents/index.ts`). They share one provider and one tool bus.

| Agent | Id in code | Phase | Max turns | Model | Terminal tool |
|---|---|---|---|---|---|
| Reader | `planner` | `PLANNING` | 6 | fast | `plan_lesson` |
| Solver | `tutor` | `TEACHING` | 40 | fast, or strong on the deeper tier | `end_lesson` |
| Repairer | `repairer` | any | 2 | fast | `fix_board` |

### 8.1 Tool access matrix

| Tool | Reader | Solver | Repairer |
|---|:--:|:--:|:--:|
| `plan_lesson` | ● | | |
| `ask_learner` | ● | | |
| `wiki_lookup` | ● | ● | |
| `teach_step` | | ● | |
| `run_code` | | ● | |
| `compute` | | ● | |
| `save_note` | | ● | |
| `end_lesson` | | ● | |
| `fix_board` | | | ● |

The solver has no way to ask the learner anything. That is the access matrix, not a request in a prompt.

### 8.2 The reader

Reads the question and everything attached, and is the **only** agent that sees the attachments (§13). It never writes on the board. Prompt requirements:

- Restate the question in full in the plan's `problem` field: every number, unit, symbol and condition, exactly what is asked, and a description of any figure precise enough to redraw. Several questions are all listed, numbered, in order. Anything left out is lost, because the solver sees only these words.
- Do not solve it beyond what planning needs.
- A bare topic rather than a question means "explain this, and work one typical example".
- **Ask only when it must.** One specific `ask_learner` when part of an attachment cannot be read, or the question can be taken two ways that lead to different answers. Never to confirm what was written, never to ask the level, never for permission to begin. When a standard assumption exists, make it and state it.
- Choose `subject` (the closest of the eight, or `general`) and `level` from the question itself.
- `objectives` are the stages of the solution, in order. `steps` are the board steps, three to nine: open with what is given and asked, draw the situation early if it can be drawn, close with the answer and a check.

### 8.3 The solver

The main loop. Prompt requirements:

- **Board and voice do different jobs.** `say` carries meaning and is read aloud, so it must be plain spoken language with no markup, no LaTeX, and no symbols a voice cannot pronounce — "d by d x", not `\frac{d}{dx}`. The board carries notation and structure. They complement; they never duplicate.
- **Given and asked first**, then a picture: forces as vectors, a process as a flow, a structure as a tree, a function as a plot. A picture before any algebra.
- **One move per step.** Say why, make the move, say what it gave. Do not skip a line the learner would have to stop and work out; do not pad with lines they would not.
- **Name the method** the first time it is used, in one sentence, so it transfers to the next question.
- **Every number computed, never guessed.** The solver writes `{{expression}}` where a number goes, in `say` or on the board, and `teach_step` works it out with mathjs as the step is drawn (`src/tools/compute.ts`, `fillNumbers`); the result lists the values. `compute` is for a number needed before deciding what to write. A wrong figure in a worked solution is worse than none.
- **Mark the trap** where a common mistake sits next to the correct move.
- **Finish properly:** the answer with units in a `key` box, a sanity check (size, a limiting case, or substituting back), the one idea worth carrying away, `save_note` with the worked solution, then `end_lesson`.
- **Do not quiz.** Never put a question to the learner in narration; one they cannot answer is noise.
- **Unanswerable as given:** say so on the board, state the assumption, carry on.
- **One `teach_step` per turn.** Batching defeats interruption and reveal sync.
- **Stopped with a question:** answer that question in one step and stop. The solver is then told what the learner said: carry on from where it stopped, or explain the same point a different way. It does not decide whether they understood and does not test them.

### 8.4 The repairer

Not a solver. Invoked by the runtime, never by another agent, when board operations fail validation twice (§17.3). It receives the rejected operations plus the validator's complaint and returns corrected operations via `fix_board`. Tiny budget. If it fails, the step's operations are dropped and its narration still reaches the learner.


### 8.5 Getting better: the skills document and the golden set

Prompt work without measurement is guessing. Two small things make it a loop instead:

- **The skills document** (`src/agents/skills.ts`) — a short, versioned list of instructions the solver needs because a real run got something wrong. It is appended to the solver prompt under its version number. It grows one line at a time: find the smallest instruction that would have prevented a failure, add it, bump the version, say in the changelog which failure it answers. Entries that stop earning their place are deleted, because every line is paid for on every turn.
- **The golden set** (`evals/golden.json`) — twelve questions across the subjects with known answers and a list of what a good solution must show. Run it before and after any change to a prompt, a model or the skills document, and compare. There is no automatic runner yet; it is run by hand with a real key.

The rules that go with them, and that the prompts already follow:

- One job per agent, stated first. Then the rules, most important first. No duplicated instructions.
- Offer each agent only the tools it needs, with short, exact descriptions. A failing tool returns an error the model can act on.
- Do in code what code can do: arithmetic goes through `compute`, validation through the bus, pacing and phase changes through the runtime. The model is used where there is a real decision.
- Make uncertainty explicit. The reader marks what it assumed with `ASSUMED:`; the solver checks a doubtful fact before using it and says so when it cannot.
- Keep prompts short: old turns are compacted, attachments are sent once, and output is capped at what a step needs (reader 3,000 tokens, solver 4,096).
- Change one thing at a time, and look at the trace to find the single biggest cost before tuning anything else.
---

## 9. Tool catalog

Nine tools. Every one has a Zod schema in `src/tools/schemas.ts`, and the JSON Schema sent to the provider is *generated* from that Zod schema so the two can never drift.

Descriptions sent to the model are part of the product. Write them as instructions to a colleague: what the tool does, when to reach for it, when not to, and one concrete example. A vague description produces vague calls.

```ts
interface Tool<I, O> {
  name: string;
  description: string;               // model-facing, written with care
  schema: ZodType<I>;
  agents: AgentId[];                 // authorization (§8.1)
  parallelSafe: boolean;
  suspends: boolean;                 // waits on the human
  run(input: I, ctx: ToolContext): Promise<ToolOutcome<O>>;
}
```

### 9.1 `plan_lesson` — terminal for the reader

```jsonc
{
  "title": "Range of a projectile",
  "level": "school",                          // "intro"|"school"|"undergrad"|"deep"
  "subject": "physics",                       // one of the eight; settles the board's accent and the solver's guidance
  "problem": "A ball leaves the ground at 20 m/s, 40 degrees above the horizontal. Ignore air resistance. Find (a) the time in the air and (b) the range.",
  "objectives": [{ "id": "obj-1", "text": "Find the time in the air" }],
  "prerequisites": [],
  "steps": [{ "objective": "obj-1", "representation": "derivation", "note": "Vertical motion gives the time" }],
  "estimatedMinutes": 6
}
```

`problem` is the load-bearing field: the solver never sees the attachment, only this.

### 9.2 `ask_learner` — suspends; the reader only

One clarifying question, then wait.

```jsonc
{
  "question": "The exponent in the second term is cut off in your photo. Is it x squared or x cubed?",
  "kind": "choice",                    // "free" | "choice" | "confirm" | "number"
  "options": ["x squared", "x cubed"], // required for "choice"
  "why": "the answer differs depending on which"   // shown in the trace, not to the learner
}
```

Returns `{ answer, elapsedMs, skipped }`. On **Skip** the reader proceeds on the most likely reading and says which it chose.

### 9.3 `teach_step` — the primary tool

One narrated step with its board operations. Called once per turn.

```jsonc
{
  "say": "Plain spoken narration, 2 to 5 sentences. Read aloud verbatim by a speech engine, so no markdown, no LaTeX, no bullet characters, and no symbols. Write 'd by d x' not the notation. Carry the meaning here; put the notation on the board.",
  "board": [ /* board operations, §10 */ ],
  "clear": false,                      // true starts a fresh board page
  "objective": "obj-2",                // which stage of the plan this serves
  "pace": "normal"                     // "slow" | "normal" | "quick" — affects reveal timing
}
```

Numbers are written as `{{expression}}` (optionally `{{expression | 3}}` for significant figures) and computed as the step is drawn; one that will not compute rejects the step with the reason. Returns `{ ok, opsRendered, page, boardFull, numbers }`. When `boardFull` is true, the next step must set `clear: true` — say so in the result string, because models otherwise keep writing off the bottom of the page.

### 9.4 `run_code`

Executes in the sandbox (§11).

```jsonc
{
  "language": "python",                // "python" | "javascript"
  "source": "import numpy as np\n...",
  "purpose": "Integrate the trajectory so we can plot where it lands",
  "expect": "figure"                   // "value" | "table" | "figure" | "text"
}
```

Returns `{ ok, stdout, result, figures: [figureId], timedOut, error }`. Figures are stored and placed on the board with the `figure` op. Truncate `stdout` to 2 KB. On error, return the exception text — the model is expected to fix and retry, twice at most.

### 9.5 `compute`

Fast mathjs evaluation. No sandbox, no Pyodide, milliseconds. Arithmetic, unit conversion, symbolic simplification. `parallelSafe: true`.

```jsonc
{ "expressions": ["9.81 * 2.5^2 / 2", "unit(3, 'eV') to 'J'"], "precision": 4 }
```

Returns `{ results: [{ expr, value, error? }] }`.

### 9.6 `wiki_lookup`

The only network tool besides the model gateway. Wikipedia's REST API sends permissive CORS headers, so this works with no backend.

```jsonc
{ "query": "Krebs cycle", "mode": "summary" }
```

Returns `{ title, extract, url }`, extract capped at 1200 characters. Off by default; a toggle in Settings turns it on. For dates, names and constants — not for explanations, which are the solver's own job.

### 9.7 `save_note`

The worked solution, for the learner to keep and export as Markdown.

```jsonc
{ "title": "Range of a projectile", "markdown": "…", "tags": ["kinematics"] }
```

Markdown here *may* use LaTeX and formatting — unlike `say`, this is read, not spoken. One note per question solved.

### 9.8 `end_lesson` — terminal for the solver

```jsonc
{
  "summary": "What the question was, the method, and the answer, in two or three plain sentences.",
  "objectivesMet": ["obj-1", "obj-2"],
  "objectivesMissed": [],
  "nextTopics": ["Launching from a height"]
}
```

### 9.9 `fix_board` — the repairer only

```jsonc
{ "ops": [ /* corrected board operations */ ] }
```

---

## 10. The board contract

The model never writes SVG, HTML, or coordinates. It emits **operations**; the renderer owns all layout. Models are unreliable at pixel positions and reliable at describing structure, so never introduce an `x` or `y` field. This single decision determines whether the board looks composed or broken.

### 10.1 Operations

Thirteen ops. Adding a fourteenth requires deleting one.

| Op | Shape | Used for |
|---|---|---|
| `heading` | `{ op:"heading", text }` | Section title |
| `text` | `{ op:"text", text, tone?:"note"\|"warn"\|"key" }` | A written line; `key` is the boxed takeaway |
| `math` | `{ op:"math", tex, label? }` | KaTeX, display style |
| `derive` | `{ op:"derive", lines:[{ tex, note? }] }` | Multi-line derivation, revealed line by line |
| `bullets` | `{ op:"bullets", items:[string] }` | Revealed one at a time |
| `code` | `{ op:"code", lang, src, focus?:[from,to] }` | Highlighted source with an optional focused range |
| `diagram` | `{ op:"diagram", layout:"flow"\|"cycle"\|"tree"\|"web", nodes:[{ id, label, tone? }], edges:[{ from, to, label? }] }` | Processes, taxonomies, pipelines, cycles |
| `plot` | `{ op:"plot", fns:[{ expr, label? }], domain:[a,b], range?:[a,b], marks?:[{ x, y, label }] }` | Graphs; `expr` in mathjs syntax |
| `vectors` | `{ op:"vectors", origin?, arrows:[{ label, dx, dy, tone? }] }` | Forces, fields, momentum |
| `reaction` | `{ op:"reaction", left:[{ formula, coeff? }], right:[{ formula, coeff? }], condition? }` | Chemical equations with subscripts and states |
| `table` | `{ op:"table", headers:[string], rows:[[string]] }` | Comparisons, data, truth tables |
| `figure` | `{ op:"figure", figureId, caption? }` | An image produced by `run_code` |
| `annotate` | `{ op:"annotate", target, style:"circle"\|"underline"\|"arrow", text? }` | Points at something already on the board |

Every op may carry `id` (so `annotate` can target it) and `col: "main" | "side"`.

### 10.2 Renderer responsibilities

- Lay ops out top to bottom in the main column; `side` ops go to a narrow right column.
- Compute all diagram node positions: layered for `flow` and `tree`, radial for `cycle`, grid for `web`. Route edges to avoid nodes. Never ask the model for positions.
- Reveal progressively, in sync with narration (§14).
- Auto-shrink type by one step when a page approaches full, then paginate and report `boardFull` back through the tool result.
- Scale a 16:9 board to any viewport. Below 640px, switch to 4:5 and move the side column underneath.
- **The board is one column that grows downwards** (`BoardScroll`). Nothing is wiped: every step stays where it was written and the learner can scroll up to it. Where the solver starts a fresh page, the board draws a rule. An answer to the learner's question is set apart in its own box.
- The board follows the step being explained. If the learner scrolls up, it stops following and offers **Back to the current step**, because a page that moves while you read it is worse than one that falls behind.

### 10.3 Validation

`validateOps(ops)` runs at the tool bus before rendering and rejects, with a specific message:

- unknown `op`, or fields absent from the schema
- `annotate` targeting an id not on the current page
- `derive` with more than 8 lines, `bullets` with more than 6 items, `table` with more than 8 columns
- `plot` whose `expr` mathjs cannot parse, or whose domain is empty or reversed
- `diagram` with an edge referencing a missing node, more than 12 nodes, or a cycle in a `tree`
- `figure` with an unknown `figureId`
- estimated height exceeding two pages in one step

Rejection returns `ok: false` with the reason, and the model retries. Twice failing escalates to the repairer (§17.3).

### 10.4 Subject packs

Eight subjects. Each contributes a prompt fragment for the solver, an accent color, a worked example of good board usage, and a list of typical topics shown on the landing page. The reader chooses the subject from the question; the learner never picks one.

- **Math** — `derive`, `plot`. Show a concrete case before the general rule. Flag common errors with `annotate` + `warn`.
- **Physics** — `vectors`, `diagram`, plus `run_code` for simulation. Always name the system and its assumptions. Units on every quantity. Sanity-check magnitude at the end.
- **Chemistry** — `reaction`, `diagram`. Balance equations on the board one step at a time, never in a single jump. Say what the electrons are doing.
- **Computer Science** — `code` with `focus`, `diagram` for data structures, `table` for complexity, `run_code` to actually execute the example. Trace a small input by hand before running it.
- **Biology** — `diagram` with `cycle` and `flow`, `table` for comparisons. Structure first, then function, then structure explaining function.
- **Finance** — `table`, `plot`, `math`. One concrete case with real figures before any formula. Currency and period on every number. `compute` for every figure. Teaches the idea, never what to buy.
- **Psychology** — `diagram`, `table`, `bullets`. A concrete case or classic study before the concept. Observation kept apart from explanation, and replication failures said plainly. Never diagnoses.
- **Any other subject** — picks the representation the topic calls for: a process is a flow, a comparison a table, a hierarchy a tree. Says once what the board cannot draw and carries on.

---

## 11. Sandboxed code execution

Code runs in a **sandboxed iframe** (`sandbox="allow-scripts"`, `srcdoc`, therefore a null origin with no access to the app's storage or DOM), which itself hosts a Web Worker. The app talks to it over `postMessage`.

```
main thread ──postMessage──► iframe (null origin) ──► worker ──► Pyodide / JS eval
           ◄──result/figures/stdout────────────────────────────
```

### Rules

- **Timeout 10 s.** On expiry, terminate the worker and return `timedOut: true`. Never leave a runaway loop holding the tab.
- **Memory guard.** Fresh worker per execution beyond a size threshold; recycle the Pyodide instance across calls within a session, since cold start is 3–5 seconds.
- **No network from inside.** Override `fetch`, `XMLHttpRequest`, and `WebSocket` in the worker scope before user code runs. The `connect-src` CSP is a second layer, not the only one.
- **Lazy load.** Pyodide loads on first Python use, with visible progress on the board ("setting up Python, about 5 seconds"). JavaScript execution needs no load at all — prefer it for anything that does not need scientific libraries.
- **Packages.** Allow `numpy`, `sympy`, `scipy`, `matplotlib`, `pandas` via `micropip` from the Pyodide CDN. Anything else is refused with a message telling the model what is available.
- **Figures.** Patch matplotlib to a non-interactive backend, capture `savefig` to a PNG data URL, store under a `figureId`, return the id. The model places it with the `figure` op. Cap at 4 figures per step.
- **Self-hosting option.** Pyodide from a CDN is the default; document a `npm run vendor:pyodide` script that copies it into `public/` for offline or restricted networks, and note that it adds roughly 10 MB to the deploy.
- **Determinism.** Seed `random` and `numpy.random` per question so a repeated one produces the same figures.

Loading Pyodide from a CDN is the one external dependency at runtime besides the model API. If a network blocks it, `run_code` returns a clear failure and the solver continues without it — a solution must never depend on the sandbox.

---

## 12. What is kept about the learner

Almost nothing, by design. There is no learner profile, no mastery record, no misconceptions list, and no review schedule. The earlier product had all four; they were removed with the lesson flow, and nothing reads or writes them now.

What is kept, on the learner's own device only (§20):

- **Solved questions** — the last 25, each with its title, the question as typed, the board pages, the transcript, and the saved notes. Shown on the Solve screen as **Recently solved**.
- **Figures** drawn by `run_code` for those solutions.
- **Settings** — board theme, voice, speed, tutor tier, toggles, budget.
- **The access code and the model key** (§5.7).

Attachments are not kept. They exist in memory for the one request that sends them to the reader.

---

## 13. Attachments

The learner can attach what the question is in, instead of or as well as typing it (`src/solve/attachments.ts`).

- **Accepted:** images (PNG, JPEG, WebP, GIF), PDFs, and text files (`.txt`, `.md`, `.csv`, `.tex`). Up to four at once, 8 MB each. Anything else is refused with a sentence saying what is accepted.
- **Three ways in:** the **Attach a file** button, pasting a screenshot into the question box, and dropping a file on it.
- **Images are downscaled in the browser** to 1600 px on the long side and re-encoded as JPEG before sending. A phone photo is several megabytes; the model reads the smaller one just as well.
- **PDFs go as they are**, as a file content part. No PDF library, no local text extraction.
- **A text file is not an attachment.** Its contents are appended to the question.
- **Sent once, to the reader only.** Attachments ride on the reader's first message as content parts (§6) and are never re-sent. The reader restates everything in `problem`, and the solver works from that. A picture re-sent on every one of thirty turns is what would make uploads expensive; restating it once is what keeps a question with a screenshot the same price as one without.
- **Nothing is uploaded anywhere else.** Files are read in the browser and travel only inside the request to the model. They are not written to storage, the trace, or the saved solution.
- **The demo has attaching disabled**, and says so: it replays prepared walkthroughs and cannot read anything.

---

## 14. Voice and synchronization

### Narration

- `speechSynthesis.speak(new SpeechSynthesisUtterance(sentence))`, one utterance per sentence, and a long sentence is split again at its commas (about 150 characters). Engines drop or truncate long utterances.
- **Only the voice ends a step.** Where word-boundary events never arrive, a clock drives the *reveal*, but it stops just short and waits for the voice to finish. The estimate is often shorter than the real speech, and ending the step on it starts the next one, which cuts the voice off mid-sentence. That was a real bug.
- A 70 ms gap after `cancel()` before the next `speak()`: Chrome drops an utterance spoken straight after a cancel. A `resume()` every five seconds while speaking: Chrome silently pauses long speech.
- Board ops for a step reveal across the duration of that step's narration. The `boundary` event advances reveals at word boundaries; where it never fires (Safari, some Android voices) an estimated words-per-minute timer does.
- Rate control 0.75×–1.5× applies to speech and to reveal timing together.
- **Muted mode must be fully usable.** With voice off, the board advances on a timer sized to the narration length and the transcript panel shows the `say` text.
- Speech stops on pause, on a raised hand, on abort, and on unmount. Call `speechSynthesis.cancel()` in every cleanup path — queued utterances talking over each other is the single most common bug in this design.
- Respect `prefers-reduced-motion`: reveals become instant, drawing animation is skipped, narration is unaffected.

### Choosing the voice

A device can offer a clean neural voice and a twenty-year-old robotic one side by side, and the browser default is often the robot. So voices are ranked (`voiceQuality` in `src/voice/speech.ts`): neural and premium voices first, the old formant engines last, novelty voices never first, and voices for another language excluded. The best one for the learner's language is used unless they picked another.

The Solve screen has a picker showing the few best voices, a **Hear it** preview, and a **No voice, text only** option. The same list is in the transport bar while solving. Quality still depends on what the device has installed; a paid or downloaded neural voice is the upgrade path (§26).

### Pacing: every step is spoken, in order

The model writes steps several times faster than a voice can speak them. Left alone it would finish the solution while the learner is hearing step one, steps would be skipped mid-sentence, and a raised hand would land steps away from where they are. Two rules prevent that, and both are load-bearing:

- **The screen plays steps from a playlist.** `pos` is the first entry not yet spoken, and a step that has not been reached is not on the board. An answer to the learner's question jumps the queue: it is slotted in at `pos`, ahead of the step it interrupted, so they hear their answer next rather than after whatever the model had already written. The interrupted step is then explained again, without being rubbed out and rewritten.
- **The session holds the model one step ahead of the voice.** The loop awaits `beforeTurn`; with `pacing: true` the session resolves it only when at most one written step is unspoken, and the screen calls `session.stepNarrated()` as each step finishes. One step of lookahead means no silence between steps, and at most one wasted step on an interruption. A raised hand and an abort both release the hold immediately.

### The watchdog

Speech engines sometimes accept an utterance and never finish it: no audio device, a voice that failed to load, Chrome's stuck queue. Because every step now waits on its narration, each sentence has a watchdog. The limit is on silence, not on length: a voice still producing word boundaries is alive however long it runs. After two and a half times a sentence's expected length plus five seconds with nothing heard, it is cancelled and the rest of the step continues on a clock. A stuck voice can slow a solution down; it cannot freeze it.

---

## 15. Screens and interaction

No router. One page, a handful of states in React state (`src/App.tsx`). Two things are read from the URL: `?activate`, which opens the activation screen, and `?_ptxn=`, which a Paddle payment link adds; Paddle.js opens that checkout by itself.

1. **Landing** — the home page and marketing page (§29), with the question box on it. Every visit opens here, including for a subscriber or someone with their own key. The exceptions are arriving from checkout (`?activate`), which opens on Activate, and a shared link (`?s=`), which plays that solution. The wordmark on the Solve screen leads back here.
2. **Activate** — after paying, this sets the plan up by itself (waiting out the few seconds Paddle takes to attach the subscription) and then shows the access code once, with **Copy**, so it can be kept for other devices. On another device, it is one field for the code, with one line saying where it is stored. Settings also shows the code.
2a. **Own key** — one field for an API key (§5.8), with where it is stored, where it goes, and who gets paid. Reachable from the landing page, the activation screen and the demo.
3. **Solve** — the main screen. One box: "What do you want solved?", the attachment row, **Solve it**, and the voice picker. Above it, the plan line: plan name and roughly how many questions are left this month. Below it, **Recently solved**, each with **Replay, free**. A question that has been solved before is offered as a free replay before it is sent again. No subject picker, no level selector. `Ctrl+Enter` solves.
4. **Board** — the solution. The board is the screen, edge to edge, and scrolls. Above it is one thin line: what is happening, the title, and **Plan**, **Transcript**, **Details** and **Stop and leave**. The plan with its stages and the budget meter open as a side panel from **Plan** and are closed by default. Under the board is one box to ask from (`src/ui/Composer.tsx`): a text field with a microphone and a send button, and the playback controls inside it — pause, previous/next step, replay step, mute, speed and voice. When the last step has been explained, the box offers **See the summary** above it; it does not jump to the summary by itself.
5. **Review** — the summary, **Share this solution**, **Where to go next**, the worked solution with **Copy as Markdown** and **Download**, **Solve another question**, and **Export trace**.
6. **Start** — where a visitor with no plan and no key lands when they ask something: the plans, their own key, the demo, and an access code. Their question is kept and waits in the box afterwards (§30).

### The demo

**Try the demo** opens the Solve screen with five prepared questions, one per bundled walkthrough (`src/solve/examples.ts`). Picking one and pressing **Solve it** replays that walkthrough through the real session: the same pacing, voice, board and raise-hand. The box is read-only and attaching is disabled, and the screen says so — the demo can only answer what it has a walkthrough for. It is labelled **Demo** throughout, with a way to see plans.

### Agent visibility

The learner should be able to tell what the system is doing without being shown a wall of JSON. A single status line above the board, in plain language and driven by real state: "Reading your question", "Explaining this step", "Working that out in Python", "Listening to your question". A collapsible **Details** drawer shows the real trace — turn number, tool calls, arguments, results, token usage — for anyone who wants it. Never surface raw tool JSON in the main view, and never hide a failure inside a spinner.

### Stop and ask

The interruption path, and the part that makes this feel like a teacher.

1. The learner starts typing in the box under the board, presses `H` to jump to it, or presses the microphone (shown where the browser has speech recognition), which starts listening at once. Speech stops immediately.
2. They type or say their question and send it. Nothing is explained while there is text in the box; emptying it, or `Esc`, lets the explanation carry on.
3. The question is injected as the solver's next user message, and the pacing hold is released so it is answered now.
4. The solver answers in **one** step, written into its own box on the board and spoken next, ahead of anything it had already written.
5. Above the box: **Did that answer your question?** — **Yes, carry on** or **Explain it another way**; asking something else is just typing again. The solution is held until they choose (`Session.resumeAfterAside`).
6. *Yes*: the solver is told to carry on from exactly where it stopped, and the step that was interrupted is explained again from its start. *Another way*: it explains the same point differently — a picture instead of algebra, numbers instead of symbols — and they are asked again.

The learner decides when they have understood. The solver may not decide it for them and may not quiz them to find out; this is enforced by the session holding the loop, not by the prompt.

A question asked after the solution has finished works the same way: the solver is run again from the end of its own conversation, so it remembers the whole solution.

In the demo there is no model to answer, so the panel says so: the walkthrough simply carries on with its next step.

### The clarifying question

When the reader asks (§8.2), a panel appears over the board with the question, the options if it offered any, and **Skip**. Nothing proceeds until the learner answers or skips.

### Keyboard

`Space` pause/resume · `←` `→` step · `R` replay step · `H` stop and ask · `M` mute · `?` shortcuts · `Esc` stop. All controls reachable by tab, with visible focus.

---

## 16. Design direction

The board is the product. Everything else is a thin rail around it.

**Surfaces.** Two board themes, toggleable, both grounded in real classroom surfaces rather than generic app chrome:

- *Slate* (default) — deep green-black board `#122019`, chalk `#F2EFE6`, slightly dusty stroke edges.
- *Paper* — warm white `#FBFAF7`, ink `#1A2233`, faint ruled grid.

App chrome is a neutral `#0E1113` rail. The board never sits inside a rounded card with a drop shadow.

**Subject accents**, one each, used for headings, the active rail item, and `key` boxes: math `#4C6EF5`, physics `#E8590C`, chemistry `#0CA678`, computer science `#7048E8`, biology `#C2255C`, finance `#F08C00`, psychology `#1098AD`, any other subject `#74B816`.

**Type.** Atkinson Hyperlegible Next for board text and UI — it was designed for low-vision readability, which is the right argument for a teaching tool, and it does not look like every other site. IBM Plex Mono for code and data labels. KaTeX keeps its own fonts. One scale used consistently: 48 / 32 / 24 / 18 / 15.

**Motion.** Content is *written*, not faded in: text reveals left to right, strokes draw along their path, diagram edges extend from source to target. That drawing motion is the one place to spend effort. Everywhere else — panels, menus, buttons — motion only confirms an action. No hover animation on cards, no staggered page-load entrances.

**Copy.** Sentence case, active voice, no exclamation marks. Buttons name what happens: **Solve it**, **Raise hand**, **Attach a file**. The empty question box invites a question rather than describing the feature. Errors say what failed and what to do — "You have used this month's credit. It renews with your next payment, or you can move to a bigger plan." not "An error occurred."

**Agent status, not agent theatre.** No fake typing indicators, no "thinking…" with animated dots pretending at depth. The status line says what is actually happening, and it is accurate because it is driven by real phase transitions.

Quality floor, unannounced: responsive to 360px, visible keyboard focus, `prefers-reduced-motion` honored, contrast ≥ 4.5:1 on both board themes, full keyboard control, no layout shift when the board paginates.

---

## 17. Failure handling

An agent loop has more failure modes than a request-response app, and every one of them will happen in front of a learner. The taxonomy lives in `src/runtime/errors.ts`, not in scattered try/catch.

### 17.1 Error taxonomy

| Class | Cause | Handling |
|---|---|---|
| `AuthError` | 401/403 from the model gateway | The key was rotated (activated on another device) or the subscription lapsed. The board screen says the plan is no longer connected and offers **Reconnect**, which re-activates with the stored license. If that fails, it says why. On an own key there is nothing to reconnect: say the provider refused the key and point to Settings. |
| `CreditError` | 402, or the key's cap is reached | Stop gracefully and save. On a plan: say the month's credit is used, that it renews with the next payment, and offer the bigger plans. On an own key: say their provider reports no credit left. Never retry. |
| `RateLimitError` | 429 | Exponential backoff with jitter, 3 attempts, honoring `retry-after`. |
| `OverloadedError` | 529 / 503 | Same backoff. The gateway also falls back to a second model at the same price (§18). |
| `NetworkError` | offline, DNS, blocked | Distinguish offline (`navigator.onLine`) from blocked. |
| `ContextError` | context window exceeded | Force a compaction pass and retry once. |
| `SchemaError` | tool args fail Zod | Return `ok:false` to the model with the field named. Not fatal. |
| `ToolError` | tool ran and failed | Return the error text. The model retries or routes around it. |
| `SandboxError` | timeout, crash, blocked CDN | Return clearly; solving continues without the sandbox. |
| `RefusalError` | model declines | Surface plainly. Do not retry silently. |
| `BudgetError` | token or turn budget hit | Graceful close: the summary says it ran out of room, and what was worked out is saved. |
| `LoopError` | no progress detected | §17.3. |

### 17.2 Truncation

`stop: 'max_tokens'` in the middle of a tool call yields unparseable arguments. Do not send the fragment back. Discard the partial assistant turn, append a user message saying the previous turn was cut off and to send a smaller `teach_step`, and retry once. Twice in a row means the model is producing oversized steps — halve `max_tokens` and note it in the trace.

### 17.3 Loop and repair

Detect no-progress conditions and act on them rather than burning the budget:

- **Repeated tool call** — same tool, same arguments hash, three turns running. Inject a user message naming the repetition and asking for a different approach.
- **No tool call** — the model returns only prose. Nudge once, then re-send with `toolChoice: 'required'`.
- **Board slips** — tidied before checking where the intent is unambiguous, and a rejection quotes the operation's correct shape (`src/board/tidy.ts`).
- **Board validation failure** — two failures on the same step escalates to the repairer (§8.4); if that fails, drop the ops and render `say` as plain text. The learner still gets the explanation.

### 17.4 Degradation ladder

Each rung is a real, tested mode:

1. **Full** — everything above.
2. **No sandbox** — Pyodide blocked, failed, or switched off. `run_code` is not offered and the solver is told so in its prompt. Everything else works.
3. **No voice** — speech synthesis missing, muted, or stuck. Timed reveals plus the transcript.
4. **Demo** — no subscription or no network. Prepared walkthroughs play in full through the real session.

### 17.5 What is never acceptable

- Fabricating a learner's answer to keep the loop moving.
- Skipping a step's narration, cutting the voice off mid-sentence, or showing the summary before the last step has been explained.
- Carrying on with the solution before the learner has said their question was answered.
- A spinner with no explanation for longer than 3 seconds.
- Losing work in progress on any error.
- Showing a raw stack trace or raw tool JSON in the main view.
- Silently dropping a board operation without telling the model it was dropped.

---

## 18. Budget and cost control

The learner has prepaid a fixed credit, and the margin depends on never exceeding it, so the app is accountable for every call. The cost of a solved question is something to engineer down, because it is what a plan is worth.

**What keeps a question cheap**

Every turn re-sends the system prompt, the tool definitions and the conversation so far. A question is fifteen or so turns, so anything in those three is paid for fifteen times. The levers, biggest first:

- **Do not send it at all.** A solved question is saved on the device. Asking the same thing again — the same words, ignoring case, spacing and punctuation — offers **Replay it, free** before anything is sent, and every entry under **Recently solved** has the same button. A replay goes through the real session, board, voice and pacing from the saved record (`src/providers/replay.ts`): no request, no tokens, and the meter says zero. It cannot answer a new question; the panel says so.
- **Say each thing once.** The board's thirteen operation shapes are listed compactly in the system prompt. The schema generated for `teach_step` said the same thing again in about two thousand tokens, on every turn. The model is now sent only the list of operation names (`BOARD_OPS_WIRE`); the full Zod schema still checks every call at the bus and names the offending field when one is wrong. A tool declares this with `wire`.
- **Send only what the model reads.** `minifySchema` strips from every tool schema the keys that only a validator needs: length, size and numeric limits, patterns, `additionalProperties`, a `const` that repeats an `enum`. Limits also stay off the wire because some services check a call against the schema themselves and throw the whole reply away over a string a few characters too long; and a tuple is sent as a plain array, because the stricter services refuse the older tuple form. Tool descriptions are a few sentences, not an essay; the worked example is one line of JSON, not indented.
- **A budget, held by a test.** The solver's fixed cost per turn — system prompt plus tool definitions — was about 6,050 tokens and is now about 3,750. A test fails if it passes 4,200, because this number creeps.
- **Few tools.** The solver is offered five tools (six with Wikipedia on) and the reader two. Every definition is paid for on every turn.
- **Few turns.** Numbers go into the step as `{{expression}}` rather than costing a `compute` turn first: in a live run, three of seventeen turns were only fetching numbers. `save_note` and `end_lesson` in the same turn.
- **No turn lost to a slip.** A rejected call costs a whole turn, and a model that cannot see its mistake repeats it: one live run spent five turns writing `{"derive":[…]}` instead of `{"op":"derive","lines":[…]}`. The unambiguous slips — that one, a tone the board does not have, a number sent as a string — are put right at the bus before checking (`src/board/tidy.ts`), and the result tells the model how to write it. A call that still fails quotes the right shape back.
- **A short conversation.** Compaction starts at about 8,000 tokens of conversation and keeps the opening and the last four turns; everything older becomes a short deterministic summary of what is on the board. On a service with no prompt cache this is the difference between a long question costing linearly and quadratically.
- **Prompt caching.** Through OpenRouter every request asks for the prefix to be cached, so it is read back at a tenth of the price. Anything that changes the prefix mid-solution — reordering tools, editing the system prompt per turn — throws that away, so do not.
- **Cheapest model that solves well.** The standard tier runs every agent on a small, fast model (`src/providers/managed.ts`). Re-check the gateway's price list when it changes.
- **Attachments sent once** (§13), and **capped output** (§8.5).
- **A fallback model at the same price**, so an outage does not change the cost.

What was looked at and not done: semantic caching with embeddings (an exact match after tidying catches the common case — the same homework question — without a second model or a download); compressing prompts with a model (it costs a call to save part of one); several steps per turn (fewer turns, but a raised hand would waste everything already written).

**What the learner sees**

- **Plan line** on the Solve screen and in Settings: the plan and roughly how many questions are left this month, from the key's remaining credit read live from OpenRouter. Shows nothing rather than a wrong number when the read fails.
- **Live meter** in the rail: turns, tokens in and out, and the cost of this question. The gateway reports what each turn cost; the meter shows that figure and falls back to the static price table (`src/providers/pricing.ts`, labelled an estimate) only when it is missing.
- **Pre-flight check** — on the Solve screen, if no credit is left, **Solve it** is disabled and the bigger plans are offered; if little is left, it says a long solution may stop early.

**The limits**

- **Per-question budget** — default 200k billable input / 30k output tokens, with Short, Normal and Long presets in Settings. A cached token counts as a tenth of a fresh one, matching what it costs. At 80% the solver is told to wrap up. At 100% the runtime closes the solution. It never dies mid-sentence because of a budget.
- **Model tiers** — the standard tier is the default and is what the "questions per month" figures are computed from. The deeper tier moves only the solver to a stronger model, and Settings says plainly that it uses questions about eight times as fast.
- **The hard stop is not ours.** OpenRouter refuses requests once the key's cap is hit. Client-side budgeting is for a good experience; the cap is what protects the margin.

---

## 19. Security and privacy

- Questions, uploads and solutions go from the browser straight to OpenRouter. Our functions never see any of them, unless the learner presses Share, which stores that solution, without its uploads, until they stop sharing or for six months. Say so once, plainly, on the landing page and where the button is.
- CSP `connect-src` allowlists our own origin, the services a key can belong to (§5.8), the Wikipedia API, the Pyodide CDN, and Paddle. Nothing else. Paddle also needs `script-src`, `style-src`, `font-src`, `frame-src` and `img-src`: a real browser found its stylesheet blocked, and a test now holds all five.
- A learner's own key is sent only to the provider that issued it, in a header and never in a URL, and never to our servers.
- The sandbox is a null-origin iframe with network globals removed inside the worker (§11).
- No third-party analytics, no error reporting service, no fonts loaded from a third party — self-host the two typefaces. Our own usage counts hold no text and no address, and are not sent from a browser that asks not to be tracked (§30).
- Attachments are read in the browser, held in memory for one request, and never written to storage, the trace, or a saved solution.
- Trace exports are scrubbed: no access code, no model key.
- `rel="noopener noreferrer"` on every external link.
- Webhooks are verified by HMAC signature over the raw body, compared in constant time, before anything is parsed (§28).
- `/api/activate` accepts only a well-formed transaction id, looks it up with our own Paddle API key (so it can only ever find our transactions), and grants only for a paid transaction on a subscription to one of our prices.
- We hold payment data nowhere. Paddle is the merchant of record and owns cards, invoices, tax, and the customer's email.

---

## 20. Storage

`localStorage` — small, synchronous, needed at boot:

| Key | Contents |
|---|---|
| `chalk.license` | access code (field still named `licenseKey`), plan id, activation time |
| `chalk.key.openrouter` | the provisioned, spend-capped model key |
| `chalk.key.{provider}` | a learner's own API key, when they use one (§5.8) |
| `chalk.settings` | theme, voice, speed, tutor tier, toggles, budget, and whose own key is in use |

IndexedDB — everything else, via `idb-keyval` (`src/storage/db.ts`):

| Database | Store | Key | Value |
|---|---|---|---|
| `chalk-lessons` | `lessons` | solution id | `SolutionRecord`: title, question, board pages, transcript, notes, timestamps |
| `chalk-figures` | `figures` | figure id | PNG data URL, solution id |

One database per store, deliberately: `idb-keyval` creates an object store only when it creates the database, so two stores sharing one database name means the second never exists.

Cap: 25 solved questions, oldest evicted with a notice, never silently. A browser with storage blocked runs normally with no history and says so once.

The `chalk.*` and `chalk-*` names predate the rename and are kept so existing data is not orphaned.

---

## 21. File layout

```
lemmeteach/
  index.html                       # loads public/csp.js first
  vite.config.ts                   # base: './'
  package.json
  .env.example                     # every environment variable, explained
  public/
    csp.js                         # assembles the Content-Security-Policy
    fonts/  fonts.css              # self-hosted typefaces
    sandbox.html  sandbox-frame.js  sandbox-worker.js
  shared/
    plans.ts                       # the one pricing table (§27), used by client and api
  api/                             # Vercel functions — billing only (§28)
    activate.ts                    # access code → capped model key
    webhook.ts                     # Paddle events → grant / disable
    _lib/
      paddle.ts  openrouter.ts  grants.ts  events.ts  http.ts
  src/
    main.tsx
    App.tsx                        # screen state, no router
    core/types.ts                  # subjects, levels, agent and provider ids
    orchestrator/
      machine.ts                   # phase FSM (§3)
      session.ts                   # one solved question: reader → solver, ports, pacing
    runtime/
      loop.ts                      # runAgent (§7)
      budget.ts  compact.ts  errors.ts  trace.ts
    providers/
      index.ts  types.ts
      openai.ts  openrouter.ts     # the OpenAI-shaped adapter the product uses
      mock.ts                      # the demo: replays a prepared walkthrough
      managed.ts                   # model tiers, fallbacks, the credit read
      replay.ts                    # playing a solved question back at no cost (§18)
      own-key.ts                   # a learner's own key: detect, check, choose models (§5.8)
      anthropic.ts  gemini.ts      # used by an own key from those providers
      normalize.ts  schema-narrow.ts  sse.ts  partial-json.ts  pricing.ts
    agents/
      index.ts                     # reader, solver, repairer prompts and seeds
      skills.ts                    # the solver's versioned skills document (§8.5)
      prompts/
        base.ts  policy.ts  subjects.ts
    tools/
      index.ts  registry.ts  context.ts
      schemas.ts  json-schema.ts   # Zod → JSON Schema, single source
      teach-step.ts  ask-learner.ts  run-code.ts  compute.ts
      wiki-lookup.ts  notes.ts  lifecycle.ts
    board/
      Board.tsx  page.ts  layout.ts  diagram-layout.ts  validate.ts
      op-schema.ts  themes.ts  reveal.ts  highlight.ts  tex.ts
      ops/                         # the op components
    sandbox/
      host.ts                      # iframe + postMessage bridge
    solve/
      attachments.ts               # reading, shrinking and limiting uploads (§13)
      examples.ts                  # the demo's five questions
    billing/
      paddle.ts                    # Paddle.js: load it, open checkout, hand back the access code
      license.ts                   # activate, reactivate, sign out
      links.ts                     # the customer portal link
    voice/
      speech.ts                    # narration, voice ranking, watchdog (§14)
      recognition.ts
    storage/
      settings.ts                  # settings and the key vault
      db.ts  records.ts
    ui/
      Landing.tsx  SubjectExplorer.tsx  showcase.ts  SubjectGlyph.tsx
      Activate.tsx  OwnKey.tsx  Solve.tsx  VoicePicker.tsx  PlanLine.tsx
      LessonScreen.tsx  Review.tsx  SettingsPanel.tsx
      AskPanel.tsx  Composer.tsx  Transcript.tsx  Details.tsx
      Meter.tsx  Shortcuts.tsx  Toasts.tsx
    fixtures/
      lessons/                     # the five prepared walkthroughs, NDJSON
      tapes/                       # recorded sessions, none bundled yet
    styles/
      app.css  board.css
  evals/
    golden.json                    # questions with known answers (§8.5)
  .github/workflows/deploy.yml     # demo-only mirror on GitHub Pages
  README.md
```

Nothing under `src/` may import from `api/`.

---

## 22. Testing

The suite runs with no API key and no network: `npm test`.

### Unit

Provider normalization in both directions against captured raw responses, including an attachment as content parts. Zod schemas accepting good input and rejecting each documented bad case. Board validation, every rule in §10.3. The phase machine, including that every phase can finish. The tool catalogue against the access matrix in §8.1. Voice ranking. Free replay: the same board and narration with no request, and a question recognised when it is asked again. What is sent each turn: the slim schemas, and a ceiling on the solver's fixed cost per turn. A learner's own key: every service's key shape recognised, checked with its own service and nobody else, never in a URL, the quirks each service needs actually sent, the CSP allowing every service, and attachments in each provider's shape. The pricing table against the margin rule (§27). The billing rules and both functions against in-memory stand-ins for Paddle and OpenRouter (§28). Counts and shared links against an in-memory store, including every limit and the store being down (§30). The layering rule: no provider name in a conditional above the adapter layer.

### Integration, no network

The mock adapter replays the prepared walkthroughs through the real session, the real tool bus and the real board model (`src/orchestrator/session.test.ts`). Covered: a question solved end to end; every bundled walkthrough; an attachment reaching the reader once and nobody else; a clarifying question that waits for a real answer; a session stopped mid-question that does not invent one; a raised hand answered in one step and then held until the learner confirms, both ways; a second question while waiting; a question after the solution has finished; an abort; pacing, including that a raised hand and an abort release it; no sandbox; a sandbox timeout; Wikipedia on and off; budget exhaustion; the demo making no network request.

### The whole visitor path

`src/growth/flow.test.tsx` drives the real app with only the network faked: a visitor with no plan and no key never causing a model request; their question waiting for them after they bring a key; a subscriber solving from the home page; running out of credit; a shared link that has gone, is malformed, is tampered with to inject markup, or holds nothing valid.

### Rendering and accessibility

Every screen is mounted for real and audited with axe. Rules that need a layout engine are excluded explicitly, so the list is a visible statement of what still needs a real browser.

### What the suite cannot tell you

Whether a real model solves a real question well, reads a real screenshot, or stays within the cost estimate. Those need a live key (§26). The prepared walkthroughs are authored, not recorded.

---

## 23. Status and what is next

Built and tested against stand-ins:

- The scrolling board, playback, voice with ranking and watchdog, and pacing.
- Stop and ask, by typing or by voice, with the learner confirming the answer landed.
- Using your own API key instead of a plan.
- The runtime, the tool bus, the reader and solver, and the demo.
- Attachments, the Solve screen, the landing page, activation.
- Pricing, both billing functions, and the grant rules.

Not yet done, in rough order:

1. **A real end-to-end run.** Paddle sandbox account, product and three prices, an OpenRouter account with auto top-up, Vercel environment variables, and one purchase in test mode: pay, activate, solve a typed question, solve a screenshot, cancel.
2. **Measure and tune.** The real cost of a solved question, and the quality of solutions on the standard model. Correct `TYPICAL_LESSON_USD` and the question counts; treat a weak board as a prompt bug before moving up a model.
3. **Rewrite the five demo walkthroughs** as worked solutions. They were written as topic lessons and still read that way.
4. **Legal pages** — terms, privacy, refunds — and the footer links to them. Must exist before launch: the site stores shared solutions (§30).
5. **Replaying across devices.** A solved question can be replayed free on the device it was solved on; there is no sync.
6. **A runner for the golden set** (§8.5), so it is one command rather than twelve by hand.
7. **Own keys on the newer OpenAI models**, which need `max_completion_tokens` and no temperature.

---

## 24. Deployment

Static output in `dist/` plus the functions in `api/`. Keep `base: './'` in `vite.config.ts`. The static build must still succeed with no environment variables at all — it then runs as demo-only, with the plan buttons disabled.

**Vercel** is the host, because the billing functions live beside the static files on one origin. Connect the repo (build `npm run build`, output `dist`) or run `npx vercel --prod`. Charging money takes the project off Vercel's Hobby plan, which is non-commercial only: budget for Pro.

Server environment variables (Vercel dashboard, never in the repo, never prefixed `VITE_`):

| Variable | What it is |
|---|---|
| `OPENROUTER_MANAGEMENT_KEY` | Management key that creates and caps learner keys |
| `PADDLE_ENV` | `sandbox` or `production` |
| `PADDLE_API_KEY` | Paddle API key, read access to transactions and subscriptions (`pdl_sdbx_…` in the sandbox) |
| `PADDLE_WEBHOOK_SECRET` | The webhook destination's secret (`pdl_ntfset_…`) |
| `PADDLE_PRICE_STARTER` / `_REGULAR` / `_INTENSIVE` | Price id of each plan (`pri_…`); sandbox and live ids differ |

Public build-time variables (safe to expose):

| Variable | What it is |
|---|---|
| `VITE_PADDLE_CLIENT_TOKEN` | Paddle client-side token (`test_…` / `live_…`); it can only open checkouts |
| `VITE_PADDLE_ENV` | `sandbox` or `production`, matching the token |
| `VITE_PADDLE_PRICE_STARTER` / `_REGULAR` / `_INTENSIVE` | The same price ids, for opening checkout |
| `VITE_BILLING_PORTAL_URL` | Optional: the seller's Paddle customer portal, where **Manage subscription** goes. Without it, the learner is pointed to the link in Paddle's receipt email |

**Paddle setup** — one product with three monthly prices; an API key and a client-side token (Developer tools → Authentication); a webhook destination to `https://<site>/api/webhook` subscribed to every `subscription.*` event plus `adjustment.created` and `adjustment.updated`; and the default payment link (Checkout → Checkout settings) set to `https://<site>/`, which Paddle requires before any checkout opens. In the sandbox, `http://localhost:5173/` is allowed. Sandbox test card: `4242 4242 4242 4242`, any future date, any CVC.

**OpenRouter setup** — one account, auto top-up on so the balance never runs dry, a management key.

**GitHub Pages** still works for a demo-only mirror via `.github/workflows/deploy.yml`; it has no functions, so nobody can activate there.

**Offline / PWA** — a service worker caching the app shell, fonts, and the demo walkthroughs. Optional, and last.

**README** — written for whoever operates the product, not for learners: what it is, how to run it locally, the setup steps and environment variables above, how the pricing table works, and a **How it works** section covering the reader and solver, the tool list, and exactly what the backend does and does not see.

---

## 25. Definition of done

**Product**

- [ ] A visitor understands what LemmeTeach is and what it costs without scrolling past the second screen, and can try the demo in one click.
- [ ] Paying and solving a first question takes under three minutes and needs no instructions.
- [ ] A typed question, a pasted screenshot and an attached PDF are each solved correctly, step by step, with the answer stated and checked.
- [ ] Every step is spoken in order; nothing is skipped; the summary appears only after the last step.
- [ ] Stopping it interrupts within 300 ms. The answer is spoken next, the learner is asked whether it made sense, and the solution resumes from where it stopped only when they say yes.
- [ ] The voice never stops mid-sentence, and every earlier step can be scrolled back to.
- [ ] Pasting a working API key from a supported provider is enough to solve a question, with no subscription and nothing else to choose.
- [ ] It never quizzes the learner. It asks only when the question genuinely cannot be solved as given.
- [ ] A learner who runs out of credit is told so in plain words, loses nothing, and is offered the next plan.
- [ ] Every board op renders correctly at 360px and at 2560px.
- [ ] Everything works in the demo with no payment, and with voice off.

**Engineering**

- [ ] No provider name appears in a conditional above the adapter layer.
- [ ] Every tool input is validated; a malformed call is a recoverable turn, never a crash.
- [ ] The solver is not offered `ask_learner`, and no quiz, exam or learner-record tool exists — asserted by test.
- [ ] Attachments reach the reader once and no other request — asserted by test.
- [ ] Every error class in §17.1 has a test and a user-visible message written for a human.
- [ ] Aborting or closing the tab leaves no speech playing, no worker running, no pacing hold, and no lost work.
- [ ] Neither the access code, the model key, nor a learner's own key appears in any trace export, saved solution, log line, or URL — asserted by test.
- [ ] No key is ever issued without a cap, and no renewal can grant credit twice — asserted by test.
- [ ] A webhook with a bad signature changes nothing.
- [ ] A cancelled, expired or refunded subscription ends with a disabled key.
- [ ] Every plan in `shared/plans.ts` clears $2 after fees, the hosting allowance and full credit use — asserted by test.
- [ ] The solver's fixed cost per turn stays under its ceiling, and a replay makes no request — both asserted by test.
- [ ] The static build succeeds with no environment variables and runs as demo-only.

---

## 26. Assumptions to confirm

These were chosen to satisfy the constraints in §2. Say so if any should change.

1. **Solve-only.** No lessons, quizzes, exam or learner record. A learner who wants to be taught a topic types the topic and gets it explained with one worked example.
2. **Web Speech API for voice**, with the best installed voice chosen automatically. Free and instant, but quality varies by device. A paid cloud voice or a neural voice downloaded into the browser is the upgrade path, and either changes cost or load time.
3. **The reader, not the solver, sees attachments.** Cheaper by a wide margin; the cost is that a figure reaches the solver as a description rather than a picture. If solutions suffer on diagram-heavy questions, the fix is to pass images to the solver's first turn as well.
4. **Eight subjects, one of them a catch-all** (§10.4), chosen by the reader. The honest limit is what the board can draw: it has no maps, musical notation or pictures.
5. **An access code instead of accounts.** No login, no user database. The code is the Paddle transaction id, shown once after paying and kept in Settings; a learner who loses it on every device needs the operator to look it up in Paddle. History stays on one device, and activating on a second device signs the first one out until it reconnects.
6. **English UI first**; narration follows the language of the question. Right-to-left layout is not handled.
7. **Wikipedia as the only external knowledge source**, off by default.
8. **Pyodide from a CDN** by default, with a vendoring script for restricted networks.
9. **Paddle as merchant of record.** Its fee (5% + $0.50) is the largest variable in the margin.
10. **OpenRouter as the only model gateway**, because it can issue per-learner capped keys callable from a browser.
11. **No database.** OpenRouter key names hold the billing state (§28). Fine for hundreds of subscribers; move to a key-value store before thousands.
12. **Unused credit does not roll over.** Monthly billing only; annual plans, trials, coupons and top-up packs are unspecified.
13. **Hosting is covered by a per-subscriber allowance** of $0.25, which pays for Vercel Pro at eighty subscribers. There is no per-user storage cost.
14. **The cost of a solved question is worked out, not yet measured.** `TYPICAL_LESSON_USD` (1.5 cents) comes from measured prompt sizes and assumed turn counts and output lengths. Real models may take more turns or write more. Measure it on a live key and correct the counts before launch: the spending cap protects the margin either way, but the promise on the pricing page rests on this number.
14a. **A slimmer tool schema may cost accuracy.** The model is no longer sent the full shape of each board operation in the schema, only in the prompt. A weaker model may get more operations wrong and need a retry, which costs a turn. Watch the board rejection rate on the golden set; if it rises, restore the full schema for that model.
15. **The standard model is very new and very cheap.** Its quality on this product is untested, as is its reading of screenshots and PDFs.
16. **Own keys undercut the plans, by request.** Anyone technical enough to have a key pays us nothing. The plans are for people who would rather not deal with keys; if that turns out to be too few, this is the first thing to revisit.
17. **An own key gets the small model.** There is no way to ask for a stronger one yet.
17a. **Unlisted services are refused, not guessed at.** Supporting one means checking it accepts browser requests, finding its key shape and its quirks, and adding it to the list with a test. A service that blocks browser requests cannot be supported without a proxy, which §2 forbids.
18. **Voice input uses the browser's speech recognition**, which Chrome and Safari have and Firefox does not, and which in Chrome sends audio to Google. Where it is missing, the button is not shown and typing always works.
19. **The demo walkthroughs are authored and lesson-shaped.** They show the board, voice and pacing truthfully, but their wording is "let me teach you this", not "here is your answer" (§23).

---

## 27. Product, plans and pricing

LemmeTeach sells one thing: questions solved. A plan is a monthly amount of AI credit, described to the learner as an approximate number of questions.

### 27.1 The plans

| Plan | Price / month | AI credit | Roughly |
|---|---|---|---|
| Starter | $8 | $4.50 | 300 questions |
| Regular | $12 | $8.00 | 530 questions |
| Intensive | $20 | $15.00 | 1,000 questions |

The figures assume the standard model tier and 1.5 cents per solved question (`TYPICAL_LESSON_USD`), rounded down. That is worked out from measured prompt sizes — about 80k input and 6k output tokens over sixteen turns, which is 1.1 cents with no prompt caching and about half a cent with it — and not yet from a live key (§26.14). Replays are free and are not counted. In `shared/plans.ts` the field is still called `lessons`. They are always shown with "about", never as a promise.

### 27.2 The margin rule

For every plan, with all fees at their worst case:

```
kept        = (price × (1 − 0.05) − 0.50) × (1 − 0.01)     // Paddle: 5% + $0.50, all in;
                                                            //   then 1% allowed for the payout
credit cost = credit × 1.055                                // OpenRouter's fee on buying credit
profit      = kept − credit cost − $0.25 hosting allowance   ≥  $2.00
```

`shared/plans.ts` holds the prices, credits and fee constants, and a test asserts the inequality for every plan. To change a price, change it there and let the test tell you whether the credit still clears $2. When a learner does not use all their credit, the remainder is extra margin; the rule guarantees the floor, not the average.

Fees change. The constants carry the date they were last checked against the providers' pricing pages.

### 27.3 What a subscriber gets

- Their own questions solved, in any subject, at any level, from text, a screenshot or a file.
- The worked solution to each, to copy or download, and their recent history — stored on their device.
- The standard tutor by default; the deeper tutor on any plan, at about eight times the credit per question.
- No rollover, no overage. When credit is gone, solving stops until renewal or an upgrade. Everything already solved stays readable.

### 27.4 What is free

The demo: five prepared questions, solved through the real board, voice and controls. It costs us nothing to serve and is the whole sales pitch.

---

## 28. Billing backend

Two functions, no database. State lives in the two services that already have to be right about it: Paddle knows who is paying, OpenRouter knows what each key may spend.

```
 Paddle.js checkout ──► Paddle ──webhook──► /api/webhook ──► OpenRouter management API
        │ (overlay)        ▲                                   (create · cap · disable)
        └─ txn_… ─► browser ─► /api/activate ──► Paddle API (read) ──► capped key ─► browser
                                                                                     │
                                                             questions ──────────────┴──► OpenRouter
```

### 28.1 The key record

Each subscription owns at most one OpenRouter key, and the key's **name** is the record:

```
lemmeteach:s<subscriptionId>:p<planId>:r<periodStart>[:refunded]
```

`subscriptionId` is Paddle's (`sub_…`). `planId` is what was last granted. `periodStart` is the epoch seconds of the start of the billing period last granted (`current_billing_period.starts_at`). `:refunded` marks a period whose payment was refunded or charged back, so nothing switches the key back on until a new period is paid for.

Remaining credit is always `limit − usage`, both kept by OpenRouter.

### 28.2 `POST /api/activate`

Body `{ code }`: a Paddle transaction id, `txn_…`. The browser gets it from Paddle.js the moment a checkout is paid (`checkout.completed`); on another device the learner pastes it. Steps:

1. Refuse anything that is not shaped like a transaction id, without asking Paddle.
2. Read the transaction with our API key. Unknown → `invalid_code`. Not `paid` or `completed` → `not_paid`. Paid but no subscription attached yet → `pending` (409); the browser asks again for up to 45 seconds after checkout.
3. Read the subscription. Its first item's price must be one of ours, or `unknown_plan`.
4. Find the subscription's key by name and run **the same grant rules the webhook runs** (§28.3) against what Paddle says now. A missed or late webhook is caught up here, and the rules are idempotent, so this never grants twice.
5. If the rules created the key, return it. Otherwise, if the key is disabled, answer "subscription ended". Otherwise rotate: the raw key cannot be read back, so note `remaining = limit − usage`, delete it, and create a new key with `limit = remaining` and the same name.
6. Return `{ apiKey, plan, creditUsd }`.

Rotation is why a second device signs the first one out, and why a shared code is self-limiting: there is only ever one live key and one pot of credit.

### 28.3 `POST /api/webhook`

Verify `Paddle-Signature` (`ts=…;h1=…`, an HMAC-SHA256 of `ts:rawBody`, constant-time compare, any `h1` during secret rotation, a timestamp within five minutes) before parsing. Then every `subscription.*` event is read as a fresh look at the subscription, and an approved full refund or a chargeback (`adjustment.*`) as a refund:

| Situation | Action |
|---|---|
| Status `active` or `trialing`, no key | Create it with `limit = plan credit`, marker = period start. |
| Paying, period start later than the marker | A new paid period: `limit = usage + plan credit`, update the marker, re-enable, clear a refund. Unused credit is dropped, not carried. |
| Paying, same period, plan changed to a bigger one | Raise the limit by the difference in credit. A downgrade takes effect at the next renewal. |
| Paying, same period, key disabled and not refunded | Re-enable it. |
| Status `past_due` | Nothing: what was paid for still works, and nothing new is granted until the payment succeeds. |
| Status `canceled` or `paused` | Disable the key. A scheduled cancellation stays `active` until the period ends, so the learner keeps what they paid for. |
| Refund or chargeback | Disable the key and mark the period refunded. |
| anything else | 200 and ignore. |

Every rule is idempotent: Paddle retries webhooks and activation reruns the rules, and neither may ever grant twice. The rules are a pure function in `api/_lib/grants.ts` from (event, subscription, current key) to an action, so they are tested without a network.

### 28.4 Failure handling

- OpenRouter or Paddle unreachable during a webhook → return 500 so Paddle retries.
- Unreachable during activation → tell the learner payment is fine and to try again in a minute.
- A price that is not ours → 200 to the webhook (not ours to retry), a clear error to activation.
- Errors returned to the browser never include the management key, the Paddle key, the upstream response body, or another customer's data.

### 28.5 What the backend must never do

Proxy model traffic. Store or log access codes, model keys, or emails. Issue a key without a limit. Trust an unsigned webhook. Trust the client about which plan it is on. Write anything to Paddle.

### 28.6 Not used: object storage

Cloudflare R2 (or any bucket) has no job here. Uploads are read in the browser and sent once, inside the request to the model (§13), and never stored. Rate limits need atomic counters, which a bucket does not have, so §30 uses a key-value store, and shared solutions are small enough to live there too.

---

## 29. Landing page

One scrolling page, rendered by the same app (`src/ui/Landing.tsx`), and the first thing every visit shows. It follows §16: the board is the hero, copy is plain, motion is reserved for the board writing itself.

Sections, in order:

1. **Header** — sticky. Wordmark, **Use my own API key**, **I have an access code**, **See plans**. When a plan or an own key is already connected on the device, just **Start solving**, and the hero leads with it and says which is connected.
2. **Hero** — "Stuck on a question? Watch it solved step by step." Directly under it, above the fold on a phone, the question box with **Solve it**: asking is the main action of the page. Under the box **Try the demo** and **See plans**, then one paragraph on how it works. Beside it, a real board that writes itself out and then moves on to the next field: fourteen example boards across physics, history, chemistry, English, finance, geography and so on (`src/ui/showcase.ts`), no subject taking more than two. They are hand-written, captioned as examples, and validated like any board.
3. **How it works** — five steps: you bring the question, it reads it properly, it solves it on a board, it explains aloud, you can interrupt.
4. **Comparison** — a video course, an AI chatbot and LemmeTeach against the same six behaviours, worded fairly.
5. **Subjects** — an explorer (`src/ui/SubjectExplorer.tsx`): pick a subject and see how it is handled (the subject pack's own rules, in a sentence), an example board in that subject, and the kind of thing people ask.
6. **Plans** — the three plans from `shared/plans.ts`: price, approximate questions a month, cents per question, **Choose** button that opens Paddle's checkout over the page. The one badge, lowest price per question, is computed from the table. Under the plans, an offer for anyone who already has an API key: use it, pay your provider, pay us nothing.
7. **Questions** — whether it can be used without subscribing, what counts as one question, what can be uploaded, what happens when they run out, where the data lives, two devices, cancelling.
8. **Closing** — "See a question solved before you pay for one."
9. **Footer** — wordmark and who handles payment (Paddle). Terms, privacy and refunds links are still to be added (§23).

Rules:

- Every number on the page comes from `shared/plans.ts`. Nothing is typed twice.
- Say only what the product does. No "waits for your answer", no quizzes, no progress tracking, no "remembers what you know" — those described the earlier product.
- No testimonials, logos, or user counts that are not real. No countdown timers.
- A plan button with no checkout URL configured is visibly disabled and says so, rather than leading nowhere.
- Responsive to 360px, keyboard reachable, contrast ≥ 4.5:1 — the same floor as the rest of the app.

---

## 30. Growth: sharing and counts

Added for the YC application, where what counts is real people coming back. These reverse an earlier anti-goal by decision of the founder: there is now a small server-side store, and some usage is counted.

**There are no free real questions.** A free tier was built and then removed before it shipped, by decision of the founder: every free question costs real money, and there is no budget for that yet. Solving needs a plan or the learner's own key. The prepared demo stays free because it makes no model request. A test holds this: a visitor with neither cannot cause a request to a model. Do not bring free credit back without being asked.

**The path:** the question box on the home page → **Start**: a plan, their own key, or the demo → their question waiting in the box → solved, with stop and ask → the summary, with **Share this solution**. A shared link leads a new person to the same box.

### 30.1 The store

One Upstash Redis database over its REST API (`api/_lib/store.ts`), no client library. It holds counts, rate limits and shared links. It is optional, and needs no OpenRouter account: without it the site runs, and sharing and counting are off.

### 30.2 Shared solutions (`api/share.ts`, `src/growth/share.ts`, `src/ui/ShareBox.tsx`)

Pressing **Make a link** stores the plan, board, narration and notes, and nothing about the session or device. The link is `?s=<id>`, kept for six months, and **Stop sharing** removes it with a token only that browser holds. Figures made by `run_code` are not included; the board shows that the figure is no longer available. Uploads are never included. Limit: 200 KB, thirty links per network per day.

A shared record is untrusted input. It is opened through a replay, so every step passes the same tool bus and validator as a model's output, and it is never rendered on the server. Opening one costs the viewer nothing and is not saved to their history. Addresses are never stored: limits key on an HMAC of the address and the day.

### 30.3 Usage counts (`api/event.ts`, `api/stats.ts`, `src/growth/track.ts`)

A word from the fixed list in `shared/events.ts` and a random id made in the browser. The id goes only into HyperLogLog counters, which can count distinct ids but cannot give one back. No text, no address. A browser that sends Global Privacy Control or Do Not Track is not counted, nor is a development build. Each network is capped per day so a script cannot write the numbers.

`GET /api/stats` with `Authorization: Bearer $STATS_TOKEN` returns daily counts, daily active visitors, and weekly retention by first week. With no token set it answers nobody.

### 30.4 Not built

Exam mode, weak-spot memory and Urdu or Hindi explanations (recommended, deliberately held until real users ask). Email of any kind.
