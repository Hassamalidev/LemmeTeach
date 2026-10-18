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

export const compute: Tool = {
  name: 'compute',
  description: `Evaluate up to eight mathematical expressions at once, instantly: exact arithmetic, unit conversion, simplification, derivatives. Use it for every number you put on the board. Say the result, not that you computed it.

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
