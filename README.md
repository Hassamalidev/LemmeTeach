# Chalk

An agentic AI tutor that runs entirely in your browser. It plans a lesson, teaches it on an animated whiteboard while speaking, runs code to work things out, asks you questions and waits for real answers, changes course when you're lost, and remembers what you know between sessions.

No backend. No accounts. You bring your own API key, and it never leaves your browser.

[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-000)](https://vercel.com/new) [![Deploy to Netlify](https://img.shields.io/badge/Deploy-Netlify-00C7B7)](https://app.netlify.com/start) [![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020)](https://dash.cloudflare.com)

---

## Three steps

1. **Deploy it.** Connect this repo to Cloudflare Pages, Vercel or Netlify — build command `npm run build`, output directory `dist`. Or run `npx vercel --prod`. There are no environment variables to set, because there is nothing to configure.
2. **Open it.**
3. **Paste your key.** Anthropic, OpenAI, Gemini, OpenRouter, or any OpenAI-compatible endpoint including a local Ollama or LM Studio. Or press **Try it without a key** and a bundled lesson plays in full.

Then name a topic and it starts teaching.

---

## How it works

The interesting claim is "no backend", so here is exactly what happens when you press **Teach me**.

### The loop is code, the teaching is not

Four agents share one provider and one tool bus. Each is a system prompt, a tool allowlist and a budget:

| Agent | Does | Turns |
|---|---|---|
| Planner | Reads your record, checks your uploaded notes, writes the plan | 6 |
| Tutor | Teaches it, adapting as you answer | 40 |
| Examiner | A short check, then updates your record | 8 |
| Repairer | Fixes board operations that failed validation | 2 |

The orchestrator is a finite state machine, not another model. Model autonomy lives *inside* a phase; the transitions between phases are ordinary code:

```
IDLE → PLANNING → TEACHING ⇄ CHECKING → EXAMINING → REVIEW
           │          │  ▲        │
           │          ▼  │        ▼
           │      INTERRUPTED   REMEDIATING
           └──► ABORTED ◄── budget · error · you pressed stop
```

That split matters. When a check comes back under 80%, the runtime — not the model — decides that the next turn is remediation. A model asked to judge whether it should back up will almost always press on.

### Fifteen tools

The tutor is not asked to produce a lesson. It is handed a whiteboard, a code sandbox, your learner record and a voice, and asked to teach. The lesson is whatever the trace of tool calls turns out to be.

`teach_step` · `ask_learner` · `check_understanding` · `run_code` · `compute` · `search_materials` · `wiki_lookup` · `recall_learner` · `update_learner` · `save_note` · `schedule_review` · `plan_lesson` · `end_lesson` · `finish_exam` · `fix_board`

Two of them suspend the loop and genuinely wait for you. There is no timeout and no fabricated answer — the tab can sit on a question for an hour.

### The board

The model never writes SVG, HTML or a coordinate. It emits operations — `derive`, `plot`, `diagram`, `reaction`, `vectors`, `code`, and seven more — and the renderer owns every pixel. There is no `x` field anywhere, because models are unreliable at positions and reliable at describing structure.

Everything is validated before it is drawn. A rejected operation comes back to the model with the offending field named, which it can repair on its next turn; two failures escalate to a cheap repair pass; if that fails too, the drawing is dropped and the narration still reaches you.

### Where the key goes

Straight from your browser to the provider you chose, over HTTPS, and nowhere else. Chalk has no server, so there is no other destination available to it. The key is never written into a saved lesson, a trace export, a log line or a URL — [asserted by test](src/storage/keys.test.ts).

A `<meta>` Content-Security-Policy restricts `connect-src` to the provider hosts, the Wikipedia API, the Pyodide CDN, and whatever custom endpoint you configured. Nothing else can be reached from the page.

Anthropic requires a header named `anthropic-dangerous-direct-browser-access` for browser requests. "Dangerous" there refers to a site shipping *its own* key in client code, where every visitor spends the owner's money. Here the key is yours and stays on your machine, which is the case that header exists for.

### Code execution

`run_code` runs in a sandboxed iframe on an opaque origin — no access to the page's storage, DOM or your key — which itself hosts a Web Worker so a runaway loop can be terminated rather than freezing the tab. Network globals are removed inside the worker before your code runs. Ten-second timeout. JavaScript starts instantly; Python loads Pyodide on first use, with `numpy`, `sympy`, `scipy`, `matplotlib` and `pandas` available.

Matplotlib figures are captured and land on the board as a `figure` operation.

### What it remembers

Concept records in IndexedDB, on your device, and nowhere else. Mastery decays with time and blends new evidence in weighted by confidence, so one lucky answer cannot mark something mastered and one slip cannot erase a month of work. Misconceptions are recorded in your own terms, so a later lesson can catch one with a single example.

All of it is visible and editable under **What I know**, with per-concept reset, whole-record export, and a one-action erase. A hidden profile that shapes the teaching without being inspectable would be the wrong thing to build.

### It degrades rather than dying

| Rung | When | What you still get |
|---|---|---|
| Full | — | Everything |
| No sandbox | Pyodide blocked | Everything but running code; the tutor is told, so it never offers |
| No voice | No speech synthesis, or muted | Timed reveals plus the transcript panel |
| Scripted | The model can't use tools reliably | One call, a straight lesson, clearly labelled as reduced |
| Replay | No key, no network | Bundled lessons play in full |

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # the whole suite, no key and no network needed
npm run build        # static files in dist/
```

Optional:

```bash
npm run vendor:fonts     # self-host the two typefaces (recommended)
npm run vendor:pyodide   # ~10 MB, for offline or restricted networks
npm run record -- --subject=physics --topic="Projectile motion"
```

---

## Testing

The suite runs with no API key and no network. The mock adapter replays a lesson through the real runtime, the real tool bus, the real validator and the real page model, which makes it the main test surface rather than a smoke test.

It covers a clean lesson end to end, a failed check triggering remediation, an interruption mid-step, a sandbox timeout, budget exhaustion, an abort mid-turn, and every subject.

```bash
npm test
```

---

## Deploying

**Cloudflare Pages / Vercel / Netlify** — connect the repo. Build `npm run build`, output `dist`.

**GitHub Pages** — [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) is committed; enable Pages with "GitHub Actions" as the source and every push to `main` deploys. `base: './'` means it works from a subpath.

No environment variables at any point. A build that needs one has broken the point of the project.

---

## Known limitations

- **`file://` is not supported.** The build ships ES modules, which browsers refuse to load from a `file://` origin regardless of how the paths are written. Every http(s) path works, including a Pages subpath. A single-file IIFE build would be needed for genuine `file://` support.
- **The bundled lessons are authored, not recorded.** They are written in the exact shape a real session produces and are validated by the same code the tool bus uses, but recording real tapes needs a real key — see `npm run record`. Until tapes exist, replay mode says so.
- **Five subjects.** The board's thirteen operations are built for maths, physics, chemistry, computer science and biology. Music notation, maps and timelines would each need their own renderer.
- **English first.** Narration follows the language of the topic; right-to-left layout is not handled.

---

## Licence

MIT.
