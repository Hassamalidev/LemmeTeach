/**
 * Replaying a question that has already been solved (§18).
 *
 * The cheapest question is one that is not sent to a model at all. A solved
 * question is saved on the device with its plan, its board and its narration,
 * so asking the same thing again — or opening it from the history — plays it
 * back through the real session, board and voice at no cost: no request is
 * made and no tokens are used.
 *
 * This is an adapter like any other, so nothing above it knows the difference.
 * It answers each turn with what the model said the first time.
 */
import type { BoardOp } from '../board/op-schema';
import type { SolutionRecord } from '../storage/records';
import type { AgentEvent, AgentRequest, ModelInfo, ProviderAdapter } from './types';

interface SavedStep {
  say: string;
  ops: BoardOp[];
  objective?: string;
  /** True when this step began a fresh section of the board. */
  clear: boolean;
}

/** The steps of a saved solution, in the order they were written. */
export function savedSteps(record: SolutionRecord): SavedStep[] {
  const pages = Array.isArray(record.pages) ? (record.pages as { steps?: unknown[] }[]) : [];
  const out: SavedStep[] = [];
  pages.forEach((page, pageIndex) => {
    (page.steps ?? []).forEach((raw, i) => {
      const step = raw as { say?: unknown; ops?: unknown; objective?: unknown };
      if (typeof step.say !== 'string' || !Array.isArray(step.ops)) return;
      out.push({
        say: step.say,
        ops: step.ops as BoardOp[],
        objective: typeof step.objective === 'string' ? step.objective : undefined,
        clear: pageIndex > 0 && i === 0,
      });
    });
  });
  return out;
}

/** The ids of the figures a saved solution placed, so the board accepts them again. */
export function savedFigureIds(record: SolutionRecord): string[] {
  return savedSteps(record).flatMap((s) =>
    s.ops.flatMap((op) => (op.op === 'figure' ? [op.figureId] : [])),
  );
}

/** Whether a saved solution has enough in it to be worth replaying. */
export function canReplay(record: SolutionRecord): boolean {
  return savedSteps(record).length > 0;
}

const MODELS: ModelInfo[] = [{ id: 'replay', label: 'Replay', tools: true }];

export function replayAdapter(record: SolutionRecord): ProviderAdapter {
  const steps = savedSteps(record);

  return {
    id: 'mock',
    label: 'Replay',
    defaultModel: 'replay',
    keyPlaceholder: '',
    keyHelpUrl: '',
    keyHint: 'Plays back a question you have already had solved. Nothing is sent anywhere.',
    demo: true,
    supportsToolChoice: true,
    supportsParallelToolCalls: true,
    keyOptional: true,

    async models(): Promise<ModelInfo[]> {
      return MODELS;
    },

    async *run(req: AgentRequest, _cfg, signal): AsyncIterable<AgentEvent> {
      const offered = new Set(req.tools.map((t) => t.name));
      const turn = req.messages.filter((m) => m.role === 'assistant').length;
      let n = 0;
      const call = function* (name: string, input: unknown): Generator<AgentEvent> {
        const id = `replay_${name}_${turn}_${n++}`;
        yield { t: 'tool_start', id, name };
        yield { t: 'tool_end', id, input };
      };

      signal.throwIfAborted();
      // A breath between turns, so the session's own rhythm is the same as live.
      await new Promise((r) => setTimeout(r, 30));

      if (offered.has('plan_lesson')) {
        const plan = (record.plan ?? null) as Record<string, unknown> | null;
        if (plan) {
          const { id: _id, createdAt: _at, ...rest } = plan;
          yield* call('plan_lesson', rest);
        }
      } else if (turn < steps.length) {
        const step = steps[turn];
        if (step) {
          yield* call('teach_step', {
            say: step.say,
            board: step.ops,
            clear: step.clear,
            ...(step.objective ? { objective: step.objective } : {}),
          });
        }
      } else {
        for (const note of record.notes) {
          yield* call('save_note', { title: note.title, markdown: note.markdown, tags: note.tags });
        }
        yield* call('end_lesson', {
          summary: record.ending?.summary ?? 'That is the end of this solution.',
          objectivesMet: record.ending?.objectivesMet ?? [],
          objectivesMissed: record.ending?.objectivesMissed ?? [],
          nextTopics: record.ending?.nextTopics ?? [],
        });
      }

      // Nothing was sent and nothing was spent, and the meter says so.
      yield { t: 'usage', inputTokens: 0, outputTokens: 0, costUsd: 0 };
      yield { t: 'stop', reason: 'tool_use' };
    },
  };
}

/** Two questions are the same if they differ only in case, spacing or punctuation. */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}^*/+=<>.-]+/gu, ' ')
    // A full stop matters inside a number and nowhere else.
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A saved solution to this exact question, most recent first, if there is one. */
export function findSolved(question: string, history: SolutionRecord[]): SolutionRecord | null {
  const key = questionKey(question);
  if (key.length < 6) return null;
  return history.find((r) => questionKey(r.topic) === key && canReplay(r) && r.ending) ?? null;
}
