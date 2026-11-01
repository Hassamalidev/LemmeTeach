/**
 * The budget meter (§18).
 *
 * Shows what has been spent and roughly what it cost. When the model is not in
 * the price table it shows nothing rather than a wrong number — someone will
 * budget against whatever is on the screen.
 */
import type { BudgetSnapshot } from '../runtime/budget';
import { formatCost } from '../providers/pricing';

export function Meter({ budget }: { budget: BudgetSnapshot }): JSX.Element {
  const pct = Math.min(100, Math.round(budget.fraction * 100));
  const cost = formatCost(budget.estimatedCostUsd);
  const state = budget.exhausted ? 'over' : budget.warned ? 'warn' : '';

  return (
    <div className="meter">
      <div className="figures">
        <span>{budget.turns} turns</span>
        <span className="mono">
          {compact(budget.inputTokens)} in · {compact(budget.outputTokens)} out
        </span>
      </div>
      <div className="bar">
        <span className={state} style={{ width: `${pct}%` }} />
      </div>
      <div style={{ marginTop: 6 }}>
        {cost
          ? `${cost} so far${budget.costIsExact ? '' : ', estimated'}`
          : 'Cost unknown for this model'}
      </div>
      {budget.warned && !budget.exhausted && (
        <div style={{ marginTop: 4, color: '#d9a441' }}>
          Most of the budget is gone, so it is wrapping up.
        </div>
      )}
    </div>
  );
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}
