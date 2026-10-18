/**
 * What a tool is handed when it runs.
 *
 * These are ports, declared as interfaces, and the orchestrator supplies the
 * implementations. That is what keeps §3's layer rule true: a tool knows how
 * to write on *a* board, not how this board renders, and the whole tool bus can
 * be driven in a test with fakes and no DOM.
 */
import type { AgentId, Pace, SubjectId } from '../core/types';
import type { BoardOp } from '../board/op-schema';
import type { Trace } from '../runtime/trace';
import type { Settings } from '../storage/settings';

export interface TeachStepRequest {
  say: string;
  ops: BoardOp[];
  clear: boolean;
  objective?: string;
  pace?: Pace;
}

export interface TeachStepOutcome {
  stepId: string;
  opsRendered: number;
  page: number;
  /** True when the page is nearly full and the next step should clear it. */
  boardFull: boolean;
}

export interface BoardPort {
  /** Commit one narrated step. Returns what the model needs to know next. */
  writeStep(req: TeachStepRequest): TeachStepOutcome;
  /** Replace the ops of the step currently being repaired (§8.5). */
  replaceLastOps(ops: BoardOp[]): TeachStepOutcome;
  /** Ids on the current page, so `annotate` can be validated before rendering. */
  knownIds(): ReadonlySet<string>;
  knownFigures(): ReadonlySet<string>;
  /** A compact description of what is on the board, for context compaction (§7). */
  historySummary(): string;
}

export interface AskQuestion {
  question: string;
  kind: 'free' | 'choice' | 'confirm' | 'number';
  options?: string[];
}

export interface AskAnswer {
  answer: string;
  elapsedMs: number;
  skipped: boolean;
}

/**
 * The suspension port. It genuinely waits on a human — no timeout, and never
 * a fabricated answer (§17.5). The tab may sit here for an hour.
 */
export interface LearnerPort {
  ask(q: AskQuestion, signal: AbortSignal): Promise<AskAnswer>;
}

export interface SandboxResult {
  ok: boolean;
  stdout: string;
  result: string;
  figures: string[];
  timedOut: boolean;
  error?: string;
}

export interface SandboxPort {
  available(): boolean;
  run(
    language: 'python' | 'javascript',
    source: string,
    signal: AbortSignal,
  ): Promise<SandboxResult>;
  /** Why the sandbox is unavailable, for the tool result and the prompt. */
  unavailableReason(): string;
}

export interface NotesPort {
  save(note: { title: string; markdown: string; tags?: string[] }): void;
}

export interface ToolContext {
  agent: AgentId;
  /**
   * Tools withheld this session because the capability is unavailable —
   * a blocked sandbox, Wikipedia switched off. Enforced at the bus, not just
   * omitted from the spec list: a model that calls a tool it was never offered
   * must get a clear refusal, not the tool.
   */
  excluded?: ReadonlySet<string>;
  sessionId: string;
  subject: SubjectId;
  signal: AbortSignal;
  trace: Trace;
  settings: Settings;
  board: BoardPort;
  learner: LearnerPort;
  sandbox: SandboxPort;
  notes: NotesPort;
  /** Plain-language status line above the board (§15). */
  status(message: string | null): void;
  /**
   * Board operations were rejected. The session counts failures per step and
   * escalates to the repairer agent on the second one (§17.3); it returns
   * corrected operations, or null to let the model try again itself.
   */
  boardRejected(ops: unknown, problems: string[]): Promise<BoardOp[] | null>;
  /** Terminal-tool payloads and control signals travel back this way. */
  signalOrchestrator(event: OrchestratorSignal): void;
}

export type OrchestratorSignal =
  | { t: 'plan'; plan: unknown }
  | { t: 'end_lesson'; payload: unknown }
  | { t: 'step_written'; stepId: string; say: string; pace?: Pace }
  | { t: 'board_repaired'; ops: BoardOp[] };
