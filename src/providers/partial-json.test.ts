/**
 * The partial-JSON parser, on truncated, fenced and interleaved input (§22).
 *
 * The invariant that matters: this may only ever change *when* an operation
 * appears, never *what* appears. Anything it cannot recover exactly must come
 * back as nothing, so the caller falls through to the complete arguments.
 */
import { describe, expect, it } from 'vitest';
import { closeJson, parsePartial, parseStreamingStep } from './partial-json';

describe('closeJson', () => {
  it('leaves complete JSON alone', () => {
    const json = '{"a":1,"b":[2,3]}';
    expect(JSON.parse(closeJson(json) ?? '')).toEqual({ a: 1, b: [2, 3] });
  });

  it('closes an open object', () => {
    expect(JSON.parse(closeJson('{"a":1,"b":"done"') ?? '')).toEqual({ a: 1, b: 'done' });
  });

  it('closes nested structures innermost first', () => {
    const out = closeJson('{"a":[{"b":[1,2],"c":"x"');
    expect(JSON.parse(out ?? '')).toEqual({ a: [{ b: [1, 2], c: 'x' }] });
  });

  it('drops a trailing number, because it may be truncated', () => {
    // "1" could be the whole value, or the first digit of 15. Reporting it
    // would be reporting a different number than the model sent, so it waits.
    // Dropping only ever yields *less* than the truth, never something wrong.
    expect(JSON.parse(closeJson('{"a":1') ?? '')).toEqual({});
    expect(JSON.parse(closeJson('[1,2') ?? '')).toEqual([1]);
  });

  it('keeps a number once something after it proves it finished', () => {
    expect(JSON.parse(closeJson('{"a":1,') ?? '')).toEqual({ a: 1 });
    expect(JSON.parse(closeJson('[1,2,') ?? '')).toEqual([1, 2]);
  });

  it('closes an unterminated string rather than losing the value', () => {
    const out = closeJson('{"say":"Watch what happens');
    expect(JSON.parse(out ?? '')).toEqual({ say: 'Watch what happens' });
  });

  it('drops a dangling key with no value', () => {
    const out = closeJson('{"say":"hello","board":');
    expect(JSON.parse(out ?? '')).toEqual({ say: 'hello' });
  });

  it('drops a trailing comma', () => {
    const out = closeJson('{"a":1,');
    expect(JSON.parse(out ?? '')).toEqual({ a: 1 });
  });

  it('refuses to guess mid-escape', () => {
    expect(closeJson('{"tex":"\\\\frac{a}{b}\\')).toBeNull();
  });

  it('handles escaped quotes inside strings', () => {
    const out = closeJson('{"say":"she said \\"hello\\" and');
    expect(JSON.parse(out ?? '')).toEqual({ say: 'she said "hello" and' });
  });

  it('handles a brace inside a string without treating it as structure', () => {
    const out = closeJson('{"tex":"\\\\frac{d}{dx}');
    expect(JSON.parse(out ?? '')).toEqual({ tex: '\\frac{d}{dx}' });
  });
});

describe('parsePartial', () => {
  it('returns nothing for an empty fragment', () => {
    expect(parsePartial('').value).toBeNull();
    expect(parsePartial('   ').value).toBeNull();
  });

  it('recovers a value from every prefix of a real call', () => {
    const full =
      '{"say":"Watch this carefully.","board":[{"op":"heading","text":"Derivatives"},{"op":"math","tex":"f(x)=x^2"}]}';

    // Every prefix must either parse to something, or return null. It must
    // never throw, and it must never produce a value the full parse would
    // contradict on a field it did report.
    for (let i = 1; i <= full.length; i++) {
      const result = parsePartial<{ say?: string }>(full.slice(0, i));
      if (result.value?.say && full.slice(0, i).includes('","board"')) {
        expect(result.value.say).toBe('Watch this carefully.');
      }
    }
  });

  it('never throws on arbitrary truncation of nested content', () => {
    const full = JSON.stringify({
      say: 'A sentence with "quotes" and a backslash \\ in it.',
      board: [
        { op: 'derive', lines: [{ tex: '\\int u\\,dv', note: 'start' }, { tex: 'uv - \\int v\\,du' }] },
        { op: 'table', headers: ['a', 'b'], rows: [['1', '2']] },
      ],
    });

    for (let i = 0; i <= full.length; i++) {
      expect(() => parsePartial(full.slice(0, i))).not.toThrow();
    }
  });
});

describe('parseStreamingStep', () => {
  it('holds back the operation still being written', () => {
    const fragment =
      '{"say":"Here we go.","board":[{"op":"heading","text":"Done"},{"op":"math","tex":"x^';
    const step = parseStreamingStep(fragment);
    expect(step.say).toBe('Here we go.');
    // The heading is complete; the math is mid-write and must not be drawn.
    expect(step.ops).toHaveLength(1);
    expect((step.ops[0] as { op: string }).op).toBe('heading');
  });

  it('offers every operation once the array has closed', () => {
    const fragment =
      '{"say":"Here we go.","board":[{"op":"heading","text":"A"},{"op":"text","text":"B"}]}';
    const step = parseStreamingStep(fragment);
    expect(step.ops).toHaveLength(2);
  });

  it('offers nothing before the board has started', () => {
    expect(parseStreamingStep('{"say":"Just talking so far.').ops).toHaveLength(0);
  });

  it('rejects fragments that are not yet recognisable operations', () => {
    const step = parseStreamingStep('{"say":"x","board":[{"op":"he');
    expect(step.ops).toHaveLength(0);
  });

  it('grows monotonically as a real call streams in', () => {
    const full =
      '{"say":"Three things.","board":[{"op":"heading","text":"One"},{"op":"text","text":"Two"},{"op":"text","text":"Three"}]}';

    let seen = 0;
    for (let i = 1; i <= full.length; i++) {
      const step = parseStreamingStep(full.slice(0, i));
      // An operation that has appeared must never disappear again — the
      // renderer is idempotent per index and cannot un-draw.
      expect(step.ops.length).toBeGreaterThanOrEqual(seen);
      seen = step.ops.length;
    }
    expect(seen).toBe(3);
  });

  it('agrees with the complete parse once the call has finished', () => {
    const value = {
      say: 'The whole thing.',
      board: [
        { op: 'heading', text: 'Title' },
        { op: 'bullets', items: ['a', 'b'] },
      ],
    };
    const full = JSON.stringify(value);
    const step = parseStreamingStep(full);
    expect(step.say).toBe(value.say);
    expect(step.ops).toEqual(value.board);
  });
});
