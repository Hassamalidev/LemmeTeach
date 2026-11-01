/**
 * The plan cards (§27). Shown on the home page and when a visitor chooses how to
 * pay, so a price can only ever be said one way.
 */
import { PLANS, formatUsd, type Plan, type PlanId } from '../../shared/plans';
import { checkoutAvailable } from '../billing/paddle';

export function PlanCards({ onChoose }: { onChoose: (plan: PlanId) => void }): JSX.Element {
  const bestValue = bestPerQuestion();
  return (
    <div className="plans">
      {PLANS.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          bestValue={plan.id === bestValue}
          onChoose={() => onChoose(plan.id)}
        />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  bestValue,
  onChoose,
}: {
  plan: Plan;
  bestValue: boolean;
  onChoose: () => void;
}): JSX.Element {
  const available = checkoutAvailable(plan.id);
  const centsEach = Math.round((plan.priceUsd / plan.lessons) * 100);
  return (
    <div className={`plan ${bestValue ? 'plan-best' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignSelf: 'stretch' }}>
        <h3>{plan.name}</h3>
        {bestValue && <span className="pill pill-accent">Lowest price per question</span>}
      </div>
      <p className="plan-price">
        {formatUsd(plan.priceUsd)}
        <span className="dim"> / month</span>
      </p>
      <p className="plan-lessons">About {plan.lessons} questions a month</p>
      <p className="dim small">
        Around {centsEach} cents a question. {plan.blurb}
      </p>
      {available ? (
        <button className="btn btn-primary" onClick={onChoose}>
          Choose {plan.name}
        </button>
      ) : (
        <>
          <button className="btn" disabled>
            Choose {plan.name}
          </button>
          <span className="dim small">Checkout is not set up on this site yet.</span>
        </>
      )}
    </div>
  );
}

/** The plan whose questions work out cheapest — computed, so the badge is true. */
function bestPerQuestion(): string | null {
  let best: Plan | null = null;
  for (const plan of PLANS) {
    if (!best || plan.priceUsd / plan.lessons < best.priceUsd / best.lessons) best = plan;
  }
  return best?.id ?? null;
}
