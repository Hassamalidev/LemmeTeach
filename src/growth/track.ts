/**
 * Counting what people do (§30).
 *
 * One word from a fixed list and a random id made here, sent with sendBeacon
 * so it never slows anything and cannot fail in front of anyone. Nothing the
 * learner typed is ever part of it. A browser that asks not to be tracked is
 * not counted, and development builds count nothing.
 */
import { weekOf } from '../../shared/dates';
import type { UsageEvent } from '../../shared/events';

const VISITOR_KEY = 'chalk.visitor';

interface Visitor {
  id: string;
  firstWeek: string;
}

function askedNotTo(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || n.doNotTrack === '1';
}

function visitor(): Visitor | null {
  try {
    const raw = localStorage.getItem(VISITOR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Visitor>;
      if (typeof parsed.id === 'string' && typeof parsed.firstWeek === 'string') {
        return { id: parsed.id, firstWeek: parsed.firstWeek };
      }
    }
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const made: Visitor = {
      id: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      firstWeek: weekOf(Date.now()),
    };
    localStorage.setItem(VISITOR_KEY, JSON.stringify(made));
    return made;
  } catch {
    return null; // Storage blocked: counted, but not as a returning visitor.
  }
}

export function track(event: UsageEvent): void {
  try {
    if (!import.meta.env.PROD || askedNotTo()) return;
    const who = visitor();
    const body = JSON.stringify({ event, visitor: who?.id, firstWeek: who?.firstWeek });
    navigator.sendBeacon?.('/api/event', body);
  } catch {
    /* Counting never gets in the way. */
  }
}
