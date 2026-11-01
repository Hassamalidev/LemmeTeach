/**
 * The tool bus: validate → authorize → dispatch → result (§3, §7).
 *
 * Three things happen here that must not happen anywhere else.
 *
 * 1. Validation. Every input is parsed by its Zod schema before the tool sees
 *    it. The model *will* send malformed arguments, and a failure has to be a
 *    recoverable turn — `ok:false` naming the offending field — not an
 *    exception thrown deep inside the renderer.
 * 2. Authorization. The §8.1 access matrix is enforced here, not merely by
 *    which specs were sent to the model. Sending a smaller tool list is a hint;
 *    this is the rule.
 * 3. Parallelism. Tools declare `parallelSafe`. Safe ones run under
 *    Promise.all; anything touching the board, the learner, or persisted
 *    memory runs sequentially in the order the model emitted them, because
 *    for those, order is meaning.
 */
import type { ZodTypeAny } from 'zod';
import type { AgentId } from '../core/types';
import type { ToolCall, ToolResult, ToolSpec } from '../providers/types';
import { minifySchema, toJsonSchema } from './json-schema';
import type { JsonSchema } from '../providers/types';
import type { ToolContext } from './context';
import { asChalkError } from '../runtime/errors';
import { now } from '../core/types';

export interface ToolOutcome {
  ok: boolean;
  /** Structured payload; stringified for the model, kept small (§6). */
  data?: unknown;
  /** Human/model-facing message. On failure, says what to do differently. */
  message?: string;
}

export interface Tool {
  /**
   * Reshapes the generated schema before it is sent. Used where a schema
   * repeats something the system prompt already says in fewer tokens.
   */
  wire?: (schema: JsonSchema) => JsonSchema;
  /**
   * Puts right the unambiguous slips in a call before it is checked, and says
   * what was changed so the model writes it properly next time. A rejected
   * call costs a whole turn; a tidied one costs nothing.
   */
  prepare?: (input: unknown) => { input: unknown; notes: string[] };
  /** Adds to a rejection what the model needs to put it right. */
  explain?: (input: unknown, paths: (string | number)[][]) => string;
  name: string;
  description: string;
  schema: ZodTypeAny;
  agents: AgentId[];
  parallelSafe: boolean;
  suspends: boolean;
  run(input: never, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Terminal tools end their agent's loop when they succeed (§7). */
const keep = (schema: JsonSchema): JsonSchema => schema;

export const TERMINAL_TOOLS = new Set(['plan_lesson', 'end_lesson', 'finish_exam', 'fix_board']);

/** Results over this many bytes are truncated; every one is re-sent each turn. */
export const MAX_RESULT_BYTES = 2048;

export class ToolBus {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** The specs sent to the provider for one agent, generated from Zod (§9). */
  /**
   * The tool definitions sent to the model. Generated from the Zod schemas so
   * the two cannot drift, then cut down to what the model needs to read (§18).
   */
  specsFor(agent: AgentId, exclude: ReadonlySet<string> = new Set()): ToolSpec[] {
    const out: ToolSpec[] = [];
    for (const t of this.tools.values()) {
      if (!t.agents.includes(agent) || exclude.has(t.name)) continue;
      out.push({
        name: t.name,
        description: t.description,
        parameters: minifySchema((t.wire ?? keep)(toJsonSchema(t.schema))),
      });
    }
    return out;
  }

  async dispatch(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results = new Array<ToolResult>(calls.length);

    // Preserve the model's ordering in the results regardless of how they ran.
    const parallel: number[] = [];
    const sequential: number[] = [];
    calls.forEach((call, i) => {
      const tool = this.tools.get(call.name);
      (tool?.parallelSafe ? parallel : sequential).push(i);
    });

    await Promise.all(
      parallel.map(async (i) => {
        const call = calls[i];
        if (call) results[i] = await this.runOne(call, ctx);
      }),
    );

    for (const i of sequential) {
      const call = calls[i];
      if (!call) continue;
      results[i] = await this.runOne(call, ctx);
    }

    return results.filter((r): r is ToolResult => Boolean(r));
  }

  private async runOne(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const started = now();
    const tool = this.tools.get(call.name);

    ctx.trace.push({ t: 'tool_call', name: call.name, callId: call.id, input: call.input });

    const finish = (ok: boolean, content: string): ToolResult => {
      const trimmed = truncateResult(content);
      ctx.trace.push({
        t: 'tool_result',
        name: call.name,
        callId: call.id,
        ok,
        content: trimmed,
        ms: now() - started,
      });
      return { id: call.id, name: call.name, ok, content: trimmed };
    };

    if (!tool) {
      const available = [...this.tools.values()]
        .filter((t) => t.agents.includes(ctx.agent))
        .map((t) => t.name)
        .join(', ');
      return finish(
        false,
        `There is no tool called "${call.name}". Available to you: ${available}.`,
      );
    }

    // Authorization (§8.1), enforced at the bus rather than by omission.
    if (!tool.agents.includes(ctx.agent)) {
      return finish(
        false,
        `The ${ctx.agent} is not allowed to call ${tool.name}. Use one of the tools you were given.`,
      );
    }

    // The same rule for capabilities that are unavailable this session.
    if (ctx.excluded?.has(tool.name)) {
      return finish(
        false,
        `${tool.name} is not available in this session. Carry on without it, and do not call it again.`,
      );
    }

    const prepared = tool.prepare ? tool.prepare(call.input) : { input: call.input, notes: [] };
    const parsed = tool.schema.safeParse(prepared.input);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      const help = tool.explain?.(prepared.input, parsed.error.issues.map((i) => i.path)) ?? '';
      return finish(
        false,
        `Those arguments do not fit ${tool.name}. ${problems}. ${help ? `${help} ` : ''}Fix the named fields and call it again.`,
      );
    }
    const tidied = prepared.notes.length
      ? ` Accepted after a small correction: ${prepared.notes.join('; ')}. Write it that way from now on.`
      : '';

    try {
      const outcome = await tool.run(parsed.data as never, ctx);
      const body =
        outcome.data === undefined
          ? (outcome.message ?? (outcome.ok ? 'done' : 'failed'))
          : stringifyResult(outcome.data, outcome.message);
      return finish(outcome.ok, body + (outcome.ok ? tidied : ''));
    } catch (err) {
      const e = asChalkError(err);
      if (e.kind === 'AbortError') throw err; // Abort must unwind the loop.
      ctx.trace.push({ t: 'error', error: e.toJSON() });
      return finish(false, `${tool.name} failed: ${e.message}`);
    }
  }
}

function stringifyResult(data: unknown, message?: string): string {
  const payload = message ? { note: message, ...(data as object) } : data;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(data);
  }
}

/**
 * Tool results are the largest avoidable cost in an agent loop, because every
 * one of them is re-sent on every subsequent turn. Truncation says what was
 * dropped so the model does not assume it received everything.
 */
export function truncateResult(content: string, max = MAX_RESULT_BYTES): string {
  if (content.length <= max) return content;
  const kept = content.slice(0, max);
  return `${kept}\n… truncated: ${content.length - max} more characters were dropped to keep the conversation small. Ask for a narrower slice if you need the rest.`;
}
