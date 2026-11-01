/**
 * compute (§9.5) — fast mathjs evaluation.
 *
 * Milliseconds, no sandbox, no Pyodide. This exists so the tutor never spins
 * up a Python runtime to multiply two numbers, and it is `parallelSafe`
 * because evaluating an expression touches nothing.
 */
import { create, all, type MathJsInstance, type FactoryFunctionMap } from 'mathjs';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { ComputeInput, type ComputeIn } from './schemas';

/**
 * A restricted mathjs instance. `import` and `createUnit` let an expression
 * redefine the evaluator itself, and expression strings here come from a
 * model, so they are removed — the sandbox in §11 is for running code, not
 * this.
 */
let mathInstance: MathJsInstance | null = null;

function math(): MathJsInstance {
  if (!mathInstance) {
    const m = create(all as FactoryFunctionMap, { number: 'number', precision: 64 });
    const disabled = (name: string) => () => {
      throw new Error(`${name} is not available here. Use run_code if you need to define things.`);
    };
    // "import" and "createUnit" would let an expression redefine the evaluator
    // itself, and these strings come from a model; "config" can change number
    // handling underneath us. Nothing else is removed — in particular
    // "evaluate" stays, because this instance calls it.
    m.import(
      {
        import: disabled('import'),
        createUnit: disabled('createUnit'),
        config: disabled('config'),
      },
      { override: true },
    );
    mathInstance = m;
  }
  return mathInstance;
}

function present(value: unknown, precision: number): string {
  const m = math();
  try {
    if (typeof value === 'number') {
      return m.format(value, { precision, lowerExp: -6, upperExp: 12 });
    }
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    return m.format(value, { precision, lowerExp: -6, upperExp: 12 });
  } catch {
    return String(value);
  }
}

/**
 * `{{ expression }}`, optionally `{{ expression | 3 }}` for three significant
 * figures. A model sometimes puts the precision after the braces —
 * `{{ expression }}|3 }}` — and that is read the same way, rather than
 * leaving "|3 }}" written on the board.
 */
const SLOT = /\{\{([^{}\\|]*?)(?:\|\s*(\d{1,2})\s*)?\}\}(?:\s*\|\s*(\d{1,2})\s*\}\})?/g;

/** JavaScript's maths, which models reach for, in mathjs terms. */
function asMathjs(expr: string): string {
  return expr
    .replace(/\bMath\.PI\b/g, 'pi')
    .replace(/\bMath\.E\b/g, 'e')
    .replace(/\bMath\.(\w+)\b/g, '$1')
    .replace(/\*\*/g, '^');
}

export interface FilledText {
  text: string;
  /** Each expression worked out, and what it came to. */
  values: Record<string, string>;
  /** Expressions that could not be worked out, with why. */
  errors: string[];
}

/**
 * Work out the numbers written into a step as `{{ expression }}` (§9.3).
 *
 * The solver must never write a number it has not computed. Asking compute
 * first and writing the step on the next turn is a whole extra turn — the
 * full prompt and conversation sent again — for every step with a number in
 * it. Writing the expression where the number goes, and working it out here
 * as the step is drawn, gets the same guarantee for nothing.
 *
 * Only a slot with a digit in it is touched, and never one with a backslash,
 * so LaTeX that happens to use double braces is left as it was.
 */
export function fillNumbers(text: string, values: Record<string, string> = {}, errors: string[] = []): FilledText {
  const m = math();
  const out = text.replace(SLOT, (whole, rawExpr: string, inside: string | undefined, after: string | undefined, at: number) => {
    const expr = rawExpr.trim();
    if (!/\d/.test(expr)) return whole;
    try {
      const precision = Math.min(12, Math.max(1, Number(inside ?? after ?? 4)));
      const value = present(m.evaluate(asMathjs(expr), {}), precision);
      values[expr] = value;
      // Straight after a LaTeX command, a superscript or a group, the braces
      // were a group too: rac{{20}}{2} must stay rac{20}{2}.
      const before = text.slice(0, at);
      return /(\\[a-zA-Z]+|[\^_}])\s*$/.test(before) ? `{${value}}` : value;
    } catch (err) {
      errors.push(`{{${expr}}}: ${err instanceof Error ? err.message : String(err)}`);
      return whole;
    }
  });
  return { text: out, values, errors };
}

/** The same, through every string inside a value: a step's narration and its board operations. */
export function fillNumbersDeep<T>(value: T, values: Record<string, string>, errors: string[]): T {
  if (typeof value === 'string') return fillNumbers(value, values, errors).text as T;
  if (Array.isArray(value)) return value.map((v) => fillNumbersDeep(v, values, errors)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillNumbersDeep(v, values, errors)]),
    ) as T;
  }
  return value;
}

export const compute: Tool = {
  name: 'compute',
  description: `Evaluate up to eight mathematical expressions at once, instantly: exact arithmetic, unit conversion, simplification, derivatives. Only for numbers you need before you can decide what to write; a number going straight onto the board is cheaper written into teach_step as {{expression}}. Say the result, not that you computed it.

mathjs syntax: "9.81 * 2.5^2 / 2", "unit(3, 'eV') to 'J'", "simplify('x^2 + 2x + 1')", "derivative('x^2 sin(x)', 'x')".`,
  schema: ComputeInput,
  agents: ['tutor'],
  parallelSafe: true,
  suspends: false,

  async run(input: ComputeIn, _ctx: ToolContext): Promise<ToolOutcome> {
    const precision = input.precision ?? 6;
    const m = math();
    const results = input.expressions.map((expr) => {
      try {
        // A fresh scope per expression: one call must not leak assignments
        // into the next, which would make results order-dependent.
        const value: unknown = m.evaluate(expr, {});
        return { expr, value: present(value, precision) };
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        return { expr, error: why };
      }
    });

    const anyOk = results.some((r) => 'value' in r);
    return {
      ok: anyOk,
      data: { results },
      message: anyOk ? undefined : 'None of those expressions parsed. Check the mathjs syntax.',
    };
  },
};
