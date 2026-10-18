/**
 * The session (§3).
 *
 * Owns the lifecycle of one solved question: it drives the phase machine, runs
 * the reader and then the solver, supplies every tool port, and holds the
 * state the UI renders.
 *
 * It is an event emitter rather than a React store because the runtime has to
 * be drivable with no DOM at all — the integration tests replay a walkthrough
 * through this exact class (§22).
 */
import { now, uid, type AgentId, type Level, type SubjectId } from '../core/types';
import { BoardModel } from '../board/page';
import type { BoardOp } from '../board/op-schema';
import { Budget, type BudgetSnapshot } from '../runtime/budget';
import { asChalkError, ChalkError } from '../runtime/errors';
import { runAgent, type AgentConfig, type RunContext } from '../runtime/loop';
import { Trace, statusFor } from '../runtime/trace';
import { createToolBus } from '../tools/registry';
import type {
  AskAnswer,
  AskQuestion,
  BoardPort,
  LearnerPort,
  NotesPort,
  OrchestratorSignal,
  SandboxPort,
  TeachStepRequest,
  ToolContext,
} from '../tools/context';
import type {
  AdapterConfig,
  AgentMessage,
  Attachment,
  ProviderAdapter,
} from '../providers/types';
import type { EndLessonIn, LessonPlan } from '../tools/schemas';
import type { Settings } from '../storage/settings';
import {
  AGENT_SPECS,
  readerPrompt,
  readerSeed,
  repairerPrompt,
  repairerSeed,
  solverPrompt,
  solverSeed,
  type PromptContext,
} from '../agents';
import { WRAP_UP_INSTRUCTION } from '../agents/prompts/policy';
import { nextPhase, type Phase, type PhaseEvent } from './machine';
import { saveFigure, saveLesson } from '../storage/db';
import type { SolutionRecord } from '../storage/records';

/** A clarifying question waiting on the learner. */
export interface Pending {
  kind: 'ask';
  question: AskQuestion;
  resolve: (a: AskAnswer) => void;
  askedAt: number;
}

export interface SessionState {
  phase: Phase;
  status: string | null;
  plan: LessonPlan | null;
  pages: BoardModel['pages'];
  /** The step most recently written to the board. */
  currentStepId: string | null;
  pending: Pending | null;
  budget: BudgetSnapshot;
  error: ChalkError | null;
  ending: EndLessonIn | null;
  notes: { title: string; markdown: string; tags?: string[] }[];
  transcript: { stepId: string; say: string; at: number }[];
  /** Turn number within the current agent, for the meter. */
  turn: number;
  /**
   * Where a raised hand has got to. `answering`: the solver is writing its
   * answer. `waiting`: the answer is on the board and the solution is held
   * until the learner says whether it made sense.
   */
  aside: 'none' | 'answering' | 'waiting';
  /** Steps written as answers to a raised hand, not part of the solution. */
  asideStepIds: string[];
}

export interface SessionOptions {
  /** The learner's question, in their own words. May be empty when attached. */
  topic: string;
  /** What they attached to it. Read by the reader only (§13). */
  attachments?: Attachment[];
  /**
   * Where the board starts before the reader has settled the real subject and
   * level from the question. The demo knows both up front.
   */
  subject: SubjectId;
  level: Level;
  provider: ProviderAdapter;
  adapterConfig: AdapterConfig;
  settings: Settings;
  sandbox: SandboxPort;
  /**
   * Hold the model to the pace of the voice. With a screen attached, the
   * model can write steps several times faster than they can be spoken; left
   * alone it would finish the whole solution while the learner is still
   * hearing step one, and a raised hand would land steps away from where
   * they are. Off by default, because nothing acknowledges narration when
   * there is no screen.
   */
  pacing?: boolean;
  models: Record<AgentId, string>;
  contextWindow: number;
  /** Figures that already exist, so a replayed board may place them (§18). */
  knownFigures?: string[];
  /** A replay: nothing new to save, so nothing is saved. */
  ephemeral?: boolean;
}

export class Session {
  readonly id = uid('lesson');
  /** Read by the UI to theme the board. Settled by the reader from the question. */
  subject: SubjectId;
  level: Level;
  readonly topic: string;
  readonly trace = new Trace();
  readonly board = new BoardModel();

  private phase: Phase = 'IDLE';
  private previousPhase: Phase = 'TEACHING';
  private controller = new AbortController();
  private listeners = new Set<(s: SessionState) => void>();
  private toolBus = createToolBus();
  private budget: Budget;

  private plan: LessonPlan | null = null;
  private ending: EndLessonIn | null = null;
  private pending: Pending | null = null;
  private status: string | null = null;
  private error: ChalkError | null = null;
  private notes: { title: string; markdown: string; tags?: string[] }[] = [];
  private transcript: { stepId: string; say: string; at: number }[] = [];
  private currentStepId: string | null = null;
  private figures = new Set<string>();
  private turn = 0;
  private startedAt = now();

  /** Raised-hand question waiting to be injected into the next turn. */
  private interruption: string | null = null;
  private aside: SessionState['aside'] = 'none';
  private asideSteps = new Set<string>();
  /** What to tell the solver once the learner has said whether the answer landed. */
  private afterAside: string | null = null;
  private wrapUpSent = false;
  /** Consecutive board rejections on the current step, for §17.3. */
  private boardFailures = 0;
  /** Where fix_board leaves its result for the escalation to pick up. */
  private repairedOps: BoardOp[] | null = null;

  constructor(private opts: SessionOptions) {
    this.subject = opts.subject;
    this.topic = opts.topic;
    this.level = opts.level;
    for (const id of opts.knownFigures ?? []) this.figures.add(id);
    this.budget = new Budget(opts.settings.budget, {
      model: opts.models.tutor,
      providerId: opts.provider.id,
      onChange: () => this.emit(),
    });
  }

  /* ---------------------------------------------------------------- *
   * Subscription
   * ---------------------------------------------------------------- */

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get state(): SessionState {
    return {
      phase: this.phase,
      status: this.status,
      plan: this.plan,
      pages: this.board.pages,
      currentStepId: this.currentStepId,
      pending: this.pending,
      budget: this.budget.snapshot(),
      error: this.error,
      ending: this.ending,
      notes: this.notes,
      transcript: this.transcript,
      turn: this.turn,
      aside: this.aside,
      asideStepIds: [...this.asideSteps],
    };
  }

  /**
   * Read through a getter rather than touching the field: between two checks
   * an agent has run, and narrowing on the field would let TypeScript conclude
   * the phase cannot have changed.
   */
  private get aborted(): boolean {
    return this.phase === 'ABORTED';
  }

  private emit(): void {
    const snapshot = this.state;
    for (const fn of this.listeners) fn(snapshot);
  }

  private transition(event: PhaseEvent): void {
    const from = this.phase;
    const to = nextPhase(from, event, this.previousPhase);
    if (to === from) return;
    if (from !== 'CHECKING') this.previousPhase = from;
    this.phase = to;
    this.trace.push({ t: 'phase', from, to });
    this.setStatus(statusFor({ id: '', at: now(), t: 'phase', from, to }));
    this.emit();
  }

  private setStatus(message: string | null): void {
    this.status = message;
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Solving a question
   * ---------------------------------------------------------------- */

  async start(): Promise<void> {
    this.transition({ t: 'start' });

    try {
      await this.runReader();
      if (this.aborted) return;
      await this.runSolver();
    } catch (err) {
      this.fail(err);
    } finally {
      // Whatever happened, what was written is saved. Losing work in progress
      // on any error is listed under "never acceptable" (§17.5).
      await this.persist();
      this.emit();
    }
  }

  /**
   * The reader (§8.2): reads the question and anything attached, restates it
   * in full, and plans the solution. The only agent that sees the attachments.
   */
  private async runReader(): Promise<void> {
    const attachments = this.opts.attachments ?? [];
    const outcome = await runAgent(
      this.agentConfig('planner', readerPrompt(this.promptContext()), [
        {
          role: 'user',
          content: readerSeed(this.opts.topic, attachments.length),
          ...(attachments.length ? { attachments } : {}),
        },
      ]),
      this.runContext('planner'),
    );

    if (outcome.error) throw outcome.error;

    if (!this.plan) {
      // The reader finished without committing a plan. Rather than stopping
      // the session over it, solve from a minimal plan built from the question
      // as typed — a solution from a thin plan beats none.
      this.plan = fallbackPlan(this.opts.topic, this.level);
      this.trace.push({
        t: 'note',
        message: 'The question was not planned, so a simple plan was used instead.',
      });
    }

    // The learner never picked a subject or a level: the question did.
    if (this.plan.subject) this.subject = this.plan.subject;
    this.level = this.plan.level;

    this.transition({ t: 'planned' });
  }

  /** The solver (§8.3): works the question through on the board. */
  private async runSolver(): Promise<void> {
    const plan = this.plan;
    if (!plan) return;

    const outcome = await runAgent(
      this.agentConfig('tutor', solverPrompt(this.promptContext()), [
        { role: 'user', content: solverSeed(plan, this.opts.topic) },
      ]),
      this.runContext('tutor'),
    );
    // Kept so a question asked after the end is answered by a solver that
    // remembers the whole solution, not one starting cold.
    this.solverHistory = outcome.messages;

    if (outcome.error && outcome.error.kind !== 'BudgetError') throw outcome.error;

    if (!this.ending) {
      // Out of turns or budget: close deliberately rather than leaving the
      // learner on a half-drawn board.
      this.ending = {
        summary: 'This ran out of room before the end, but the board has everything worked out so far.',
        objectivesMet: [],
        objectivesMissed: plan.objectives.map((o) => o.id),
        nextTopics: [],
      };
      this.transition({ t: 'solved' });
    }
  }

  /**
   * Counts board rejections and escalates on the second (§17.3).
   *
   * The first failure goes back to the solver, which usually fixes its own
   * mistake for free. The second means it cannot see what is wrong, so a
   * cheap dedicated model gets one attempt. If that fails too, the step's
   * operations are dropped and the narration still reaches the learner — they
   * get the explanation either way.
   */
  private async onBoardRejected(ops: unknown, problems: string[]): Promise<BoardOp[] | null> {
    this.boardFailures += 1;
    if (this.boardFailures < 2) return null;
    this.boardFailures = 0;

    this.trace.push({
      t: 'note',
      message: 'Board operations failed twice; asking the repairer to fix them.',
    });

    const repaired = await this.runRepairer(ops, problems);
    if (repaired && repaired.length) return repaired;

    this.trace.push({
      t: 'note',
      message: 'The repair failed. The narration will be shown as plain text instead.',
    });
    return null;
  }

  /**
   * The repairer (§8.4). Invoked by the runtime, never by another agent, after
   * two validation failures on the same step.
   */
  private async runRepairer(ops: unknown, problems: string[]): Promise<BoardOp[] | null> {
    this.repairedOps = null;
    await runAgent(
      {
        id: 'repairer',
        model: this.opts.models.repairer,
        system: repairerPrompt(),
        maxTurns: AGENT_SPECS.repairer.maxTurns,
        maxTokens: AGENT_SPECS.repairer.maxTokens,
        temperature: AGENT_SPECS.repairer.temperature,
        seedMessages: [{ role: 'user', content: repairerSeed(ops, problems) }],
      },
      this.runContext('repairer'),
    );
    return this.repairedOps;
  }

  /**
   * What every agent prompt is built from, including which capabilities are
   * actually available — a solver told it has a sandbox when it does not will
   * offer to run code and then fail in front of the learner (§17.4).
   */
  private promptContext(): PromptContext {
    return {
      subject: this.subject,
      level: this.level,
      topic: this.opts.topic,
      sandbox: this.opts.settings.sandboxEnabled && this.opts.sandbox.available(),
      sandboxReason: this.opts.sandbox.unavailableReason() || undefined,
      wiki: this.opts.settings.wikiEnabled,
    };
  }

  /* ---------------------------------------------------------------- *
   * Agent plumbing
   * ---------------------------------------------------------------- */

  /**
   * Capabilities unavailable this session, withheld from every agent. A tool
   * that is never offered is never called, and is also that much less prompt
   * to pay for on every turn.
   */
  private excludedTools(): ReadonlySet<string> {
    const exclude = new Set<string>();
    if (!this.opts.settings.wikiEnabled) exclude.add('wiki_lookup');
    if (!this.opts.settings.sandboxEnabled || !this.opts.sandbox.available()) {
      exclude.add('run_code');
    }
    return exclude;
  }

  private agentConfig(
    id: AgentId,
    system: string,
    seedMessages: Extract<AgentMessage, { role: 'user' }>[],
  ): AgentConfig {
    const spec = AGENT_SPECS[id];
    return {
      id,
      model: this.opts.models[id],
      system,
      maxTurns: spec.maxTurns,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      seedMessages,
      exclude: this.excludedTools(),
    };
  }

  private runContext(agent: AgentId): RunContext {
    return {
      provider: this.opts.provider,
      adapterConfig: this.opts.adapterConfig,
      toolBus: this.toolBus,
      toolCtx: this.toolContext(agent),
      budget: this.budget,
      trace: this.trace,
      signal: this.controller.signal,
      compactCtx: {
        contextWindow: this.opts.contextWindow,
        planSummary: this.plan ? summarizePlan(this.plan) : undefined,
        boardSummary: this.board.historySummary(),
      },
      injectBeforeTurn: agent === 'tutor' ? () => this.takeInjection() : undefined,
      onEvent: () => {
        this.turn = this.budget.snapshot().turns;
      },
      beforeTurn: () => this.waitForPlayback(),
    };
  }

  private toolContext(agent: AgentId): ToolContext {
    return {
      agent,
      excluded: this.excludedTools(),
      sessionId: this.id,
      subject: this.subject,
      signal: this.controller.signal,
      trace: this.trace,
      settings: this.opts.settings,
      board: this.boardPort(),
      learner: this.learnerPort(),
      sandbox: this.figureStoringSandbox(),
      notes: this.notesPort(),
      status: (m) => this.setStatus(m),
      boardRejected: (ops, problems) => this.onBoardRejected(ops, problems),
      signalOrchestrator: (e) => this.onSignal(e),
    };
  }

  /* ---------------------------------------------------------------- *
   * Ports
   * ---------------------------------------------------------------- */

  private boardPort(): BoardPort {
    return {
      writeStep: (req: TeachStepRequest) => {
        const outcome = this.board.write(req);
        this.currentStepId = outcome.stepId;
        if (this.aside === 'answering') {
          // Marked before the screen hears of the step, so it is played as an
          // answer — straight away — rather than queued behind the solution.
          this.asideSteps.add(outcome.stepId);
          // With a screen attached the solution now waits for the learner.
          // With none, nobody could ever release it, so it carries on.
          this.aside = this.opts.pacing ? 'waiting' : 'none';
        }
        this.transcript = [
          ...this.transcript,
          { stepId: outcome.stepId, say: req.say, at: now() },
        ];
        this.emit();
        return outcome;
      },
      replaceLastOps: (ops) => {
        const outcome = this.board.replaceLastOps(ops);
        this.emit();
        return outcome;
      },
      knownIds: () => this.board.knownIds(),
      knownFigures: () => this.figures,
      historySummary: () => this.board.historySummary(),
    };
  }

  /**
   * The suspension port. A clarifying question genuinely waits on a human —
   * no timeout, and never a fabricated answer (§17.5).
   */
  private learnerPort(): LearnerPort {
    return {
      ask: (question, signal) =>
        new Promise<AskAnswer>((resolve) => {
          this.previousPhase = this.phase;
          this.transition({ t: 'ask_started' });
          const askedAt = now();

          const settle = (answer: AskAnswer): void => {
            this.pending = null;
            this.transition({ t: 'ask_finished' });
            resolve(answer);
          };

          this.pending = { kind: 'ask', question, resolve: settle, askedAt };
          this.emit();

          // Abort resolves the promise as a skip rather than leaving the loop
          // suspended forever on a session that is being torn down.
          signal.addEventListener(
            'abort',
            () => {
              if (this.pending) {
                this.pending = null;
                resolve({ answer: '', elapsedMs: now() - askedAt, skipped: true });
              }
            },
            { once: true },
          );
        }),
    };
  }

  /**
   * The sandbox returns image data; the board contract deals in figure ids.
   * Storing the image and handing back an id happens here so neither the
   * sandbox nor the tool has to know about IndexedDB.
   */
  private figureStoringSandbox(): SandboxPort {
    const inner = this.opts.sandbox;
    return {
      available: () => inner.available(),
      unavailableReason: () => inner.unavailableReason(),
      run: async (language, source, signal) => {
        const result = await inner.run(language, source, signal);
        if (!result.figures.length) return result;

        const ids: string[] = [];
        // Four per step is the cap from §11; beyond that a board becomes a
        // slideshow of plots nobody looked at.
        for (const dataUrl of result.figures.slice(0, 4)) {
          const id = uid('fig');
          await saveFigure({ id, lessonId: this.id, dataUrl, createdAt: now() });
          this.figures.add(id);
          ids.push(id);
        }
        return { ...result, figures: ids };
      },
    };
  }

  private notesPort(): NotesPort {
    return {
      save: (note) => {
        this.notes = [...this.notes, note];
        this.emit();
      },
    };
  }

  /* ---------------------------------------------------------------- *
   * Signals from tools
   * ---------------------------------------------------------------- */

  private onSignal(event: OrchestratorSignal): void {
    switch (event.t) {
      case 'plan':
        this.plan = event.plan as LessonPlan;
        this.emit();
        break;

      case 'end_lesson':
        this.ending = event.payload as EndLessonIn;
        this.transition({ t: 'solved' });
        break;

      case 'step_written':
        this.currentStepId = event.stepId;
        this.boardFailures = 0;
        this.emit();
        break;

      case 'board_repaired':
        this.repairedOps = event.ops;
        break;
    }
  }

  /* ---------------------------------------------------------------- *
   * Learner actions
   * ---------------------------------------------------------------- */

  /** Answer the clarifying question, or decline to. */
  answerAsk(answer: string, skipped = false): void {
    const pending = this.pending;
    if (!pending) return;
    pending.resolve({ answer, elapsedMs: now() - pending.askedAt, skipped });
  }

  private solverHistory: AgentMessage[] = [];
  private followingUp = false;

  /**
   * A question asked after the solution has finished. The solver is run again
   * from where it ended, answers, waits to hear whether that made sense, and
   * closes again.
   */
  private async followUp(): Promise<void> {
    if (this.followingUp || !this.plan) return;
    this.followingUp = true;
    try {
      const outcome = await runAgent(
        {
          ...this.agentConfig('tutor', solverPrompt(this.promptContext()), []),
          seedMessages: this.solverHistory,
        },
        this.runContext('tutor'),
      );
      this.solverHistory = outcome.messages;
      if (outcome.error && outcome.error.kind !== 'BudgetError') throw outcome.error;
      // Whatever happened, the session ends where it was: finished. If the
      // run stopped before it could even take the question — the budget was
      // already spent — the phase is still "interrupted" and has to be walked
      // back through.
      this.aside = 'none';
      this.interruption = null;
      this.afterAside = null;
      this.transition({ t: 'resume' });
      this.transition({ t: 'solved' });
    } catch (err) {
      this.fail(err);
    } finally {
      this.followingUp = false;
      await this.persist();
      this.emit();
    }
  }

  /** Raise hand (§15). Injected as the next user message. */
  raiseHand(question: string): void {
    const finished = this.phase === 'REVIEW';
    this.interruption = question;
    this.afterAside = null;
    this.aside = 'answering';
    this.transition({ t: 'raise_hand' });
    if (finished) void this.followUp();
    // Their question should not wait for the current step to finish playing.
    this.releasePlayback();
  }

  get pendingInterruption(): string | null {
    return this.interruption;
  }

  /** Extra instructions the loop should inject before the solver's next turn. */
  takeInjection(): string | null {
    if (this.interruption) {
      const q = this.interruption;
      this.interruption = null;
      this.transition({ t: 'resume' });
      return asideInstruction(q);
    }
    if (this.afterAside) {
      const note = this.afterAside;
      this.afterAside = null;
      return note;
    }
    if (this.budget.shouldWrapUp && !this.wrapUpSent) {
      this.wrapUpSent = true;
      return WRAP_UP_INSTRUCTION;
    }
    return null;
  }

  /**
   * The learner says whether the answer to their question made sense (§15).
   *
   * This is the learner's call and nobody else's: the solver is not allowed to
   * decide for itself that it was understood and press on, and it is not
   * allowed to quiz them to find out. Understood means the solution resumes
   * from exactly where it stopped. Not understood means the same point again,
   * a different way, and then they are asked again.
   */
  resumeAfterAside(understood: boolean): void {
    if (this.aside !== 'waiting') return;
    if (understood) {
      this.aside = 'none';
      this.afterAside = this.followingUp ? CLOSE_AGAIN_INSTRUCTION : RESUME_INSTRUCTION;
    } else {
      this.aside = 'answering';
      this.afterAside = EXPLAIN_AGAIN_INSTRUCTION;
    }
    this.emit();
    this.releasePlayback();
  }

  /* ---------------------------------------------------------------- *
   * Pacing: the model stays at most one step ahead of the voice (§14)
   * ---------------------------------------------------------------- */

  private narrated = 0;
  private playbackWaiters: (() => void)[] = [];

  /** The screen calls this each time a step's narration finishes. */
  stepNarrated(): void {
    this.narrated += 1;
    this.releasePlayback();
  }

  private releasePlayback(): void {
    const waiters = this.playbackWaiters;
    this.playbackWaiters = [];
    for (const resume of waiters) resume();
  }

  /**
   * Resolves once the voice is within one step of the board. One step of
   * lookahead means the next step is ready the moment the current one ends,
   * with no silence between them, and no more than that is ever wasted if the
   * learner interrupts.
   */
  private async waitForPlayback(): Promise<void> {
    if (!this.opts.pacing) return;
    const held = (): boolean =>
      // An answer is on the board and the learner has not yet said whether it
      // made sense: nothing more is written until they do.
      this.aside === 'waiting' ||
      // Otherwise the usual rule, which a waiting question or instruction
      // overrides so that it is acted on at once.
      (this.board.stepCount - this.narrated > 1 &&
        this.interruption === null &&
        this.afterAside === null);
    while (held() && !this.controller.signal.aborted) {
      await new Promise<void>((resume) => this.playbackWaiters.push(resume));
    }
  }

  /* ---------------------------------------------------------------- *
   * Stopping
   * ---------------------------------------------------------------- */

  abort(): void {
    this.controller.abort(asChalkError(new DOMException('Aborted', 'AbortError')));
    this.releasePlayback();
    this.transition({ t: 'abort' });
    void this.persist();
  }

  private fail(err: unknown): void {
    const e = asChalkError(err);
    this.error = e;
    this.trace.push({ t: 'error', error: e.toJSON() });
    if (e.kind !== 'AbortError') this.transition({ t: 'abort' });
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  private async persist(): Promise<void> {
    if (this.opts.ephemeral) return;
    if (this.board.stepCount === 0 && !this.plan) return;

    const usage = this.budget.snapshot();
    const record: SolutionRecord = {
      id: this.id,
      subject: this.subject,
      topic: this.opts.topic,
      title: this.plan?.title ?? this.opts.topic,
      level: this.level,
      startedAt: this.startedAt,
      endedAt: now(),
      plan: this.plan,
      pages: this.board.pages,
      transcript: this.transcript,
      notes: this.notes,
      ending: this.ending ?? undefined,
      tokens: { input: usage.inputTokens, output: usage.outputTokens },
    };

    await saveLesson(record);
  }

  /** The repairer path, public for the integration tests. */
  repair(ops: unknown, problems: string[]): Promise<BoardOp[] | null> {
    return this.runRepairer(ops, problems);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * What the solver is told when a hand goes up. One step, not two: the learner
 * is asked afterwards whether it made sense, and can ask for it again, so
 * there is no need to guess how much is enough.
 */
function asideInstruction(question: string): string {
  return `The learner stopped you and asked: "${question}"

Answer exactly this, in ONE teach_step, and do not carry on with the solution in that step.

- Start from what they asked, not from where you were. If the question shows what they have misunderstood, address that directly.
- Use the board: point at the line they are asking about, or work a tiny concrete example. Do not just say the same thing again in other words.
- Keep it short and complete. They will be asked whether it made sense, and you will be told.

After that step, wait. You will be told whether to explain again or to go back to the solution.`;
}

const RESUME_INSTRUCTION = `The learner says that makes sense now. Go back to the solution and carry on from exactly where you stopped: the next thing you were about to do. Say in a few words that you are picking it back up. Do not repeat steps that are already on the board, and do not start again.`;

const CLOSE_AGAIN_INSTRUCTION = `The learner says that makes sense now. The solution was already finished before they asked, so there is nothing to go back to: call end_lesson again, with the same summary as before. Do not write another step.`;

const EXPLAIN_AGAIN_INSTRUCTION = `The learner says that did not clear it up. Explain the same point again in ONE teach_step, and do it differently this time: if you used algebra, use a picture or numbers; if you were general, be concrete; go one step more basic than you did. Do not repeat your last explanation, and do not carry on with the solution. They will be asked again whether it made sense.`;

function summarizePlan(plan: LessonPlan): string {
  const stages = plan.objectives.map((o) => `${o.id}: ${o.text}`).join('; ');
  return `${plan.title} (${plan.level}). Stages — ${stages}.`;
}

/**
 * A minimal plan, used only when the reader produced none. It is deliberately
 * plain: the point is that the learner still gets their question worked
 * through, not that this stands in for reading it properly.
 */
function fallbackPlan(question: string, level: Level): LessonPlan {
  return {
    id: uid('plan'),
    createdAt: now(),
    title: question.slice(0, 80) || 'Your question',
    level,
    problem: question,
    objectives: [
      { id: 'obj-1', text: 'Set out what is given and what is asked' },
      { id: 'obj-2', text: 'Work it through step by step' },
      { id: 'obj-3', text: 'State the answer and check it' },
    ],
    prerequisites: [],
    steps: [
      { objective: 'obj-1', representation: 'worked-example', note: 'what is given, what is asked' },
      { objective: 'obj-2', representation: 'derivation', note: 'the working' },
      { objective: 'obj-3', representation: 'recap', note: 'the answer, with a check' },
    ],
    estimatedMinutes: 6,
  };
}

export type { Phase };
