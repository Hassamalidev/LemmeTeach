/**
 * Tolerant incremental JSON parsing (§6).
 *
 * `tool_delta` carries partial arguments. For `teach_step` specifically, this
 * lets the board start drawing the first operations while the rest of the call
 * is still arriving, which is what makes the tutor feel live rather than
 * turn-based.
 *
 * It is strictly an optimization, and the contract says so: if the tolerant
 * parse fails at any point, the caller discards the partial state and waits
 * for `tool_end`. Nothing here may render an operation the real validator
 * would have rejected — the partial parse only decides *when* an operation
 * appears, never *whether* it is valid.
 *
 * Two guarantees the tests hold this to:
 *
 *   - It never throws, on any prefix of any input.
 *   - The operation count only ever grows. The renderer is idempotent per
 *     index and cannot un-draw, so an operation that has appeared must not
 *     disappear on the next delta.
 *
 * Everything below closes a fragment and hands it to `JSON.parse` rather than
 * interpreting the bytes itself. Keeping the real parser as the only thing
 * reading model output is what makes this safe to point at a stream.
 */

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/**
 * Where a container sits, and whether it currently holds a complete value.
 *
 * Tracking this per level is what lets a truncated tail be cut at the right
 * place: `{"say":"hi","board":` has to lose the dangling key as well as the
 * colon, and only the level's own state knows where that key began.
 */
interface Level {
  kind: 'object' | 'array';
  /** Index just past the last complete member of this container. */
  safe: number;
}

interface Scan {
  levels: Level[];
  inString: boolean;
  /** True when the scan ended part-way through a backslash escape. */
  midEscape: boolean;
  /** Index just past the last complete value at the outermost open level. */
  safe: number;
}

function scan(fragment: string): Scan {
  const levels: Level[] = [];
  let inString = false;
  let escaped = false;
  /** Index where the current string literal started, in case it is a key. */
  let stringStart = -1;
  /** Index just past the last complete value at the current level. */
  let pending = -1;

  const top = (): Level | undefined => levels[levels.length - 1];

  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        // A closing quote might end a value or a key. It is committed as a
        // complete value now and rolled back by the `:` case if it turns out
        // to have been a key — that way a trailing string value, which is the
        // common case mid-stream, is never lost.
        pending = i + 1;
        const level = top();
        if (level && pending > level.safe) level.safe = pending;
      }
      continue;
    }

    switch (ch) {
      case '"':
        inString = true;
        stringStart = i;
        break;

      case '{':
      case '[':
        levels.push({ kind: ch === '{' ? 'object' : 'array', safe: i + 1 });
        pending = -1;
        break;

      case '}':
      case ']': {
        levels.pop();
        pending = i + 1;
        const parent = top();
        if (parent) parent.safe = i + 1;
        break;
      }

      case ':':
        // The string that just closed was a key, so it is not a safe cut
        // point — the container is only safe up to before that key.
        pending = -1;
        if (stringStart >= 0) {
          const level = top();
          if (level && level.safe > stringStart) level.safe = stringStart;
        }
        break;

      case ',': {
        const level = top();
        // Everything before the comma is a complete member; the comma itself
        // is dropped, so the cut lands cleanly.
        if (level) level.safe = i;
        pending = -1;
        break;
      }

      default:
        if (!/\s/.test(ch ?? '')) {
          // A literal or number in progress. It only becomes safe when
          // something after it proves it finished.
          if (pending === -1) pending = -1;
        }
        break;
    }

    // Commit a pending value once the level agrees it is complete.
    if (pending !== -1) {
      const level = top();
      if (level && pending > level.safe) level.safe = pending;
    }
  }

  return {
    levels,
    inString,
    midEscape: escaped,
    safe: top()?.safe ?? fragment.length,
  };
}

/* ------------------------------------------------------------------ *
 * Closing
 * ------------------------------------------------------------------ */

/**
 * Close an incomplete JSON fragment so that it parses.
 *
 * Returns null when the fragment cannot be salvaged — mid-escape, where the
 * next character decides what the value is.
 */
export function closeJson(fragment: string): string | null {
  const state = scan(fragment);
  if (state.midEscape) return null;
  if (!state.levels.length) return fragment.trim() ? fragment : null;

  let out = fragment;

  if (state.inString) {
    // An unterminated string is closed where it stands. A partly written word
    // beats dropping the operation, and it is replaced the moment the complete
    // value arrives.
    out += '"';
  } else {
    // Cut back to the last point the innermost container considered complete,
    // which drops a dangling key, a trailing comma, or a half-written number.
    const level = state.levels[state.levels.length - 1];
    if (level && level.safe < out.length) {
      const tail = out.slice(level.safe);
      if (tail.trim()) out = out.slice(0, level.safe);
    }
    // Cutting back to the start of a dangling key leaves the comma that
    // introduced it, which is not valid on its own.
    out = out.replace(/,\s*$/, '');
  }

  for (let d = state.levels.length - 1; d >= 0; d--) {
    out += state.levels[d]?.kind === 'object' ? '}' : ']';
  }

  return out;
}

export interface PartialParse<T> {
  /** The value so far, or null when nothing complete can be recovered yet. */
  value: T | null;
}

/** Parse as much of an incomplete JSON document as can be recovered. */
export function parsePartial<T = unknown>(fragment: string): PartialParse<T> {
  if (!fragment.trim()) return { value: null };

  const closed = closeJson(fragment);
  if (closed === null) return { value: null };

  try {
    return { value: JSON.parse(closed) as T };
  } catch {
    return { value: null };
  }
}

/* ------------------------------------------------------------------ *
 * A streaming teach_step
 * ------------------------------------------------------------------ */

export interface StreamingStep {
  say: string | null;
  /** Operations known to be complete, in order. Never shrinks. */
  ops: unknown[];
}

/**
 * The board's view of a `teach_step` call as it streams.
 *
 * Operations are recovered by finding the `board` array and taking only the
 * objects whose braces have balanced. That is what makes the count monotonic:
 * an object is either finished or it is not yet offered, and finishing is not
 * something a later delta can undo.
 */
export function parseStreamingStep(fragment: string): StreamingStep {
  const { value } = parsePartial<{ say?: unknown }>(fragment);
  const say = value && typeof value.say === 'string' ? value.say : null;

  return { say, ops: completeBoardOps(fragment) };
}

function completeBoardOps(fragment: string): unknown[] {
  const start = findBoardArray(fragment);
  if (start === -1) return [];

  const ops: unknown[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start; i < fragment.length; i++) {
    const ch = fragment[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          const op = JSON.parse(fragment.slice(objectStart, i + 1)) as unknown;
          if (isPlausibleOp(op)) ops.push(op);
        } catch {
          // A balanced object that will not parse is a fragment we cannot
          // trust; the complete arguments will carry it instead.
        }
        objectStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break; // The board array has closed.
    }
  }

  return ops;
}

/** Index just after the `[` that opens the `board` array, or -1. */
function findBoardArray(fragment: string): number {
  const key = fragment.indexOf('"board"');
  if (key === -1) return -1;
  const open = fragment.indexOf('[', key);
  return open === -1 ? -1 : open + 1;
}

/**
 * A cheap shape check, not validation. The real validator still runs at the
 * tool bus; this only avoids handing the renderer something that is plainly a
 * fragment rather than an operation.
 */
function isPlausibleOp(op: unknown): boolean {
  if (typeof op !== 'object' || op === null) return false;
  const kind = (op as { op?: unknown }).op;
  return typeof kind === 'string' && kind.length > 2;
}
