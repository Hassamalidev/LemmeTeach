/**
 * The session (§3).
 *
 * Owns the lifecycle of one lesson: it drives the phase machine, runs the four
 * agents in turn, supplies every tool port, and holds the state the UI renders.
 *
 * It is an event emitter rather than a React store because the runtime has to
 * be drivable with no DOM at all — the integration tests replay a tape through
 * this exact class (§22).
 */
import {
  now,
  uid,
  type AgentId,
  type Level,
  type Pace,
  type SubjectId,
} from '../core/types';
import { BoardModel } from '../board/page';
import type { BoardOp } from '../board/op-schema';
import { Budget, type BudgetSnapshot } from '../runtime/budget';
import { asChalkError, ChalkError, loopError } from '../runtime/errors';
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
  QuizOutcome,
  QuizQuestion,
  SandboxPort,
  TeachStepRequest,
  ToolContext,
} from '../tools/context';
import type { AdapterConfig, ProviderAdapter } from '../providers/types';
import type { LessonPlan, EndLessonIn, FinishExamIn } from '../tools/schemas';
import type { Settings } from '../storage/settings';
import {
  AGENT_SPECS,
  examinerPrompt,
  examinerSeed,
  plannerPrompt,
  plannerSeed,
  repairerPrompt,
  repairerSeed,
  tutorPrompt,
  tutorSeed,
  type PromptContext,
} from '../agents';
import { remediationInstruction, WRAP_UP_INSTRUCTION } from '../agents/prompts/policy';
import { nextPhase, PREREQUISITE_THRESHOLD, type Phase, type PhaseEvent } from './machine';
import { parseScripted, scriptedPrompt, ToolCapabilityWatch } from '../runtime/scripted';
import { BOARD_CONTRACT } from '../agents/prompts/base';
import type { LearnerStore } from '../memory/store';
import type { MaterialsStore } from '../materials/store';
import { saveFigure, saveLesson } from '../storage/db';
import type { LessonRecord } from '../memory/types';

export interface PendingAsk {
  kind: 'ask';
  question: AskQuestion;
  resolve: (a: AskAnswer) => void;
  askedAt: number;
}

export interface PendingQuiz {
  kind: 'quiz';
  questions: QuizQuestion[];
  resolve: (o: QuizOutcome) => void;
  askedAt: number;
}

export type Pending = PendingAsk | PendingQuiz;

export interface SessionState {
  phase: Phase;
  status: string | null;
  plan: LessonPlan | null;
  pages: BoardModel['pages'];
  /** Which step is currently being narrated. */
  currentStepId: string | null;
  pending: Pending | null;
  budget: BudgetSnapshot;
  error: ChalkError | null;
  ending: EndLessonIn | null;
  exam: FinishExamIn | null;
  notes: { title: string; markdown: string; tags?: string[] }[];
  transcript: { stepId: string; say: string; at: number }[];
  scriptedMode: boolean;
  /**
   * True once the model has failed to work the tool loop three turns running.
   * The UI offers the reduced mode; it is never switched on behind the
   * learner's back, because the difference matters (§17.4).
   */
  scriptedOffered: boolean;
  /** Turn number within the current agent, for the meter. */
  turn: number;
}

export interface SessionOptions {
  subject: SubjectId;
  topic: string;
  level: Level;
  provider: ProviderAdapter;
  adapterConfig: AdapterConfig;
  settings: Settings;
  memory: LearnerStore;
  materials: MaterialsStore;
  sandbox: SandboxPort;
  reviewConcepts?: string[];
  models: { planner: string; tutor: string; examiner: string; repairer: string };
  contextWindow: number;
}

export class Session {
  readonly id = uid('lesson');
  /** Read by the UI to theme the board. Cheaper than threading it separately. */
  readonly subject: SubjectId;
  readonly topic: string;
  readonly level: Level;
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
  private exam: FinishExamIn | null = null;
  private pending: Pending | null = null;
  private status: string | null = null;
  private error: ChalkError | null = null;
  private notes: { title: string; markdown: string; tags?: string[] }[] = [];
  private transcript: { stepId: string; say: string; at: number }[] = [];
  private currentStepId: string | null = null;
  private figures = new Set<string>();
  private turn = 0;
  private startedAt = now();
  private scriptedMode = false;
  private scriptedOffered = false;
  private toolWatch = new ToolCapabilityWatch();

  /** Set when a check scores low, and consumed by the next tutor run. */
  private remediation: string | null = null;
  /** Raised-hand question waiting to be injected into the next turn. */
  private interruption: string | null = null;
  private wrapUpSent = false;
  /** Consecutive board rejections on the current step, for §17.3. */
  private boardFailures = 0;
  /** Where fix_board leaves its result for the escalation to pick up. */
  private repairedOps: BoardOp[] | null = null;

  constructor(private opts: SessionOptions) {
    this.subject = opts.subject;
    this.topic = opts.topic;
    this.level = opts.level;
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
      exam: this.exam,
      notes: this.notes,
      transcript: this.transcript,
      scriptedMode: this.scriptedMode,
      scriptedOffered: this.scriptedOffered,
      turn: this.turn,
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
   * The lesson
   * ---------------------------------------------------------------- */

  async start(): Promise<void> {
    this.opts.memory.beginSession();
    this.transition({ t: 'start' });

    try {
      await this.runPlanner();
      if (this.aborted) return;

      await this.runTutor();
      if (this.aborted) return;

      if (this.phase === 'EXAMINING') {
        await this.runExaminer();
      }
    } catch (err) {
      this.fail(err);
    } finally {
      // A lesson is saved whatever happened to it. Losing a lesson in progress
      // on any error is listed under "never acceptable" (§17.5).
      await this.persist();
      this.emit();
    }
  }

  private async runPlanner(): Promise<void> {
    const ctx = await this.promptContext();
    const materials = await this.opts.materials.list();

    const outcome = await runAgent(
      this.agentConfig('planner', plannerPrompt(ctx), [
        {
          role: 'user',
          content: plannerSeed(ctx, materials.length > 0, this.opts.reviewConcepts ?? []),
        },
      ]),
      this.runContext('planner'),
    );

    if (outcome.error) throw outcome.error;

    if (!this.plan) {
      // The planner finished without committing a plan. Rather than stopping
      // the learner's session over it, teach from a minimal plan built from
      // what they asked for — a lesson from a thin plan beats no lesson.
      this.plan = fallbackPlan(this.opts.topic, this.opts.level, this.opts.subject);
      this.trace.push({
        t: 'note',
        message: 'The planner did not produce a plan, so a simple one was used instead.',
      });
    }

    this.transition({ t: 'planned' });
  }

  private async runTutor(): Promise<void> {
    const ctx = await this.promptContext();
    const plan = this.plan;
    if (!plan) return;

    const seed: { role: 'user'; content: string }[] = [
      { role: 'user', content: tutorSeed(plan, this.opts.topic) },
    ];

    const outcome = await runAgent(
      this.agentConfig('tutor', tutorPrompt(ctx), seed),
      this.runContext('tutor'),
    );

    if (outcome.error && outcome.error.kind !== 'BudgetError') throw outcome.error;

    if (!this.ending) {
      // Out of turns or budget: close the lesson deliberately rather than
      // leaving the learner on a half-drawn board.
      this.ending = {
        summary: 'We ran out of time for this session, but the board has everything we covered.',
        objectivesMet: [],
        objectivesMissed: plan.objectives.map((o) => o.id),
        nextTopics: [],
        runExam: this.board.stepCount > 2,
      };
      this.transition({ t: 'lesson_ended', runExam: this.ending.runExam });
    }
  }

  private async runExaminer(): Promise<void> {
    const ctx = await this.promptContext();
    const plan = this.plan;
    if (!plan) return;

    const outcome = await runAgent(
      this.agentConfig('examiner', examinerPrompt(ctx, this.board.historySummary()), [
        {
          role: 'user',
          content: examinerSeed(
            plan,
            this.ending?.objectivesMet ?? [],
            this.ending?.objectivesMissed ?? [],
          ),
        },
      ]),
      this.runContext('examiner'),
    );

    if (outcome.error && outcome.error.kind !== 'BudgetError') {
      this.trace.push({ t: 'error', error: outcome.error.toJSON() });
    }
    if (!this.exam) this.transition({ t: 'exam_finished' });
  }

  /**
   * Counts board rejections and escalates on the second (§17.3).
   *
   * The first failure goes back to the tutor, which usually fixes its own
   * mistake for free. The second means the tutor cannot see what is wrong, so
   * a cheap dedicated model gets one attempt. If that fails too, the step's
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
   * The repairer (§8.5). Invoked by the runtime, never by another agent, after
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
   * actually available — a tutor told it has a sandbox when it does not will
   * offer to run code and then fail in front of the learner (§17.4).
   */
  private async promptContext(): Promise<PromptContext> {
    const materials = await this.opts.materials.list();
    return {
      subject: this.opts.subject,
      level: this.opts.level,
      topic: this.opts.topic,
      sandbox: this.opts.settings.sandboxEnabled && this.opts.sandbox.available(),
      sandboxReason: this.opts.sandbox.unavailableReason() || undefined,
      wiki: this.opts.settings.wikiEnabled,
      materials: materials.length > 0,
    };
  }

  /* ---------------------------------------------------------------- *
   * Agent plumbing
   * ---------------------------------------------------------------- */

  /** Capabilities unavailable this session, withheld from every agent. */
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
    seedMessages: { role: 'user'; content: string }[],
  ): AgentConfig {
    const spec = AGENT_SPECS[id];
    const exclude = this.excludedTools();

    return {
      id,
      model: this.opts.models[id],
      system,
      maxTurns: spec.maxTurns,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      seedMessages,
      exclude,
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
        masteryDeltas: [],
      },
      injectBeforeTurn: agent === 'tutor' ? () => this.takeInjection() : undefined,
      onTurnQuality: (ok) => {
        this.toolWatch.record(ok);
        if (this.toolWatch.shouldOfferScriptedMode && !this.scriptedOffered) {
          this.scriptedOffered = true;
          this.trace.push({
            t: 'note',
            message:
              'This model has not managed a valid tool call in three turns. Offering the reduced scripted mode.',
          });
          this.emit();
        }
      },
      onEvent: () => {
        this.turn = this.budget.snapshot().turns;
      },
    };
  }

  private toolContext(agent: AgentId): ToolContext {
    return {
      agent,
      excluded: this.excludedTools(),
      sessionId: this.id,
      subject: this.opts.subject,
      signal: this.controller.signal,
      trace: this.trace,
      settings: this.opts.settings,
      board: this.boardPort(),
      learner: this.learnerPort(),
      sandbox: this.figureStoringSandbox(),
      memory: this.opts.memory,
      materials: this.opts.materials,
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
              if (this.pending?.kind === 'ask') {
                this.pending = null;
                resolve({ answer: '', elapsedMs: now() - askedAt, skipped: true });
              }
            },
            { once: true },
          );
        }),

      quiz: (questions, signal) =>
        new Promise<QuizOutcome>((resolve) => {
          this.previousPhase = this.phase;
          this.transition({ t: 'ask_started' });
          const askedAt = now();

          const settle = (outcome: QuizOutcome): void => {
            this.pending = null;
            // No answers means no evidence, so no score reaches the phase
            // machine and the lesson carries on rather than remediating.
            this.transition(
              outcome.answered > 0
                ? { t: 'ask_finished', score: outcome.score }
                : { t: 'ask_finished' },
            );
            resolve(outcome);
          };

          this.pending = { kind: 'quiz', questions, resolve: settle, askedAt };
          this.emit();

          signal.addEventListener(
            'abort',
            () => {
              if (this.pending?.kind === 'quiz') {
                this.pending = null;
                resolve({
                  score: 0,
                  answered: 0,
                  perQuestion: questions.map((q) => ({
                    chosen: -1,
                    correct: q.answer,
                    concept: q.concept,
                    skipped: true,
                  })),
                  elapsedMs: now() - askedAt,
                });
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

      case 'end_lesson': {
        this.ending = event.payload as EndLessonIn;
        this.transition({ t: 'lesson_ended', runExam: this.ending.runExam });
        break;
      }

      case 'finish_exam':
        this.exam = event.payload as FinishExamIn;
        this.transition({ t: 'exam_finished' });
        break;

      case 'check_scored': {
        // The remediation instruction is composed here, in code, from the
        // score — the model is told what is happening, not asked.
        if (event.score < 1 && this.phase !== 'EXAMINING' && this.previousPhase !== 'EXAMINING') {
          if (event.score < 0.8) {
            this.remediation = remediationInstruction(event.score, event.weak);
            if (event.score < PREREQUISITE_THRESHOLD && event.onFail) {
              this.remediation += `\n\nThe tutor's own note for this case was: ${event.onFail}`;
            }
          }
        }
        break;
      }

      case 'step_written':
        this.currentStepId = event.stepId;
        this.boardFailures = 0;
        // The remediation instruction has been given and acted on, so the
        // lesson is teaching again. Leaving the phase at REMEDIATING would
        // keep telling the learner it is backing up long after it stopped.
        if (this.phase === 'REMEDIATING' && this.remediation === null) {
          this.transition({ t: 'resume' });
        }
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

  answerAsk(answer: string, skipped = false): void {
    const pending = this.pending;
    if (pending?.kind !== 'ask') return;
    pending.resolve({ answer, elapsedMs: now() - pending.askedAt, skipped });
  }

  answerQuiz(chosen: number[]): void {
    const pending = this.pending;
    if (pending?.kind !== 'quiz') return;

    const perQuestion = pending.questions.map((q, i) => {
      const pick = chosen[i] ?? -1;
      return { chosen: pick, correct: q.answer, concept: q.concept, skipped: pick < 0 };
    });
    const answered = perQuestion.filter((p) => !p.skipped);
    const right = answered.filter((p) => p.chosen === p.correct).length;

    pending.resolve({
      // A skipped question is not a wrong answer, so it is left out of the
      // denominator rather than counted against the learner (§9.2).
      score: answered.length ? right / answered.length : 0,
      answered: answered.length,
      perQuestion,
      elapsedMs: now() - pending.askedAt,
    });
  }

  /** Raise hand (§15). Injected as the next user message. */
  raiseHand(question: string): void {
    this.interruption = question;
    this.transition({ t: 'raise_hand' });
  }

  get pendingInterruption(): string | null {
    return this.interruption;
  }

  /** Extra instructions the loop should inject before the tutor's next turn. */
  takeInjection(): string | null {
    if (this.interruption) {
      const q = this.interruption;
      this.interruption = null;
      this.transition({ t: 'resume' });
      return `The learner raised their hand and asked: "${q}"\n\nAnswer it as an aside in at most two steps, say you are returning to the lesson, and carry on from where you were.`;
    }
    if (this.remediation) {
      const r = this.remediation;
      this.remediation = null;
      return r;
    }
    if (this.budget.shouldWrapUp && !this.wrapUpSent) {
      this.wrapUpSent = true;
      return WRAP_UP_INSTRUCTION;
    }
    return null;
  }

  abort(): void {
    this.controller.abort(asChalkError(new DOMException('Aborted', 'AbortError')));
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
    if (this.board.stepCount === 0 && !this.plan) return;

    const records = await this.opts.memory.concepts(this.opts.memory.touchedConcepts());
    const usage = this.budget.snapshot();

    const record: LessonRecord = {
      id: this.id,
      subject: this.opts.subject,
      topic: this.opts.topic,
      title: this.plan?.title ?? this.opts.topic,
      level: this.opts.level,
      startedAt: this.startedAt,
      endedAt: now(),
      plan: this.plan,
      pages: this.board.pages,
      transcript: this.transcript,
      notes: this.notes,
      exam: this.exam
        ? {
            score: this.exam.score,
            strengths: this.exam.strengths,
            gaps: this.exam.gaps,
            verdict: this.exam.verdict,
          }
        : undefined,
      masteryDiff: this.opts.memory.masteryDiff(records),
      tokens: { input: usage.inputTokens, output: usage.outputTokens },
    };

    await saveLesson(record);

    const profile = await this.opts.memory.profile();
    await this.opts.memory.updateProfile({
      totals: {
        lessons: profile.totals.lessons + 1,
        minutes: profile.totals.minutes + Math.round((now() - this.startedAt) / 60_000),
      },
    });
  }

  /** Used by the review screen and the trace export. */
  async masteryDiff(): Promise<{ concept: string; before: number; after: number }[]> {
    const records = await this.opts.memory.concepts(this.opts.memory.touchedConcepts());
    return this.opts.memory.masteryDiff(records);
  }

  setScriptedMode(on: boolean): void {
    this.scriptedMode = on;
    this.emit();
  }

  /**
   * Scripted mode — rung 4 of the degradation ladder (§17.4).
   *
   * One call, an NDJSON lesson, no branching and no interruption. It exists
   * for models that cannot work the tool loop at all, where the alternative is
   * not a better lesson but no lesson. The learner has to have asked for it:
   * silently dropping to this would hide exactly the difference that makes the
   * rest of the product worth building.
   */
  async runScripted(): Promise<void> {
    this.scriptedMode = true;
    this.scriptedOffered = false;
    this.setStatus('Asking for the whole lesson in one go');

    const events = this.opts.provider.run(
      {
        model: this.opts.models.tutor,
        system: scriptedPrompt(this.opts.topic, BOARD_CONTRACT),
        messages: [{ role: 'user', content: `Teach: ${this.opts.topic}` }],
        // No tools at all — that is the whole point of this mode.
        tools: [],
        maxTokens: 8192,
        temperature: 0.6,
      },
      this.opts.adapterConfig,
      this.controller.signal,
    );

    let raw = '';
    try {
      for await (const event of events) {
        if (event.t === 'text') raw += event.delta;
        else if (event.t === 'usage') this.budget.add(event);
        else if (event.t === 'error') throw event.error;
      }
    } catch (err) {
      this.fail(err);
      return;
    }

    const lesson = parseScripted(raw, this.opts.topic);

    if (lesson.dropped.length) {
      this.trace.push({
        t: 'note',
        message: `${lesson.dropped.length} line(s) of the scripted lesson could not be read and were skipped.`,
      });
    }

    if (lesson.steps.length === 0) {
      this.fail(
        loopError(
          'This model could not produce a usable lesson, even in the reduced mode. Try a larger model in Settings.',
        ),
      );
      return;
    }

    for (const step of lesson.steps) {
      this.controller.signal.throwIfAborted();
      this.board.write({ say: step.say, ops: step.ops, clear: step.clear });
      const written = this.board.lastStep();
      if (written) {
        this.currentStepId = written.id;
        this.transcript = [
          ...this.transcript,
          { stepId: written.id, say: step.say, at: now() },
        ];
      }
      this.emit();
    }

    this.ending = {
      summary: 'That is the lesson. This was the reduced mode, so there were no questions.',
      objectivesMet: [],
      objectivesMissed: [],
      nextTopics: [],
      runExam: false,
    };
    this.transition({ t: 'lesson_ended', runExam: false });
    await this.persist();
  }

  /** Referenced by the repairer path; kept public for the integration tests. */
  repair(ops: unknown, problems: string[]): Promise<BoardOp[] | null> {
    return this.runRepairer(ops, problems);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function summarizePlan(plan: LessonPlan): string {
  const objectives = plan.objectives.map((o) => `${o.id}: ${o.text}`).join('; ');
  return `${plan.title} (${plan.level}). Objectives — ${objectives}.`;
}

/**
 * A minimal plan, used only when the planner produced none. It is deliberately
 * plain: the point is that the learner still gets taught, not that this stands
 * in for planning.
 */
function fallbackPlan(topic: string, level: Level, _subject: SubjectId): LessonPlan {
  return {
    id: uid('plan'),
    createdAt: now(),
    title: topic,
    level,
    objectives: [
      { id: 'obj-1', text: `The learner can state what ${topic} is and why it matters` },
      { id: 'obj-2', text: `The learner can work through one concrete example of ${topic}` },
      { id: 'obj-3', text: `The learner can recognise where ${topic} applies` },
    ],
    prerequisites: [],
    steps: [
      { objective: 'obj-1', representation: 'worked-example', note: 'a concrete instance first' },
      { objective: 'obj-1', representation: 'derivation', note: 'generalise from the instance' },
      { objective: 'obj-2', representation: 'check', note: 'check it landed' },
      { objective: 'obj-2', representation: 'worked-example', note: 'a harder case' },
      { objective: 'obj-3', representation: 'recap', note: 'where this shows up' },
    ],
    estimatedMinutes: 10,
  };
}

export type { Phase, Pace };
