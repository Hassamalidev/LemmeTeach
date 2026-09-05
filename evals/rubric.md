# Evaluation rubric

Two halves. The **mechanical** metrics are collected by the runtime and need no
judgement; the **judged** ones need a model, run with the user's own key, opt-in,
and never in CI (§22).

Track both across prompt changes. Prompt work without measurement is guessing,
and §8 has enough behavioural requirements that a regression is easy to miss —
a prompt edit that improves board layout while quietly halving the number of
questions asked would otherwise look like an improvement.

---

## Mechanical metrics

Collected per topic from the session trace. No model involved.

| Metric | Where it comes from | What a bad number means |
|---|---|---|
| `turnsUsed` | trace `turn` entries | Climbing over ~25 suggests the tutor is thrashing rather than teaching |
| `inputTokens` / `outputTokens` | trace `usage` entries | Input growing superlinearly means compaction is not working |
| `wallTimeMs` | first to last trace entry | |
| `boardFailureRate` | failed `teach_step` results ÷ all `teach_step` calls | Above ~5% means the board contract is not clear enough in the prompt |
| `toolErrorRate` | failed tool results ÷ all tool results | |
| `checksAsked` | `check_understanding` calls | Zero is a failure however good the board is |
| `firstCheckStep` | step index of the first check | Must be ≤ 3 (§8.3) |
| `remediationTriggered` | `REMEDIATING` in the phase trace | Should be true whenever a check scored below 80% |
| `remediationCorrect` | remediation happened **iff** a check scored < 80% | False means the branch is broken, which is the whole product |
| `repairEscalations` | repairer runs | Rising means board validation messages are not landing |

`remediationCorrect` is the single most important number here. Everything else
is quality; that one is whether this is a tutor or a video.

---

## Judged metrics

A judge model scores the board and transcript against the criteria below.
Score each 0–2: **0** absent, **1** partial, **2** clearly present.

### 1. Correctness

Is everything on the board and in the narration true? A single wrong constant,
misstated law, or invalid algebraic step scores 0 for the whole lesson — a
tutor that is confidently wrong is worse than no tutor.

### 2. The board carries notation, not narration

Does the board hold structure and notation that the speech could not carry,
rather than repeating the spoken sentences as written ones?

- **2** — board is equations, diagrams, tables, plots; narration is reasoning
- **1** — some duplication, or board text that is really narration
- **0** — the board is a transcript of what was said

### 3. A worked instance before the general rule

For each objective, does a concrete case appear before the abstraction?

- **2** — every general rule is preceded by an instance
- **1** — some are
- **0** — states rules and then gives examples, or gives no examples

### 4. A check before step four

Was `check_understanding` or `ask_learner` called by step 3?

- **2** — yes, and the wrong options are plausible misconceptions
- **1** — yes, but the distractors are filler nobody would pick
- **0** — no check until the end, or none at all

### 5. Adaptation

When an answer was wrong, did the next step address that specific belief?

- **2** — names the misconception and uses a *different* representation
- **1** — re-explains, but the same way as before
- **0** — carries on regardless, or repeats the same explanation more slowly

### 6. Spoken language

Is `say` pronounceable? No LaTeX, no markdown, no bare symbols.

- **2** — reads aloud cleanly throughout
- **1** — one or two lapses
- **0** — contains notation a voice cannot say

---

## Running

```bash
# Mechanical only, with the mock adapter — no key, no cost, runs in CI:
npm run eval

# With a real key, and the judged half enabled:
CHALK_EVAL_KEY=sk-… npm run eval -- --judge --provider=anthropic
```

Results land in `evals/results/<timestamp>.json`. Diff two runs to see what a
prompt change actually did.
