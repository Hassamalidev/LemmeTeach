/**
 * Server-sent events, read from a fetch body.
 *
 * All five real adapters stream, and all five stream SSE, so the framing is
 * parsed once here. The one thing worth being careful about is that a chunk
 * boundary can land anywhere — including in the middle of a multi-byte
 * character or a `data:` line — so the buffer is only split on a complete
 * event separator.
 */

export interface SseEvent {
  event: string | null;
  data: string;
}

export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = (): void => {
    reader.cancel().catch(() => {
      /* the fetch is already going away */
    });
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = findSeparator(buffer);
      while (sep !== -1) {
        const raw = buffer.slice(0, sep.index);
        buffer = buffer.slice(sep.index + sep.length);
        const parsed = parseEvent(raw);
        if (parsed) yield parsed;
        sep = findSeparator(buffer);
      }
    }

    const tail = parseEvent(buffer);
    if (tail) yield tail;
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}

function findSeparator(buffer: string): { index: number; length: number } | -1 {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseEvent(raw: string): SseEvent | null {
  if (!raw.trim()) return null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

/** Parse a `data:` payload, ignoring the sentinels providers use to end a stream. */
export function parseData<T>(data: string): T | null {
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
