/**
 * The NDJSON parser on truncated, fenced and interleaved input (§22).
 *
 * Every one of these cases is something a small local model actually does, and
 * the point of scripted mode is to salvage a lesson from output that the tool
 * loop could not use at all.
 */
import { describe, expect, it } from 'vitest';
import { parseScripted, ToolCapabilityWatch } from './scripted';

const line = (say: string, board = '[]') => `{"say":"${say}","board":${board}}`;

describe('parseScripted', () => {
  it('reads clean NDJSON', () => {
    const raw = [line('First step here, watch this.'), line('Second step, now the rule.')].join('\n');
    const lesson = parseScripted(raw, 'Topic');
    expect(lesson.steps).toHaveLength(2);
    expect(lesson.steps[0]?.say).toBe('First step here, watch this.');
    expect(lesson.dropped).toHaveLength(0);
  });

  it('survives a markdown fence around the whole thing', () => {
    const raw = ['```json', line('Inside a fence.'), line('Still inside.'), '```'].join('\n');
    expect(parseScripted(raw, 'Topic').steps).toHaveLength(2);
  });

  it('survives prose before the JSON', () => {
    const raw = ['Sure! Here is the lesson:', '', line('The actual step.')].join('\n');
    const lesson = parseScripted(raw, 'Topic');
    expect(lesson.steps).toHaveLength(1);
    expect(lesson.dropped.length).toBeGreaterThan(0);
  });

  it('keeps every complete line when the last one is truncated', () => {
    const raw = [line('One.'), line('Two.'), '{"say":"Three, but cut off mid'].join('\n');
    const lesson = parseScripted(raw, 'Topic');
    expect(lesson.steps).toHaveLength(2);
    expect(lesson.dropped).toHaveLength(1);
  });

  it('tolerates a JSON array wrapper with trailing commas', () => {
    const raw = ['[', `${line('One.')},`, `${line('Two.')}`, ']'].join('\n');
    expect(parseScripted(raw, 'Topic').steps).toHaveLength(2);
  });

  it('keeps the narration when the board operations are invalid', () => {
    const raw = line('Narration survives.', '[{"op":"nonsense","text":"x"}]');
    const lesson = parseScripted(raw, 'Topic');
    // A dropped drawing still leaves an explanation; a dropped step leaves
    // a hole in the lesson, which is worse.
    expect(lesson.steps).toHaveLength(1);
    expect(lesson.steps[0]?.say).toBe('Narration survives.');
    expect(lesson.steps[0]?.ops).toHaveLength(0);
  });

  it('keeps valid board operations', () => {
    const raw = line('With a board.', '[{"op":"text","text":"V = IR"}]');
    const lesson = parseScripted(raw, 'Topic');
    expect(lesson.steps[0]?.ops).toHaveLength(1);
  });

  it('returns an empty lesson rather than throwing on rubbish', () => {
    const lesson = parseScripted('I cannot do that.', 'Topic');
    expect(lesson.steps).toHaveLength(0);
    expect(lesson.dropped.length).toBeGreaterThan(0);
  });
});

describe('ToolCapabilityWatch', () => {
  it('offers scripted mode only after three consecutive failures', () => {
    const watch = new ToolCapabilityWatch();
    watch.record(false);
    watch.record(false);
    expect(watch.shouldOfferScriptedMode).toBe(false);
    watch.record(false);
    expect(watch.shouldOfferScriptedMode).toBe(true);
  });

  it('forgives a model that recovers', () => {
    const watch = new ToolCapabilityWatch();
    watch.record(false);
    watch.record(false);
    watch.record(true);
    watch.record(false);
    expect(watch.shouldOfferScriptedMode).toBe(false);
  });
});
