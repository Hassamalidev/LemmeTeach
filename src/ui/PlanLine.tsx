/**
 * The plan line (§18).
 *
 * Plan name, what is left of this month's credit, and roughly how many
 * lessons that is. When the credit cannot be read it shows the plan alone —
 * nothing rather than a wrong number, because someone will plan around it.
 */
import { lessonsFor, nextPlanUp, type Plan } from '../../shared/plans';
import { DEEP_COST_MULTIPLE, type Credit, type Quality } from '../providers/managed';

export function PlanLine({
  plan,
  credit,
  quality,
  onSeePlans,
}: {
  plan: Plan;
  credit: Credit | null;
  quality: Quality;
  onSeePlans: () => void;
}): JSX.Element {
  const left = credit ? Math.min(credit.remainingUsd, plan.creditUsd) : null;
  const lessons =
    left === null ? null : Math.floor(lessonsFor(left) / (quality === 'deep' ? DEEP_COST_MULTIPLE : 1));
  const fraction = left === null ? 0 : left / plan.creditUsd;
  const low = left !== null && fraction < 0.15;

  return (
    <div className="plan-line">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{plan.name} plan</strong>
          {lessons !== null && (
            <span className="dim">
              {' '}
              · {lessons === 0 ? 'not enough for a full question' : `about ${lessons} question${lessons === 1 ? '' : 's'}`}{' '}
              left this month
            </span>
          )}
        </span>
        {low && nextPlanUp(plan.id) && (
          <button className="btn-quiet small" onClick={onSeePlans}>
            See bigger plans
          </button>
        )}
      </div>
      {left !== null && (
        <div
          className="bar"
          role="img"
          aria-label={`${Math.round(fraction * 100)} percent of this month’s questions left`}
          style={{ marginTop: 8 }}
        >
          <span className={low ? 'warn' : ''} style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
