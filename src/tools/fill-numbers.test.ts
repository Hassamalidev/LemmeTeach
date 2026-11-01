/**
 * Numbers written into a step as {{expression}} (§9.3, §18).
 *
 * The point is a turn saved on every step with a number in it, without ever
 * letting a number reach the board that was not computed.
 */
import { describe, expect, it } from 'vitest';
import { fillNumbers, fillNumbersDeep } from './compute';

describe('numbers in a step', () => {
  it('works out each slot to four significant figures', () => {
    expect(fillNumbers('v = {{20*sin(35 deg)}} m/s').text).toBe('v = 11.47 m/s');
    expect(fillNumbers('{{2 * 11.4715 / 9.8}}').text).toBe('2.341');
  });

  it('takes a precision after a bar', () => {
    expect(fillNumbers('{{9.81 * 2 | 3}}').text).toBe('19.6');
    expect(fillNumbers('{{ 1/3 |2 }}').text).toBe('0.33');
  });

  it('keeps units', () => {
    expect(fillNumbers('{{16.38 m/s * 2.34 s}}').text).toBe('38.33 m');
  });

  it('reports what each slot came to, and any it could not work out', () => {
    const values: Record<string, string> = {};
    const errors: string[] = [];
    fillNumbers('{{3*4}} and {{3 */ 4}}', values, errors);
    expect(values).toEqual({ '3*4': '12' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('3 */ 4');
  });

  it('leaves LaTeX that happens to use double braces alone', () => {
    expect(fillNumbers('\\text{{m/s}} and x^{{\\alpha}}').text).toBe('\\text{{m/s}} and x^{{\\alpha}}');
    // A number on its own evaluates to itself, so even a stray one is harmless.
    expect(fillNumbers('\\frac{{20}}{2}').text).toBe('\\frac{20}{2}');
  });

  it('reaches every string in a step, and nothing else', () => {
    const step = {
      say: 'It takes {{2*11.47/9.8 | 3}} seconds.',
      board: [
        { op: 'derive', lines: [{ tex: 'T = {{2*11.47/9.8 | 3}}\\,\\text{s}', note: 'twice the rise' }] },
        { op: 'plot', fns: [{ expr: 'x^2' }], domain: [-1, 1] },
      ],
    };
    const values: Record<string, string> = {};
    const out = fillNumbersDeep(step, values, []);
    expect(out.say).toBe('It takes 2.34 seconds.');
    expect(out.board[0]).toEqual({ op: 'derive', lines: [{ tex: 'T = 2.34\\,\\text{s}', note: 'twice the rise' }] });
    expect(out.board[1]).toEqual(step.board[1]);
    expect(values).toEqual({ '2*11.47/9.8': '2.34' });
  });

  it('cannot reach outside mathjs', () => {
    const errors: string[] = [];
    const out = fillNumbers('{{import({x: 1})}} {{createUnit("zz1")}}', {}, errors);
    // Braces inside are not a slot at all; the other is refused.
    expect(out.text).toContain('{{import({x: 1})}}');
    expect(errors).toHaveLength(1);
  });

  it('reads the slips a real model made', () => {
    // JavaScript's maths inside a slot.
    expect(fillNumbers('{{20*Math.cos(35*Math.PI/180)}}').text).toBe('16.38');
    // The precision put after the braces, which would otherwise leave "|3 }}" on the board.
    expect(fillNumbers('= {{400/9.8}}|3 }} m').text).toBe('= 40.8 m');
  });

  it('keeps a group a group in LaTeX', () => {
    expect(fillNumbers('x^{{2*3}}').text).toBe('x^{6}');
    expect(fillNumbers('= {{2*3}}').text).toBe('= 6');
  });
});
