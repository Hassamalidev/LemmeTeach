/**
 * Scripted mode — rung 4 of the degradation ladder (§17.4).
 *
 * Some small local models cannot use tools reliably. Rather than letting a
 * learner watch three turns of malformed JSON burn their evening, the session
 * offers to switch to one call that returns the whole lesson as NDJSON.
 *
 * This is a genuinely reduced mode and it is labelled as one in the UI. There
 * is no branching, no interruption and no checking, because there is no loop —
 * the difference between this and the real thing is the entire point of the
 * product, so it must never be presented as equivalent.
 */
import type { BoardOp } from '../board/op-schema';
import { validateOps } from '../board/validate';
import { z } from 'zod';

/**
 * The board is deliberately `unknown[]` here rather than the op union.
 *
 * Validating the operations as part of the line would make one bad operation
 * reject the whole step, taking the narration down with it — and in scripted
 * mode there is no loop to send a correction back through. The operations are
 * validated separately below, so a bad drawing costs the drawing and nothing
 * else (§17.3).
 */
export const ScriptedStep = z.object({
  say: z.string().min(1).max(1200),
  board: z.array(z.unknown()).max(12).default([]),
  clear: z.boolean().optional(),
});

export type ScriptedStepIn = z.infer<typeof ScriptedStep>;

export interface ScriptedLesson {
  title: string;
  steps: { say: string; ops: BoardOp[]; clear: boolean }[];
  /** Lines that could not be parsed, kept so the trace can say what was lost. */
  dropped: string[];
}

/**
 * The prompt for the single call. It asks for NDJSON rather than one JSON
 * document because a truncated NDJSON stream still yields every complete line
 * before the cut, where a truncated JSON array yields nothing at all — and
 * truncation is exactly what small models do.
 */
export function scriptedPrompt(topic: string, boardContract: string): string {
  return `Teach a short lesson on: ${topic}

Reply with NDJSON — one JSON object per line, nothing else. No prose before or after, no markdown fences, no commentary.

Each line is one step:

{"say":"plain spoken narration, 2 to 4 sentences","board":[ ...operations... ]}

"say" is read aloud by a speech engine: plain spoken language only, no notation, no markdown, no symbols. Say "d by d x" rather than writing it.

Eight to twelve lines. Start with a concrete worked example before any general rule.

${boardContract}`;
}

/**
 * Tolerant NDJSON parsing. Fenced blocks, leading prose, blank lines and a
 * final truncated line are all normal output from a small model, and none of
 * them should cost the learner the whole lesson.
 */
export function parseScripted(raw: string, title: string): ScriptedLesson {
  const steps: ScriptedLesson['steps'] = [];
  const dropped: string[] = [];

  const body = raw
    .replace(/^[\s\S]*?```(?:json|ndjson)?\s*/i, (m) => (m.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/, '');

  for (const line of body.split('\n')) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed === '[' || trimmed === ']') continue;
    if (!trimmed.startsWith('{')) {
      dropped.push(trimmed.slice(0, 80));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      dropped.push(trimmed.slice(0, 80));
      continue;
    }

    const shape = ScriptedStep.safeParse(parsed);
    if (!shape.success) {
      dropped.push(trimmed.slice(0, 80));
      continue;
    }

    // The board contract still applies: a step whose operations fail
    // validation keeps its narration and loses only the drawing.
    const check = validateOps(shape.data.board, {});
    steps.push({
      say: shape.data.say,
      ops: check.ok ? check.ops : [],
      clear: shape.data.clear ?? false,
    });
  }

  return { title, steps, dropped };
}

/**
 * Detects a model that cannot work the tool loop: three turns in a row with no
 * valid tool call (§5.5).
 */
export class ToolCapabilityWatch {
  private consecutiveFailures = 0;

  record(hadValidToolCall: boolean): void {
    this.consecutiveFailures = hadValidToolCall ? 0 : this.consecutiveFailures + 1;
  }

  get shouldOfferScriptedMode(): boolean {
    return this.consecutiveFailures >= 3;
  }

  reset(): void {
    this.consecutiveFailures = 0;
  }
}
