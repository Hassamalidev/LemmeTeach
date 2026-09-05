/**
 * The agent loop (§7).
 *
 * The loop is code, not a prompt. No agent decides how many turns it gets, when
 * it is finished, or whether to retry — those are decisions with cost and
 * safety consequences, and they live here where they can be tested.
 *
 * What the model *does* get to decide is everything inside a turn: which tool,
 * with what arguments, in what order. That is the autonomy that makes this a
 * tutor rather than a script.
 */
import type { AgentId } from '../core/types';
import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
  ProviderAdapter,
  AdapterConfig,
  ToolCall,
  TurnResult,
} from '../providers/types';
import type { ToolBus } from '../tools';
import { TERMINAL_TOOLS } from '../tools';
import type { ToolContext } from '../tools/context';
import type { Budget } from './budget';
import type { Trace } from './trace';
import { compact, type CompactContext } from './compact';
import {
  asChalkError,
  backoffDelay,
  ChalkError,
  contextError,
  loopError,
  refusalError,
} from './errors';

export interface AgentConfig {
  id: AgentId;
  model: string;
  system: string;
  maxTurns: number;
  maxTokens: number;
  temperature: number;
  seedMessages: AgentMessage[];
  /** Tools withheld from this run, on top of the access matrix. */
  exclude?: ReadonlySet<string>;
}

export interface RunContext {
  provider: ProviderAdapter;
  adapterConfig: AdapterConfig;
  toolBus: ToolBus;
  toolCtx: ToolContext;
  budget: Budget;
  trace: Trace;
  signal: AbortSignal;
  compactCtx: CompactContext;
  /**
   * Called before each turn. Returning a string injects it as a user message —
   * this is how remediation and a raised hand reach the tutor, both of which
   * are decided by the orchestrator rather than by the model.
   */
  injectBeforeTurn?: () => string | null;
  /**
   * Whether a turn produced a usable tool call. Three failures in a row means
   * the model cannot work the loop, and the session offers scripted mode
   * rather than letting it burn the learner's budget (§5.5, §17.4).
   */
  onTurnQuality?: (hadValidToolCall: boolean) => void;
  /** Streaming hooks so the board can draw while arguments are still arriving. */
  onEvent?: (e: AgentEvent) => void;
  onText?: (delta: string) => void;
}

export interface AgentOutcome {
  reason: 'terminal_tool' | 'no_tool_call' | 'max_turns' | 'budget' | 'aborted';
  tool?: string;
  messages: AgentMessage[];
  error?: ChalkError;
}

const MAX_TRANSPORT_RETRIES = 3;

export async function runAgent(cfg: AgentConfig, ctx: RunContext): Promise<AgentOutcome> {
  const messages: AgentMessage[] = [...cfg.seedMessages];
  const detector = new NoProgressDetector();
  let maxTokens = cfg.maxTokens;
  let truncations = 0;
  let forceToolChoice = false;

  for (let turn = 0; turn < cfg.maxTurns; turn++) {
    try {
      ctx.budget.assertNotExhausted();
      ctx.signal.throwIfAborted();
    } catch (err) {
      const e = asChalkError(err);
      return {
        reason: e.kind === 'AbortError' ? 'aborted' : 'budget',
        messages,
        error: e,
      };
    }

    const injection = ctx.injectBeforeTurn?.();
    if (injection) {
      messages.push({ role: 'user', content: injection });
      ctx.trace.push({ t: 'note', message: 'Instruction injected by the orchestrator.' });
    }

    ctx.trace.push({ t: 'turn', agent: cfg.id, turn, model: cfg.model });
    ctx.budget.countTurn();

    const request: AgentRequest = {
      model: cfg.model,
      system: cfg.system,
      messages: compact(messages, ctx.compactCtx),
      tools: ctx.toolBus.specsFor(cfg.id, cfg.exclude),
      maxTokens,
      temperature: cfg.temperature,
      toolChoice: forceToolChoice && ctx.provider.supportsToolChoice ? 'required' : 'auto',
    };
    forceToolChoice = false;

    let result: TurnResult;
    try {
      result = await consumeWithRetry(request, ctx);
    } catch (err) {
      const e = asChalkError(err);
      if (e.kind === 'AbortError') return { reason: 'aborted', messages, error: e };

      if (e.kind === 'ContextError') {
        // Force a compaction pass and retry once (§17.1). If it recurs, the
        // caller closes the lesson gracefully rather than looping.
        const before = messages.length;
        const compacted = compact(messages, {
          ...ctx.compactCtx,
          contextWindow: Math.floor(ctx.compactCtx.contextWindow * 0.5),
        });
        if (compacted.length < before) {
          messages.length = 0;
          messages.push(...compacted);
          ctx.trace.push({ t: 'note', message: 'Context was too large; older turns were condensed.' });
          continue;
        }
      }

      ctx.trace.push({ t: 'error', error: e.toJSON() });
      return { reason: 'no_tool_call', messages, error: e };
    }

    ctx.budget.add(result.usage);
    ctx.trace.push({
      t: 'usage',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    if (result.text.trim()) {
      ctx.trace.push({ t: 'text', agent: cfg.id, text: result.text });
    }

    if (result.stop === 'refusal') {
      const e = refusalError(
        'The model declined to answer that. Try rephrasing the topic.',
        { detail: result.text },
      );
      ctx.trace.push({ t: 'error', error: e.toJSON() });
      return { reason: 'no_tool_call', messages, error: e };
    }

    // A truncated tool call yields unparseable arguments. Never send the
    // fragment back — discard the turn and ask for a smaller step (§17.2).
    if (result.stop === 'max_tokens' && result.toolCalls.length === 0) {
      truncations += 1;
      if (truncations >= 2) {
        maxTokens = Math.max(1024, Math.floor(maxTokens / 2));
        ctx.trace.push({
          t: 'note',
          message: `The model kept producing oversized steps; its output limit was halved to ${maxTokens}.`,
        });
      }
      if (truncations > 3) {
        return { reason: 'max_turns', messages, error: loopError('The model kept truncating.') };
      }
      messages.push({
        role: 'user',
        content:
          'Your previous message was cut off before it finished, so nothing was used. Send a smaller teach_step — fewer board operations and shorter narration.',
      });
      continue;
    }

    messages.push({
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
    });

    ctx.onTurnQuality?.(result.toolCalls.length > 0);

    if (result.toolCalls.length === 0) {
      // Prose with no tool call teaches nobody anything: the board stays blank
      // and the learner sees a spinner. Ask once with tool_choice forced.
      const nudge = detector.noToolCall();
      if (nudge === 'retry') {
        forceToolChoice = true;
        messages.push({
          role: 'user',
          content:
            'Nothing happened on the board — the learner cannot see that message. Respond by calling a tool.',
        });
        continue;
      }
      return { reason: 'no_tool_call', messages };
    }

    const repeated = detector.checkRepetition(result.toolCalls);
    if (repeated) {
      messages.push({ role: 'user', content: repeated });
    }

    const results = await ctx.toolBus.dispatch(result.toolCalls, ctx.toolCtx);
    messages.push({ role: 'tool', results });

    const terminal = results.find((r) => TERMINAL_TOOLS.has(r.name) && r.ok);
    if (terminal) {
      return { reason: 'terminal_tool', tool: terminal.name, messages };
    }
  }

  return { reason: 'max_turns', messages };
}

/* ------------------------------------------------------------------ *
 * Consuming one provider turn
 * ------------------------------------------------------------------ */

/**
 * Retries only transport failures — a rate limit, an overloaded provider, a
 * dropped connection. A refusal or a bad request is not retried, because
 * sending the identical request again is how a single mistake turns into three
 * charges for the same mistake.
 */
async function consumeWithRetry(request: AgentRequest, ctx: RunContext): Promise<TurnResult> {
  let lastError: ChalkError | null = null;

  for (let attempt = 0; attempt < MAX_TRANSPORT_RETRIES; attempt++) {
    try {
      return await consume(request, ctx);
    } catch (err) {
      const e = asChalkError(err);
      if (!e.retryable || e.kind === 'AbortError') throw e;
      lastError = e;
      ctx.trace.push({ t: 'error', error: e.toJSON() });
      const wait = backoffDelay(attempt, e.retryAfter);
      await delay(wait, ctx.signal);
    }
  }

  throw lastError ?? asChalkError(new Error('The provider could not be reached.'));
}

export async function consume(request: AgentRequest, ctx: RunContext): Promise<TurnResult> {
  const calls = new Map<string, { name: string; json: string; input?: unknown }>();
  const order: string[] = [];
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let stop: TurnResult['stop'] = 'end_turn';

  for await (const event of ctx.provider.run(request, ctx.adapterConfig, ctx.signal)) {
    ctx.onEvent?.(event);

    switch (event.t) {
      case 'text':
        text += event.delta;
        ctx.onText?.(event.delta);
        break;
      case 'tool_start':
        calls.set(event.id, { name: event.name, json: '' });
        order.push(event.id);
        break;
      case 'tool_delta': {
        const c = calls.get(event.id);
        if (c) c.json += event.json;
        break;
      }
      case 'tool_end': {
        const c = calls.get(event.id);
        if (c) c.input = event.input;
        break;
      }
      case 'usage':
        usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      case 'stop':
        stop = event.reason;
        break;
      case 'error':
        throw event.error;
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const id of order) {
    const c = calls.get(id);
    if (!c) continue;
    if (c.input !== undefined) {
      toolCalls.push({ id, name: c.name, input: c.input });
      continue;
    }
    // The adapter did not resolve the arguments, so parse what streamed. A
    // failure here is a truncated call: dropping it is correct, and the loop
    // sees `max_tokens` with no calls and asks for a smaller step.
    try {
      toolCalls.push({ id, name: c.name, input: JSON.parse(c.json || '{}') });
    } catch {
      stop = 'max_tokens';
    }
  }

  return { text, toolCalls, usage, stop };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/* ------------------------------------------------------------------ *
 * No-progress detection (§17.3)
 * ------------------------------------------------------------------ */

/**
 * A loop that is not progressing burns the learner's budget while producing
 * nothing. Detecting it is cheap; the alternative is a lesson that quietly
 * costs three dollars and teaches one idea twice.
 */
export class NoProgressDetector {
  private history: string[] = [];
  private emptyTurns = 0;
  private nudged = new Set<string>();

  checkRepetition(calls: ToolCall[]): string | null {
    const signature = calls
      .map((c) => `${c.name}:${stableHash(JSON.stringify(c.input ?? {}))}`)
      .join('|');
    this.history.push(signature);
    if (this.history.length > 8) this.history.shift();

    const last3 = this.history.slice(-3);
    if (last3.length === 3 && last3.every((s) => s === signature) && !this.nudged.has(signature)) {
      this.nudged.add(signature);
      const names = [...new Set(calls.map((c) => c.name))].join(', ');
      return `You have now called ${names} three times with identical arguments and the lesson has not moved. Whatever you are trying is not working — do something different, or move on to the next part of the plan.`;
    }
    return null;
  }

  noToolCall(): 'retry' | 'stop' {
    this.emptyTurns += 1;
    return this.emptyTurns >= 2 ? 'stop' : 'retry';
  }
}

function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export { contextError };
