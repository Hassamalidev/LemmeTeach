/**
 * code — a highlighted snippet with an optional focused range.
 *
 * The `focus` range is the point of this op for teaching: everything else
 * dims, so "look at line four" is shown rather than said. Line numbers are
 * always on, because a tutor referring to "line 7" out loud needs the learner
 * to find line 7 without counting.
 */
import { useEffect, useState } from 'react';
import type { BoardOp } from '../op-schema';
import { highlight, plainCodeHtml } from '../highlight';
import { Written, shown, useRegisterOp, type OpProps } from './common';
import type { BoardTheme } from '../../storage/settings';

type CodeOpType = Extract<BoardOp, { op: 'code' }>;

export function CodeOpView({
  op,
  revealed,
  register,
  theme,
}: OpProps<CodeOpType> & { theme: BoardTheme }): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  const [html, setHtml] = useState<string>(() => plainCodeHtml(op.src));

  useEffect(() => {
    let live = true;
    // Renders unhighlighted first, then upgrades. Never blocks the board.
    highlight(op.src, op.lang, theme).then((h) => {
      if (live) setHtml(h);
    });
    return () => {
      live = false;
    };
  }, [op.src, op.lang, theme]);

  const lines = op.src.split('\n');
  const from = op.focus?.[0];
  const to = op.focus?.[1];

  return (
    <div ref={ref} className="op op-code">
      <Written visible={shown(revealed, 0)}>
        <div className={`code-frame ${op.focus ? 'has-focus' : ''}`}>
          <div className="code-gutter" aria-hidden="true">
            {lines.map((_, i) => (
              <span
                key={i}
                className={from && to && i + 1 >= from && i + 1 <= to ? 'focused' : ''}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <div className="code-body">
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {from && to ? (
              <div
                className="code-focus-band"
                aria-hidden="true"
                style={{
                  top: `calc(${from - 1} * var(--code-line-h))`,
                  height: `calc(${to - from + 1} * var(--code-line-h))`,
                }}
              />
            ) : null}
          </div>
        </div>
      </Written>
    </div>
  );
}
