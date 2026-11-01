/**
 * The usage events that are counted (§30). A fixed list, read by the browser
 * and the server, so a count can only ever be one of these words and never
 * carries a question, a name or anything else the learner typed.
 */
export const USAGE_EVENTS = [
  'landing_view',
  'demo_started',
  'question_started',
  'question_solved',
  'question_failed',
  'hand_raised',
  'paywall_seen',
  'checkout_opened',
  'plan_activated',
  'own_key_connected',
  'share_created',
  'share_opened',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

export function isUsageEvent(name: unknown): name is UsageEvent {
  return typeof name === 'string' && (USAGE_EVENTS as readonly string[]).includes(name);
}
