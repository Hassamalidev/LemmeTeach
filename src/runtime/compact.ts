/**
 * Context compaction (§7, §18).
 *
 * When the conversation approaches the model's window, older turns are
 * replaced by a summary block. The summary is generated *deterministically*
 * from what the runtime already knows — board history and mastery deltas —
 * rather than by spending a model call on it.
 *
 * That choice is about more than cost. A summarizer call is one more thing
 * that can fail, rate-limit, or hallucinate, in the middle of a lesson, at the
 * exact moment the session is already under pressure.
 */
import type { AgentMessage } from '../providers/types';
import { estimateTokens } from './budget';

/** Turns kept verbatim at the end of the window. */
export const KEEP_RECENT_TURNS = 6;
/** Compact once the estimate passes this fraction of the model's window. */
export const COMPACT_AT = 0.6;

export interface CompactContext {
  /** Model context window in tokens. */
  contextWindow: number;
  /** The plan, which is always kept verbatim — it is the spine of the lesson. */
  planSummary?: string;
  /** What is currently on the board, from BoardModel.historySummary(). */
  boardSummary?: string;
  /** Concept records touched this session, as "chain-rule: 0.4 → 0.7". */
  masteryDeltas?: string[];
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === 'user') n += estimateTokens(m.content);
    else if (m.role === 'assistant') {
      n += estimateTokens(m.content);
      for (const c of m.toolCalls) n += estimateTokens(JSON.stringify(c.input)) + 8;
    } else {
      for (const r of m.results) n += estimateTokens(r.content) + 8;
    }
  }
  return n;
}

export function needsCompaction(messages: AgentMessage[], ctx: CompactContext): boolean {
  return estimateMessagesTokens(messages) > ctx.contextWindow * COMPACT_AT;
}

/**
 * Keep the opening (which frames the lesson) and the last few turns, and
 * replace the middle with a deterministic summary.
 *
 * A "turn" here is an assistant message and the tool results that answered it,
 * so the pair is never split — a tool result whose call has been compacted
 * away is invalid on every provider.
 */
export function compact(messages: AgentMessage[], ctx: CompactContext): AgentMessage[] {
  if (!needsCompaction(messages, ctx)) return messages;

  const turns = groupTurns(messages);
  if (turns.length <= KEEP_RECENT_TURNS + 1) return messages;

  const opening = turns[0] ?? [];
  const recent = turns.slice(-KEEP_RECENT_TURNS);
  const dropped = turns.slice(1, turns.length - KEEP_RECENT_TURNS);

  const summary = buildSummary(dropped.flat(), ctx);

  return [...opening, { role: 'user', content: summary }, ...recent.flat()];
}

function groupTurns(messages: AgentMessage[]): AgentMessage[][] {
  const turns: AgentMessage[][] = [];
  let current: AgentMessage[] = [];

  for (const m of messages) {
    if (m.role === 'assistant' && current.length) {
      turns.push(current);
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length) turns.push(current);
  return turns;
}

function buildSummary(dropped: AgentMessage[], ctx: CompactContext): string {
  const lines: string[] = [
    '[Earlier turns of this lesson have been condensed to save context. What follows is a factual record, not a message from the learner.]',
  ];

  if (ctx.planSummary) lines.push('', 'The plan:', ctx.planSummary);

  if (ctx.boardSummary) {
    lines.push('', 'What is already on the board, in order:', ctx.boardSummary);
  }

  const questions = dropped.flatMap((m) =>
    m.role === 'tool'
      ? m.results.filter((r) => r.name === 'ask_learner' || r.name === 'check_understanding')
      : [],
  );
  if (questions.length) {
    lines.push('', 'What the learner said when asked:');
    for (const q of questions.slice(-6)) lines.push(`- ${q.content.slice(0, 300)}`);
  }

  if (ctx.masteryDeltas?.length) {
    lines.push('', 'Mastery recorded so far this lesson:');
    for (const d of ctx.masteryDeltas) lines.push(`- ${d}`);
  }

  lines.push(
    '',
    'Carry on from here. Do not re-teach anything already on the board, and do not greet the learner again.',
  );

  return lines.join('\n');
}
