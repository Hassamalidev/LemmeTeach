# CLAUDE.md — Chalk

Build spec for **Chalk**: an agentic AI tutor that runs entirely in the browser. It plans a lesson, teaches it on an animated whiteboard while speaking, runs code to work things out, asks the learner questions and waits for real answers, changes course when the learner is lost, and remembers what they know between sessions.

Every agent, every tool, and every byte of memory lives client-side. The user brings their own API key. The deployed artifact is a folder of static files.

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
12. [Learner memory](#12-learner-memory)
13. [Materials and retrieval](#13-materials-and-retrieval)
14. [Voice and synchronization](#14-voice-and-synchronization)
15. [Screens and interaction](#15-screens-and-interaction)
16. [Design direction](#16-design-direction)
17. [Failure handling](#17-failure-handling)
18. [Budget and cost control](#18-budget-and-cost-control)
19. [Security and privacy](#19-security-and-privacy)
20. [Storage schema](#20-storage-schema)
21. [File layout](#21-file-layout)
22. [Testing and evaluation](#22-testing-and-evaluation)
23. [Build order](#23-build-order)
24. [Deployment](#24-deployment)
25. [Definition of done](#25-definition-of-done)
26. [Assumptions to confirm](#26-assumptions-to-confirm)

---

## 1. What this is

A learner opens the site, pastes an API key once, picks one of five subjects — Math, Physics, Chemistry, Computer Science, Biology — and names a topic. Then:

1. A **planner agent** reads what the learner already knows from local memory, checks any material they uploaded, and writes a lesson plan with objectives and prerequisites.
2. A **tutor agent** works through that plan in a loop. Each turn it decides what to do next: write on the board and narrate, run code to compute or simulate something, look a fact up, ask the learner a question and *wait* for the answer, or move on.
3. When the learner answers wrong, the tutor sees the answer as a tool result and adapts — backs up to a prerequisite, re-explains with a different representation, or slows down. This branching is the point of the whole system. A model that emits a fixed script is not a tutor; it is a video.
4. An **examiner agent** closes the lesson with a short check, updates the mastery record, and schedules a review.

The learner can raise a hand at any moment, which interrupts the loop with a real question. Everything is saved locally, so the next lesson starts from what actually stuck.

**The distinction that matters:** the model is not asked to produce a lesson. It is handed a whiteboard, a code sandbox, a learner record, and a voice, and asked to teach. The lesson is whatever the trace of tool calls turns out to be.

---

## 2. Hard constraints and anti-goals

| Constraint | Meaning |
|---|---|
| **No backend** | No server, no serverless function, no proxy, no hosted database, no queue. The build output is static files served from a CDN. |
| **BYOK** | The key is entered by the user, stored only in their browser, and sent only to the provider they chose. It reaches no other host, ever. |
| **Provider-agnostic** | Anthropic, OpenAI, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint including a local Ollama or LM Studio. |
| **Agentic** | A multi-turn tool-use loop with real branching. Not a prompt that returns a script. |
| **One-step deploy** | Connect the repo, or run one CLI command. Zero environment variables, zero configuration. |
| **Runs anywhere** | Any modern browser, desktop and mobile, at any URL path, including a GitHub Pages subpath and `file://`. |
| **Degrades, never dies** | Every capability has a defined fallback. A failed tool, a refused key, a browser without speech synthesis — none of these produce a blank screen. |

### Anti-goals

Do not build: accounts, login, a shared or embedded key, a CORS proxy, a telemetry pipeline, a payments flow, a general-purpose chatbot, cloud sync. Do not add a client-side router. Do not add a state management library. Do not reach for a backend to solve a problem this document already solves — every provider here supports direct browser calls (§5), code runs in a sandboxed frame (§11), and retrieval runs over IndexedDB (§13).

If you find yourself about to write "this needs a small server", stop and re-read the relevant section. If it genuinely does, raise it rather than building it.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER TAB   (everything below ships as static files)             │
│                                                                     │
│  ┌───────────────┐   turns    ┌──────────────────────────────────┐  │
│  │  Orchestrator │◄──────────►│  Agent runtime                   │  │
│  │  (phase FSM)  │            │  loop · budget · abort · retry   │  │
│  └───────┬───────┘            └───────┬──────────────────────────┘  │
│          │                            │ normalized messages + tools  │
│          │                            ▼                             │
│          │                    ┌───────────────┐   HTTPS             │
│          │                    │  Provider     │──────────────►  ☁   │
│          │                    │  adapters     │   user's key        │
│          │                    └───────┬───────┘                     │
│          │                            │ tool calls                  │
│          ▼                            ▼                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Tool bus —  validate → authorize → dispatch → result          │ │
│  ├─────────┬─────────┬──────────┬──────────┬─────────┬───────────┤ │
│  │ Board   │ Sandbox │ Learner  │ Library  │ Learner │ Wiki      │ │
│  │ writer  │ iframe  │ memory   │ IDB +    │ prompt  │ lookup    │ │
│  │         │ + worker│ (IDB)    │ BM25     │ (waits) │ (CORS)    │ │
│  └────┬────┴─────────┴──────────┴──────────┴────┬────┴───────────┘ │
│       │                                         │                   │
│       ▼                                         ▼                   │
│  ┌──────────────┐   reveal sync  ┌───────────────────────────────┐ │
│  │ Board render │◄──────────────►│ Speech (Web Speech API)       │ │
│  └──────────────┘                └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Layer rules.** The runtime knows nothing about teaching. The tools know nothing about which model called them. The board renderer knows nothing about agents — it takes board operations and draws them, and can be driven entirely from a fixture file. Keep these seams clean; they are what make the thing testable without a key.

### Phase state machine

The orchestrator is a finite state machine, not another model. Model autonomy lives *inside* a phase; transitions between phases are code.

```
        ┌──────────────────────────────────────────────┐
        ▼                                              │
IDLE → PLANNING → TEACHING ⇄ CHECKING → EXAMINING → REVIEW → IDLE
           │          │  ▲        │                     ▲
           │          ▼  │        ▼                     │
           │      INTERRUPTED   REMEDIATING ────────────┘
           │      (raise hand)
           └──► ABORTED ◄── budget exhausted · fatal error · user stop
```

- `PLANNING` — planner agent, ≤ 6 turns, ends when `plan_lesson` is called.
- `TEACHING` — tutor agent, ≤ 40 turns, ends on `end_lesson` or budget.
- `CHECKING` — entered when the tutor calls `check_understanding` or `ask_learner`; the loop suspends awaiting real human input, with no timeout.
- `REMEDIATING` — entered automatically when a check scores below the remediation threshold (§8.3). The tutor receives the wrong answers and is told to back up.
- `INTERRUPTED` — the learner raised a hand. Speech cancels, the question is injected as the next user message, `TEACHING` resumes.
- `EXAMINING` — examiner agent, ≤ 8 turns.
- `REVIEW` — no model calls. Notes, transcript, mastery diff, export.
- `ABORTED` — always reachable, always leaves the board readable with whatever was taught so far saved.

Every transition is written to the session trace (§22).

---

## 4. Stack

- **Vite + React 18 + TypeScript** — `strict: true`, `noUncheckedIndexedAccess: true`.
- **Tailwind CSS**.
- **KaTeX** — math typesetting.
- **mathjs** — expression evaluation for plots and the `compute` tool.
- **Shiki** — code highlighting on the board.
- **idb-keyval** — thin IndexedDB wrapper.
- **Pyodide** — loaded lazily, only on the first Python execution.
- **Zod** — runtime validation of every tool input and every persisted record. Non-negotiable: the model *will* send malformed arguments, and every one of them must be caught at the tool bus rather than deep inside the renderer.
- **Web Speech API** — voice. Built in, free, no key, no network.

No state library, no router, no component kit, no animation library. Anything else needs a justification in the commit message.

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

Mark the system prompt and tool definitions with `cache_control` — they are byte-identical on every turn of a lesson, and this is where most of the token spend would otherwise go.

Default `claude-sonnet-5`. Offer `claude-opus-5` for hard derivations and `claude-haiku-4-5-20251001` for cheap revision and for the repair pass (§17.3).

### 5.2 OpenAI

`POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer {key}`, `stream: true`, `stream_options: { include_usage: true }`. Tools as `[{ type: 'function', function: { name, description, parameters } }]`. Tool calls arrive in `choices[0].delta.tool_calls[]`, where `index` identifies the call, `id` and `function.name` appear on the first fragment, and `function.arguments` streams as a string that must be concatenated then parsed.

### 5.3 Google Gemini

`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={key}`. Tools as `[{ functionDeclarations: [{ name, description, parameters }] }]`.

Differences that will bite, all of which the adapter absorbs: roles are `user` and `model`; the system prompt goes in `systemInstruction`; results return as a `functionResponse` part; and the accepted JSON Schema subset is narrower than the others'. Run every tool schema through `narrowSchemaForGemini()`, which strips `$ref`, `oneOf`, `additionalProperties`, and unsupported `format` keywords.

### 5.4 OpenRouter

OpenAI-shaped at `https://openrouter.ai/api/v1`, plus `HTTP-Referer` and `X-Title` headers. Fetch the live model list from `/api/v1/models` and filter to models that advertise tool support. This is the adapter that lets a learner use any model without a code change, so surface that filter clearly rather than showing 300 models, most of which will fail on turn one.

### 5.5 Compatible

OpenAI wire format, user-supplied base URL: Groq, Together, DeepSeek, vLLM, Ollama (`http://localhost:11434/v1`), LM Studio. Warn on `http://` origins other than localhost. Many small local models handle tool calls badly — detect three consecutive turns with no valid tool call and offer to switch the session to **scripted mode** (§17.4).

### 5.6 Mock

Replays a recorded session tape from `src/fixtures/tapes/`, emitting the same `AgentEvent` sequence with realistic timing. No key, no network. The whole UI — board, voice, sandbox, memory, interruption — must be exercisable through the mock adapter. Every fixture is a *recorded* session, never hand-written fiction, so the UI is developed against output the models actually produce.

### 5.7 Key handling

- `localStorage` under `chalk.key.{providerId}`, or memory-only when the user ticks **Don't remember on this device**.
- Never logged, never placed in a URL, never included in an exception message, a trace export, or a saved lesson. Ship a unit test asserting the key string appears in no serialized artifact.
- Settings has **Forget key**: clears storage and reloads.
- A `<meta http-equiv="Content-Security-Policy">` whose `connect-src` allows only the provider hosts, the Wikipedia API, and the user's custom base URL.

---

## 6. Tool-call normalization

The internal message format every adapter converts to and from:

```ts
type AgentMessage =
  | { role: 'user';      content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool';      results: ToolResult[] };

interface ToolCall   { id: string; name: string; input: unknown }
interface ToolResult { id: string; name: string; ok: boolean; content: string }
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

---

## 7. The agent runtime

```ts
async function runAgent(cfg: AgentConfig, ctx: RunContext): Promise<AgentOutcome> {
  const messages = [...cfg.seedMessages];

  for (let turn = 0; turn < cfg.maxTurns; turn++) {
    ctx.budget.assertNotExhausted();
    ctx.signal.throwIfAborted();

    const { text, toolCalls, usage, stop } = await consume(
      provider.run({ ...cfg.request, messages: compact(messages, ctx) }, ctx.signal),
      ctx,
    );
    ctx.budget.add(usage);
    messages.push({ role: 'assistant', content: text, toolCalls });

    if (toolCalls.length === 0) return { reason: 'no_tool_call', messages };

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
- **Suspension.** `ask_learner` and `check_understanding` return a promise that resolves only when the human answers. The loop genuinely suspends; the tab can sit there for an hour. No timeout, and no fabricated answer, ever.
- **Parallel dispatch.** Tools declare `parallelSafe`. Safe ones (`compute`, `wiki_lookup`, `search_materials`, `recall_learner`) run under `Promise.all`. Anything touching the board, the learner, or persisted memory runs sequentially in the order the model emitted them, because order is meaning.
- **Validation at the bus.** Every input is parsed by its Zod schema. Failure returns `ok: false` with a message naming the offending field and the expected shape, and the loop continues so the model can repair its own call. Two consecutive validation failures on the same tool escalate to §17.3.
- **Authorization at the bus.** The access matrix in §8.1 is enforced here, not merely by which specs were sent.
- **Abort.** One `AbortController` per session. Aborting cancels the fetch, cancels speech, halts the sandbox, and freezes the board where it stands. The partial lesson is saved.
- **Trace.** Every event — turn boundary, text, tool call, tool result, phase transition, error, usage — appends to an in-memory trace, capped and exportable (§22).
- **Context growth.** Before each turn, if estimated tokens exceed 60% of the model's window, compact: keep the system prompt, the plan, and the last six turns verbatim, and replace everything older with a summary block the runtime generates *deterministically* from board history and mastery deltas. Do not spend a model call summarizing.

---

## 8. Agent roster

Four agents. Each is a system prompt plus a tool allowlist plus a budget. They share one provider and one tool bus.

| Agent | Phase | Max turns | Model preference | Terminal tool |
|---|---|---|---|---|
| Planner | `PLANNING` | 6 | fast | `plan_lesson` |
| Tutor | `TEACHING` | 40 | strong | `end_lesson` |
| Examiner | `EXAMINING` | 8 | fast | `finish_exam` |
| Repairer | any | 2 | cheapest | `fix_board` |

### 8.1 Tool access matrix

| Tool | Planner | Tutor | Examiner | Repairer |
|---|:--:|:--:|:--:|:--:|
| `recall_learner` | ● | ● | ● | |
| `search_materials` | ● | ● | | |
| `wiki_lookup` | ● | ● | | |
| `plan_lesson` | ● | | | |
| `teach_step` | | ● | | |
| `ask_learner` | | ● | ● | |
| `check_understanding` | | ● | ● | |
| `run_code` | | ● | | |
| `compute` | | ● | ● | |
| `update_learner` | | ● | ● | |
| `save_note` | | ● | | |
| `schedule_review` | | | ● | |
| `end_lesson` | | ● | | |
| `finish_exam` | | | ● | |
| `fix_board` | | | | ● |

### 8.2 Planner

Reads the learner record and any uploaded material, then writes a plan. It never teaches. Prompt requirements:

- Name 3–5 concrete objectives in the form "the learner can …", never "understand X".
- List prerequisites, and for each say whether the record shows it is already held. If a load-bearing prerequisite is missing, fold a short recap into the plan rather than assuming it.
- Choose a starting point that respects the record. Re-teaching something at mastery 0.9 wastes the learner's time and is the most common failure of systems like this.
- Sequence 5–9 steps, each with the representation it will use: derivation, diagram, simulation, worked example, trace.
- Estimate minutes honestly. Learners plan around it.

### 8.3 Tutor

The main loop. Prompt requirements:

- **Board and voice do different jobs.** `say` carries meaning and is read aloud, so it must be plain spoken language with no markup, no LaTeX, and no symbols a voice cannot pronounce — "d by d x", not `\frac{d}{dx}`. The board carries notation and structure. They complement; they never duplicate.
- **Show before generalizing.** A worked instance precedes the general rule, in every subject.
- **Check early.** First `check_understanding` no later than step 3. A check only at the end is a test, not teaching.
- **React to the answer.** A wrong answer is information about a specific misconception. Address that misconception; do not repeat the same explanation more slowly.
- **Use the sandbox when it earns its place.** Compute a value, run a simulation, sort a real list, integrate an ODE, verify a stoichiometry. Do not run code for arithmetic a person does in their head, and do not narrate the code — narrate the result.
- **Update the record as evidence appears**, not in a batch at the end.
- **One `teach_step` per turn.** Batching defeats interruption and reveal sync.

**Adaptation policy** — state this explicitly in the prompt, because left implicit the model always chooses to press on:

| Signal | Response |
|---|---|
| Check ≥ 80% | Continue; consider raising the level. |
| Check 40–79% | Re-explain that one point with a *different representation*, then re-check once. |
| Check < 40% | Back up to the prerequisite. If already at the prerequisite, drop a level and restart the objective. |
| Two failed checks on one objective | Stop teaching it. Say plainly what is blocking, teach the prerequisite instead, note it for next session. |
| Learner says "I don't know" | Never advance. Split the question into a smaller one. |
| Learner asks something off-plan | Answer in ≤ 2 steps, then return to the plan and say you are returning. |

### 8.4 Examiner

Five to eight questions drawn only from what the lesson actually covered — the examiner receives the board history and may not test anything absent from it. Mix recall, application, and one transfer question. Write mastery updates with evidence, schedule reviews, and give feedback that names the misconception rather than announcing right or wrong.

### 8.5 Repairer

Not a teacher. Invoked by the runtime, never by another agent, when board operations fail validation twice (§17.3). It receives the rejected operations plus the validator's complaint and returns corrected operations via `fix_board`. Cheapest model, tiny budget. If it fails, the step is dropped and its narration renders as plain text.

---

## 9. Tool catalog

Fifteen tools. Every one has a Zod schema in `src/tools/schemas.ts`, and the JSON Schema sent to the provider is *generated* from that Zod schema so the two can never drift.

Descriptions sent to the model are part of the product. Write them as instructions to a colleague: what the tool does, when to reach for it, when not to, and one concrete example. A vague description produces vague calls.

```ts
interface Tool<I, O> {
  name: string;
  description: string;               // model-facing, written with care
  schema: ZodType<I>;
  agents: AgentId[];                 // authorization
  parallelSafe: boolean;
  suspends: boolean;                 // waits on the human
  run(input: I, ctx: ToolContext): Promise<ToolOutcome<O>>;
}
```

### 9.1 `teach_step` — the primary tool

One narrated step with its board operations. Called once per turn.

```jsonc
{
  "say": "Plain spoken narration, 2 to 5 sentences. Read aloud verbatim by a speech engine, so no markdown, no LaTeX, no bullet characters, and no symbols. Write 'd by d x' not the notation. Carry the meaning here; put the notation on the board.",
  "board": [ /* board operations, §10 */ ],
  "clear": false,                      // true starts a fresh board page
  "objective": "obj-2",                // which plan objective this serves
  "pace": "normal"                     // "slow" | "normal" | "quick" — affects reveal timing
}
```

Returns `{ ok, opsRendered, page, boardFull }`. When `boardFull` is true, the next step must set `clear: true` — say so in the result string, because models otherwise keep writing off the bottom of the page.

### 9.2 `ask_learner` — suspends

Asks one question and waits. This is the tool that makes the system a tutor.

```jsonc
{
  "question": "Before we go on — what do you think happens to the current if I double the resistance?",
  "kind": "free",                      // "free" | "choice" | "confirm" | "number"
  "options": ["It doubles","It halves","No change","It depends"],  // required for "choice"
  "why": "Checking whether they've internalised the inverse relationship"  // shown in the trace, not to the learner
}
```

Returns `{ answer, elapsedMs, skipped }`. The learner can press **Skip** — `skipped: true` means they chose not to answer, which is not the same as being wrong, and the prompt says so.

### 9.3 `check_understanding` — suspends

Two to four questions at once, scored automatically.

```jsonc
{
  "questions": [
    { "q": "Which of these is conserved in an elastic collision?",
      "options": ["Momentum only","Kinetic energy only","Both","Neither"],
      "answer": 2,
      "why": "Elastic means kinetic energy is conserved as well as momentum.",
      "concept": "elastic-collision" }
  ],
  "onFail": "prerequisite:momentum-conservation"   // optional hint for remediation
}
```

Returns `{ score, perQuestion:[{ chosen, correct, concept }], summary }`. The runtime uses `score` to decide whether to enter `REMEDIATING` before the tutor's next turn — the branch is enforced in code, not left to the model's judgement.

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

Returns `{ ok, stdout, result, figures: [figureId], timedOut, error }`. Figures are stored in the session's figure store and placed on the board with the `figure` op. Truncate `stdout` to 2 KB. On error, return the exception text — the model is expected to fix and retry, twice at most.

### 9.5 `compute`

Fast mathjs evaluation. No sandbox, no Pyodide, milliseconds. Use for arithmetic, unit conversion, and symbolic simplification.

```jsonc
{ "expressions": ["9.81 * 2.5^2 / 2", "unit(3, 'eV') to 'J'"], "precision": 4 }
```

Returns `{ results: [{ expr, value, error? }] }`. `parallelSafe: true`.

### 9.6 `search_materials`

BM25 over the learner's uploaded documents (§13).

```jsonc
{ "query": "definition of activation energy", "k": 4, "docId": "doc_abc" }
```

Returns `{ hits: [{ docId, title, page, snippet, score }] }`. Snippets capped at 400 characters each. If no materials are loaded, returns `ok: true` with an empty list and a note — never an error, or the model wastes turns retrying.

### 9.7 `wiki_lookup`

The only network tool besides the model provider. Wikipedia's REST API sends permissive CORS headers, so this works with no backend:

- search — `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json&origin=*`
- summary — `https://en.wikipedia.org/api/rest_v1/page/summary/{title}`

```jsonc
{ "query": "Krebs cycle", "mode": "summary" }
```

Returns `{ title, extract, url }`, extract capped at 1200 characters. Off by default; a toggle in settings turns it on, because some learners will be on metered or restricted networks. The prompt tells the tutor to use it for dates, names, and constants — not for explanations, which are its own job.

### 9.8 `recall_learner`

```jsonc
{ "concepts": ["derivative","chain-rule"], "includeRecentLessons": true }
```

Returns the mastery record for those concepts plus known misconceptions, preferred pace, and the last three lesson titles. With no `concepts`, returns a compact profile summary rather than the whole record — the whole record can be large, and it is re-sent on every subsequent turn.

### 9.9 `update_learner`

```jsonc
{
  "updates": [
    { "concept": "chain-rule", "mastery": 0.7, "evidence": "Applied it correctly to sin(x^2) unprompted" },
    { "concept": "product-rule", "misconception": "Adds the derivatives instead of using the product form" }
  ]
}
```

Mastery is 0–1. The store applies the update through the decay-and-blend rule in §12.2 rather than overwriting, so a single lucky answer cannot jump a concept to mastered.

### 9.10 `save_note`

Appends a section to the lesson notebook, which the learner exports as Markdown.

```jsonc
{ "title": "Integration by parts", "markdown": "…", "tags": ["calculus"] }
```

Markdown here *may* use LaTeX and formatting — unlike `say`, this is read, not spoken.

### 9.11 `schedule_review`

```jsonc
{ "concept": "chain-rule", "dueInDays": 3, "reason": "Shaky on composite functions" }
```

Feeds the "Due for review" list on the home screen (§12.3).

### 9.12 `plan_lesson` — terminal for planner

```jsonc
{
  "title": "Integration by parts",
  "level": "undergrad",                       // "intro"|"school"|"undergrad"|"deep"
  "objectives": [{ "id": "obj-1", "text": "The learner can choose u and dv sensibly" }],
  "prerequisites": [{ "concept": "product-rule", "held": true, "recap": false }],
  "steps": [{ "objective": "obj-1", "representation": "derivation", "note": "Derive from the product rule" }],
  "estimatedMinutes": 12
}
```

### 9.13 `end_lesson` — terminal for tutor

```jsonc
{
  "summary": "…",
  "objectivesMet": ["obj-1","obj-2"],
  "objectivesMissed": ["obj-3"],
  "nextTopics": ["Reduction formulae"],
  "runExam": true
}
```

### 9.14 `finish_exam` — terminal for examiner

```jsonc
{ "score": 0.8, "strengths": ["…"], "gaps": ["…"], "verdict": "Ready to move on" }
```

### 9.15 `fix_board` — repairer only

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
- Board pages persist for the whole session — the learner can scroll back through everything written, which is the main advantage a whiteboard has over a video.

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

Each subject contributes a prompt fragment, preferred ops, an accent color, a starter topic tree, and worked examples of good board usage.

- **Math** — `derive`, `plot`. Show a concrete case before the general rule. Flag common errors with `annotate` + `warn`.
- **Physics** — `vectors`, `diagram`, plus `run_code` for simulation. Always name the system and its assumptions. Units on every quantity. Sanity-check magnitude at the end.
- **Chemistry** — `reaction`, `diagram`. Balance equations on the board one step at a time, never in a single jump. Say what the electrons are doing.
- **Computer Science** — `code` with `focus`, `diagram` for data structures, `table` for complexity, `run_code` to actually execute the example. Trace a small input by hand before running it.
- **Biology** — `diagram` with `cycle` and `flow`, `table` for comparisons. Structure first, then function, then structure explaining function.

---

## 11. Sandboxed code execution

Code runs in a **sandboxed iframe** (`sandbox="allow-scripts"`, `srcdoc`, therefore a null origin with no access to the app's storage or DOM), which itself hosts a Web Worker. The app talks to it over `postMessage`.

```
main thread ──postMessage──► iframe (null origin) ──► worker ──► Pyodide / JS eval
           ◄──result/figures/stdout────────────────────────────
```

### Rules

- **Timeout 10 s.** On expiry, terminate the worker and return `timedOut: true`. Never leave a runaway loop holding the tab.
- **Memory guard.** Fresh worker per execution beyond a size threshold; recycle the Pyodide instance across calls within a lesson, since cold start is 3–5 seconds.
- **No network from inside.** Override `fetch`, `XMLHttpRequest`, and `WebSocket` in the worker scope before user code runs. The `connect-src` CSP is a second layer, not the only one.
- **Lazy load.** Pyodide loads on first Python use, with visible progress on the board ("setting up Python, about 5 seconds"). JavaScript execution needs no load at all — prefer it for anything that does not need scientific libraries.
- **Packages.** Allow `numpy`, `sympy`, `scipy`, `matplotlib`, `pandas` via `micropip` from the Pyodide CDN. Anything else is refused with a message telling the model what is available.
- **Figures.** Patch matplotlib to a non-interactive backend, capture `savefig` to a PNG data URL, store under a `figureId`, return the id. The model places it with the `figure` op. Cap at 4 figures per lesson step.
- **Self-hosting option.** Pyodide from a CDN is the default; document a `npm run vendor:pyodide` script that copies it into `public/` for offline or restricted networks, and note that it adds roughly 10 MB to the deploy.
- **Determinism.** Seed `random` and `numpy.random` per lesson so a replayed tape produces the same figures.

Loading Pyodide from a CDN is the one external dependency at runtime besides the model API. If a network blocks it, `run_code` returns a clear failure and the tutor continues without it — teaching must never depend on the sandbox.

---

## 12. Learner memory

This is what makes a second session better than a first. It lives in IndexedDB and never leaves the device.

### 12.1 Records

```ts
interface LearnerProfile {
  id: 'default';
  createdAt: number;
  pace: 'slow' | 'normal' | 'quick';
  level: Record<SubjectId, Level>;
  voice?: { name: string; rate: number };
  totals: { lessons: number; minutes: number };
}

interface ConceptRecord {
  concept: string;                 // slug: 'chain-rule'
  subject: SubjectId;
  mastery: number;                 // 0..1
  confidence: number;              // 0..1, how much evidence supports the mastery figure
  lastSeen: number;
  timesSeen: number;
  misconceptions: { text: string; seen: number; resolved: boolean }[];
  evidence: { at: number; delta: number; note: string }[];   // last 10 only
  dueAt?: number;
}
```

### 12.2 Update rule

Never overwrite. Decay by time since last seen, then blend the new observation weighted by confidence:

```ts
const days = (now - rec.lastSeen) / 86_400_000;
const decayed = rec.mastery * Math.exp(-days / 30);      // ~30-day half-life-ish
const w = 0.25 + 0.35 * observationConfidence;           // 0.25..0.60
rec.mastery = clamp01(decayed * (1 - w) + observed * w);
rec.confidence = clamp01(rec.confidence * 0.9 + 0.2);
```

One lucky guess cannot mark a concept mastered; one slip cannot erase a month of work. Write the rationale in a comment, because someone will otherwise "simplify" it to an assignment.

### 12.3 Spaced review

`dueAt` follows a simple expanding schedule — 1, 3, 7, 16, 35 days — advancing on a passed review and resetting to the previous interval on a failure. The home screen shows **Due for review** with the concepts and a one-tap "review these" lesson that seeds the planner with them.

### 12.4 Visibility and control

The learner sees their own record: a per-subject concept list with mastery bars, misconceptions in plain language, and per-concept **Reset**. Plus a global **Export** (JSON), **Import**, and **Erase everything**. A hidden profile that shapes the teaching without being inspectable would be the wrong thing to build.

---

## 13. Materials and retrieval

Optional. The learner drops in their own notes, a syllabus, a past paper, or a textbook chapter, and the agents can search it.

- **Ingest** — `.txt`, `.md`, `.pdf` (via `pdf.js`, already a browser library), and pasted text. Everything happens in a worker; a 300-page PDF must not freeze the UI.
- **Chunk** — roughly 800 characters with 100 of overlap, split on headings and paragraph boundaries, keeping page numbers so citations can say "page 42".
- **Index** — BM25 built in the browser and stored in IndexedDB. Deliberately not embeddings: embeddings need either an API call per chunk (cost, latency, a second key) or a 25 MB model download. BM25 over a personal 40-page document is good enough and instant.
- **Optional upgrade** — a settings toggle for local embeddings via `transformers.js` with `all-MiniLM-L6-v2`, downloaded once and cached. Hybrid score = 0.5 BM25 + 0.5 cosine. Build this only after everything else works.
- **Grounding** — when materials exist, the planner prompt says to prefer the learner's own notation and terminology, and to teach the syllabus's framing rather than a generic one. This is the feature that makes it useful for an actual course.
- **Limits** — 20 MB total, 10 documents, oldest evicted with a warning.

---

## 14. Voice and synchronization

- `speechSynthesis.speak(new SpeechSynthesisUtterance(step.say))`.
- Board ops for a step reveal across the duration of that step's narration. Use the `boundary` event to advance reveals at word boundaries; fall back to an estimated words-per-minute timer where `boundary` never fires (Safari is unreliable, and some Android voices fire it once).
- Voices come from `getVoices()`, which on Chrome is empty until `voiceschanged` fires — wait for it. Remember the choice. Prefer a local voice matching the UI language.
- Rate control 0.75×–1.5× applies to speech and to reveal timing together.
- **Muted mode must be fully usable.** With voice off, the board advances on a timer sized to the narration length and the transcript panel shows the `say` text. Anyone in a library, or on a browser without speech synthesis, gets the entire lesson.
- Speech stops on pause, on step change, on interruption, on abort, and on unmount. Call `speechSynthesis.cancel()` in every cleanup path — queued utterances talking over each other is the single most common bug in this design, and it is not subtle.
- Chrome cuts long utterances after roughly 15 seconds when the tab is backgrounded. Split `say` into sentence-level utterances and queue them; this also gives finer reveal sync.
- Respect `prefers-reduced-motion`: reveals become instant, drawing animation is skipped, narration is unaffected.

---

## 15. Screens and interaction

No router. One page, five states in React state — which is what keeps it working on a GitHub Pages subpath and from `file://`.

1. **Setup** — provider picker, key field, model field, link to where to get a key, and **Try it without a key** (mock adapter). One line about where the key is stored.
2. **Home** — five subject cards, **Due for review**, recent lessons, materials.
3. **Topic** — starter tree for the subject plus free text ("or ask for anything"), level selector, and a **What I know** peek at the relevant concept records.
4. **Board** — the lesson. Board fills the screen; a thin rail holds the plan with the current objective marked, and the transport controls: play/pause, previous/next step, replay step, rate, voice, mute, transcript, **Raise hand**, **Stop**.
5. **Review** — exam result, mastery diff (what moved, and why), notes with **Copy as Markdown** and **Download**, **Save lesson**, and **Export trace** for debugging.

### Agent visibility

The learner should be able to tell what the system is doing without being shown a wall of JSON. A single status line above the board, in plain language: "planning the lesson", "working that out in Python", "checking your notes on page 42". A collapsible **Details** drawer shows the real trace — turn number, tool calls, arguments, results, token usage — for anyone who wants it. Never surface raw tool JSON in the main view, and never hide a failure inside a spinner.

### Raise hand

The interruption path, and the feature that makes this feel like a tutor:

1. Learner presses the button or `H`. Speech cancels immediately; the board freezes.
2. A small input appears over the board. Voice input via `SpeechRecognition` where available, silently absent where not.
3. The question is injected as the next user message with the current board page and step id attached as context.
4. `TEACHING` resumes. The tutor prompt says: answer in at most two steps, mark them as an aside, then return to the plan and say you are returning.
5. Interruptions count toward the turn budget, and the learner can see that in the budget meter.

### Keyboard

`Space` pause/resume · `←` `→` step · `R` replay step · `H` raise hand · `M` mute · `?` shortcuts · `Esc` stop. All controls reachable by tab, with visible focus.

---

## 16. Design direction

The board is the product. Everything else is a thin rail around it.

**Surfaces.** Two board themes, toggleable, both grounded in real classroom surfaces rather than generic app chrome:

- *Slate* (default) — deep green-black board `#122019`, chalk `#F2EFE6`, slightly dusty stroke edges.
- *Paper* — warm white `#FBFAF7`, ink `#1A2233`, faint ruled grid.

App chrome is a neutral `#0E1113` rail. The board never sits inside a rounded card with a drop shadow.

**Subject accents**, one each, used for headings, the active rail item, and `key` boxes: math `#4C6EF5`, physics `#E8590C`, chemistry `#0CA678`, computer science `#7048E8`, biology `#C2255C`.

**Type.** Atkinson Hyperlegible Next for board text and UI — it was designed for low-vision readability, which is the right argument for a teaching tool, and it does not look like every other site. IBM Plex Mono for code and data labels. KaTeX keeps its own fonts. One scale used consistently: 48 / 32 / 24 / 18 / 15.

**Motion.** Content is *written*, not faded in: text reveals left to right, strokes draw along their path, diagram edges extend from source to target. That drawing motion is the one place to spend effort. Everywhere else — panels, menus, buttons — motion only confirms an action. No hover animation on cards, no staggered page-load entrances.

**Copy.** Sentence case, active voice, no exclamation marks. Buttons name what happens: **Teach me**, **Raise hand**, **Forget key**. The empty topic screen invites a topic rather than describing the feature. Errors say what failed and what to do — "Anthropic rejected that key. Check it in Settings." not "An error occurred."

**Agent status, not agent theatre.** No fake typing indicators, no "thinking…" with animated dots pretending at depth. The status line says what is actually happening, and it is accurate because it is driven by real phase transitions.

Quality floor, unannounced: responsive to 360px, visible keyboard focus, `prefers-reduced-motion` honored, contrast ≥ 4.5:1 on both board themes, full keyboard control, no layout shift when the board paginates.

---

## 17. Failure handling

An agent loop has more failure modes than a request-response app, and every one of them will happen in front of a learner. Build the table below into `src/runtime/errors.ts` as a real error taxonomy, not scattered try/catch.

### 17.1 Error taxonomy

| Class | Cause | Handling |
|---|---|---|
| `AuthError` | 401/403, bad key | Stop. Return to Setup with the field focused and a specific message. Do not retry. |
| `RateLimitError` | 429 | Exponential backoff with jitter, 3 attempts, honoring `retry-after`. Show "the provider is rate-limiting us, retrying in 4 s". |
| `OverloadedError` | 529 / 503 | Same backoff. After 3 failures, offer to switch model. |
| `NetworkError` | offline, DNS, CORS | Distinguish offline (`navigator.onLine`) from CORS. A CORS failure on Anthropic almost always means the header is missing — assert it in a test. |
| `ContextError` | context window exceeded | Force a compaction pass and retry once. If it recurs, end the lesson gracefully with `end_lesson` semantics. |
| `SchemaError` | tool args fail Zod | Return `ok:false` to the model with the field named. Not fatal. |
| `ToolError` | tool ran and failed | Return the error text. The model retries or routes around it. |
| `SandboxError` | timeout, crash, blocked CDN | Return clearly; teaching continues without the sandbox. |
| `RefusalError` | model declines | Surface plainly, offer to rephrase the topic. Do not retry silently. |
| `BudgetError` | token or turn budget hit | Graceful close: summarize what was covered, save, offer to continue. |
| `LoopError` | no progress detected | §17.3. |

### 17.2 Truncation

`stop: 'max_tokens'` in the middle of a tool call yields unparseable arguments. Do not send the fragment back. Discard the partial assistant turn, append a user message saying the previous turn was cut off and to send a smaller `teach_step`, and retry once. Twice in a row means the model is producing oversized steps — halve `max_tokens` for board ops and note it in the trace.

### 17.3 Loop and repair

Detect no-progress conditions and act on them rather than burning the budget:

- **Repeated tool call** — same tool, same arguments hash, three turns running. Inject a user message naming the repetition and asking for a different approach.
- **No tool call** — the model returns only prose twice in a row. Re-send with `toolChoice: 'required'`.
- **Board validation failure** — two failures on the same step escalates to the repairer agent (§8.5); if that fails, drop the ops and render `say` as plain text. The learner still gets the explanation.
- **Objective thrash** — the tutor bounces between objectives four times without a `check_understanding`. Force a check.

### 17.4 Degradation ladder

Each rung is a real, tested mode, not a hypothetical:

1. **Full** — everything above.
2. **No sandbox** — Pyodide blocked or failed. `run_code` unavailable, tutor told so in the system prompt. Everything else works.
3. **No voice** — speech synthesis missing or muted. Timed reveals plus transcript.
4. **Scripted mode** — the model cannot use tools reliably (small local models). One call, NDJSON lesson script, no branching, no interruption. Clearly labelled in the UI as the reduced mode, because the difference matters.
5. **Replay** — no key or no network. Bundled fixture lessons play in full. This is also the demo mode on the landing page.

### 17.5 What is never acceptable

- Fabricating a learner's answer to keep the loop moving.
- A spinner with no explanation for longer than 3 seconds.
- Losing a lesson in progress on any error.
- Showing a raw stack trace or raw tool JSON in the main view.
- Silently dropping a board operation without telling the model it was dropped.

---

## 18. Budget and cost control

The learner is paying per token, so the app is accountable for every call.

- **Live meter** in the rail: turns used out of the phase limit, tokens in and out, estimated cost. Cost uses a static price table in `src/providers/pricing.ts`, clearly labelled as an estimate, and shows nothing rather than a wrong number when a model is unknown.
- **Per-lesson budget** set in settings — default 120k input / 30k output tokens. On 80%, the tutor is told to start wrapping up. On 100%, the runtime forces `end_lesson`. A lesson never dies mid-sentence because of a budget.
- **Prompt caching** on Anthropic for the system prompt and tool definitions, which are identical across every turn.
- **Result discipline** — small tool results, truncated aggressively, and a deterministic compaction pass rather than a summarizer model call.
- **Model split** — planner and examiner default to the fast model, tutor to the strong one, repairer to the cheapest. All overridable.
- **First-run estimate** — before the first lesson, show a plain sentence: a typical 12-minute lesson costs roughly X on the selected model. Nobody should discover the cost from their provider dashboard.

---

## 19. Security and privacy

- The key is the user's, stored in their browser, sent only to the endpoint they configured. Say so once, plainly, at setup.
- CSP `connect-src` allowlists the provider hosts, the Wikipedia API, the Pyodide CDN, and the user's custom base URL. Nothing else.
- The sandbox is a null-origin iframe with network globals removed inside the worker (§11).
- No analytics, no error reporting service, no fonts loaded from a third party — self-host the two typefaces.
- Uploaded materials never leave the browser except as retrieved snippets inside prompts the user's own key is paying for. State this on the upload screen.
- Trace exports are scrubbed: no key, no raw material text beyond the snippets already sent.
- `rel="noopener noreferrer"` on every external link.
- The learner record is portable and erasable, from the UI, in one action, without a confirmation maze.

---

## 20. Storage schema

`localStorage` — small, synchronous, needed at boot:

| Key | Contents |
|---|---|
| `chalk.key.{provider}` | API key, unless memory-only |
| `chalk.settings` | provider, model, theme, rate, voice, toggles, budget |
| `chalk.schema` | schema version integer |

IndexedDB (`chalk`) — everything else:

| Store | Key | Value |
|---|---|---|
| `profile` | `'default'` | `LearnerProfile` |
| `concepts` | concept slug | `ConceptRecord` |
| `lessons` | lesson id | plan, board pages, transcript, exam result, timestamps |
| `materials` | doc id | title, pages, chunks, BM25 postings |
| `figures` | figure id | PNG data URL, lesson id |
| `tapes` | tape id | recorded `AgentEvent` sequence (dev only) |

Migrations are explicit and versioned in `src/storage/migrate.ts`. Never wipe on a version bump; write a migration or leave the record untouched. Caps: 25 lessons, 10 materials, 20 MB total — evict oldest with a warning, never silently.

---

## 21. File layout

```
chalk/
  index.html                       # CSP meta, font preload
  vite.config.ts                   # base: './'
  public/
    fonts/                         # self-hosted, no third-party font CDN
  src/
    main.tsx
    App.tsx                        # screen state, no router
    orchestrator/
      machine.ts                   # phase FSM (§3)
      session.ts                   # session lifecycle, abort, persistence
    runtime/
      loop.ts                      # runAgent (§7)
      budget.ts
      compact.ts                   # deterministic context compaction
      errors.ts                    # taxonomy (§17.1)
      trace.ts
    providers/
      index.ts  anthropic.ts  openai.ts  gemini.ts  openrouter.ts  compatible.ts  mock.ts
      normalize.ts                 # §6 conversions, both directions
      schema-narrow.ts             # Gemini JSON Schema subset
      models.ts  pricing.ts  keys.ts
    agents/
      planner.ts  tutor.ts  examiner.ts  repairer.ts
      prompts/
        base.ts  policy.ts
        math.ts  physics.ts  chemistry.ts  cs.ts  biology.ts
    tools/
      index.ts                     # registry, authorization, dispatch
      schemas.ts                   # Zod → JSON Schema, single source
      teach-step.ts  ask-learner.ts  check-understanding.ts  run-code.ts
      compute.ts  search-materials.ts  wiki-lookup.ts
      learner.ts  notes.ts  lifecycle.ts
    board/
      Board.tsx  page.ts  layout.ts  validate.ts  themes.ts  reveal.ts
      ops/                         # one component per op, thirteen files
    sandbox/
      host.ts                      # iframe + postMessage bridge
      frame.html                   # srcdoc contents
      worker.ts                    # Pyodide / JS execution
    memory/
      profile.ts  concepts.ts  scheduling.ts
    materials/
      ingest.worker.ts  chunk.ts  bm25.ts  embed.optional.ts
    voice/
      speech.ts  recognition.ts
    ui/
      rail/  controls/  settings/  transcript/  status/  quiz/  meter/
    storage/
      db.ts  migrate.ts
    fixtures/
      tapes/                       # recorded sessions, one per subject
      lessons/                     # NDJSON scripts for replay mode
  .github/workflows/deploy.yml
  README.md
```

---

## 22. Testing and evaluation

### Unit

Provider normalization both directions for all five real adapters, against captured raw responses in `src/providers/__fixtures__/`. Zod schemas accepting good input and rejecting each documented bad case. Board validation, every rule in §10.3. Mastery update maths, including decay across simulated months. BM25 ranking. NDJSON and partial-JSON parsers on truncated, fenced, and interleaved input.

### Integration, no network

The mock adapter replays tapes through the real runtime, the real tool bus, and the real renderer. This is the main test surface. Cover: a clean lesson end to end; a lesson where a check fails and remediation triggers; an interruption mid-step; a sandbox timeout; a truncated tool call; a budget exhaustion; an abort mid-turn.

### Recording

`npm run record -- --subject=physics --topic="…"` runs a real session with a real key and writes a tape. Tapes are committed. Re-record whenever prompts change materially — a stale tape that no longer resembles model output is worse than no tape.

### Evaluation

`evals/` holds 25 topics, five per subject, spanning easy to hard. A run produces, per topic: turns used, tokens, wall time, board validation failure rate, tool error rate, checks asked, and whether remediation triggered when it should have. A judge model — the user's own key, opt-in, never in CI — scores the board against a rubric: correctness, does the board carry notation rather than repeating the narration, worked example before generalization, at least one check before step 4.

Track the numbers across prompt changes. Prompt work without measurement is guessing, and §8 has enough behavioural requirements that regressions are easy to miss.

### Accessibility

Automated axe pass on every screen. Manual keyboard-only run through a whole lesson. Screen reader pass on the board with the transcript panel open.

---

## 23. Build order

Each milestone ships working before the next begins. Milestones 1–4 need no API key at all.

- **M1 — Contracts.** Types for board ops, tools, messages, records. Zod schemas. Board validator. Three recorded-shape fixture lessons. Tests.
- **M2 — Board renderer.** All thirteen ops, both themes, diagram layout, pagination, responsive down to 360px. Driven purely by fixtures. *This milestone decides whether the product looks composed or broken — do not rush it.*
- **M3 — Playback and voice.** Reveal engine, transport controls, keyboard shortcuts, speech with boundary sync, muted mode, clean teardown on every path.
- **M4 — Runtime and mock.** Agent loop, tool bus with validation and authorization, budget, abort, trace, mock adapter replaying tapes. The whole experience now works with no key.
- **M5 — Providers.** Anthropic first, then OpenAI, Gemini, OpenRouter, compatible. Normalization tests against captured responses. Setup screen and key vault. Real streaming into the live board.
- **M6 — Agents and prompts.** Planner, tutor, examiner, repairer. Five subject packs. Iterate against real topics until boards are consistently good; expect several rounds, and treat a weak board as a prompt bug rather than a model limitation.
- **M7 — Interaction.** `ask_learner`, `check_understanding`, the remediation branch, raise hand, exam, notes.
- **M8 — Sandbox.** Iframe host, worker, JS execution first, then Pyodide, then figures on the board.
- **M9 — Memory.** Profile, concept records, update rule, spaced review, the visible **What I know** screen, export and erase.
- **M10 — Materials.** Ingest worker, chunking, BM25, `search_materials`, grounding in the planner prompt.
- **M11 — Hardening.** Full error taxonomy, degradation ladder rungs 2–5, cost meter, evals, accessibility pass.
- **M12 — Ship.** Deploy workflow, README, demo tape on the landing page, final pass.

---

## 24. Deployment

Static output in `dist/`. Set `base: './'` in `vite.config.ts` so it works at any path. No environment variables at any point — a build that requires one has broken a hard constraint.

**Cloudflare Pages / Vercel / Netlify** — connect the repo, build command `npm run build`, output directory `dist`. Or one command: `npx vercel --prod`.

**GitHub Pages** — commit this and every push to `main` deploys:

```yaml
name: deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps: [{ uses: actions/deploy-pages@v4 }]
```

**Offline / PWA** — a service worker caching the app shell, fonts, and fixture lessons. Already-generated lessons replay offline; new ones need the provider. Optional, and last.

**README** — one-line description, deploy button row, then three numbered steps: deploy, open, paste your key. A demo GIF of the board drawing itself. Nothing else above the fold. A **How it works** section below covering the agent loop and the tool list, because "no backend" is the interesting claim and people will want to check it.

---

## 25. Definition of done

**Product**

- [ ] A learner with a fresh key gets a planned, spoken, drawn, adaptive lesson within 60 seconds of landing, having read no instructions.
- [ ] The tutor asks a real question before step 4 and visibly changes course when the answer is wrong.
- [ ] Raising a hand interrupts within 300 ms and resumes without restarting.
- [ ] `run_code` produces a figure that lands on the board inside a normal lesson.
- [ ] A second lesson on a related topic demonstrably uses what the first one recorded.
- [ ] Every board op renders correctly at 360px and at 2560px.
- [ ] The entire product works with the mock adapter and no key.
- [ ] The entire product works with voice muted.

**Engineering**

- [ ] No provider name appears in a conditional above the adapter layer.
- [ ] Every tool input is validated; a malformed call is a recoverable turn, never a crash.
- [ ] Every error class in §17.1 has a test and a user-visible message written for a human.
- [ ] All five degradation rungs are reachable and tested.
- [ ] Aborting or closing the tab leaves no speech playing, no worker running, and no lost lesson.
- [ ] The key appears in no trace export, no saved lesson, no log line, and no URL — asserted by test.
- [ ] Deploy is: connect repo → done. No env vars, no config, no manual step.

---

## 26. Assumptions to confirm

These were chosen to satisfy the constraints in §2. Say so if any should change.

1. **Web Speech API for voice**, not a paid TTS: free, offline, no second key, at the cost of voice quality. An ElevenLabs or OpenAI-TTS adapter behind the same `speech.ts` interface is a natural later addition and would need a second key.
2. **BM25 rather than embeddings** for materials, for the reasons in §13. The embedding path is specified but deferred.
3. **Five fixed subjects**, open-ended topics within each. The board ops are built for these five; music notation, geography maps, or history timelines would each need their own renderer, so "every subject" is honestly bounded by what the board can draw.
4. **One local learner profile**, not per-user accounts. Shared-device households would need a profile switcher — small to add, unspecified for now.
5. **English UI first**; narration follows the language of the topic. Right-to-left layout is not handled.
6. **Wikipedia as the only external knowledge source**, because its API sends permissive CORS headers and needs no key. Any other source would need a proxy, which §2 forbids.
7. **Pyodide from a CDN** by default, with a vendoring script for restricted networks.
